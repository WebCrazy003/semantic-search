// frontend/src/app/SearchContext.tsx
// Search state lives above the router so a trip to Documents and back does not throw a
// result set away (spec R1.4). The old tab shell kept every tab mounted to get this;
// routes cannot, so the state moves up instead.
//
// It serves visitors too, who search public documents only (spec 2026-10-08 §1.5).
// Logging in or out runs the current query again, so the results on screen always
// match who is looking.
//
// The answer streamed with a search is owned here too (run() drives it), but published
// through AnswerContext, so a streamed word does not re-render everything that reads
// this context.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ask,
  fetchReadiness,
  search,
  type SearchHit,
  type SearchParams,
  type SearchResponse,
  type SearchScope,
  type Visibility,
} from '../services/api'
import { useSettings } from '../settings/SettingsContext'
import { useAuth } from './AuthContext'
import { AnswerProvider } from './AnswerContext'
import { IDLE, answerReducer } from './answerState'

// Existing imports of keyOf from here keep working.
export { keyOf } from './resultKey'

/** How long a "no answer model" reply is trusted before a search refreshes it. */
const READINESS_RECHECK_MS = 30_000
/** How long the first search waits for the first "can the backend answer?" check. */
const FIRST_CHECK_WAIT_MS = 1000

interface SearchContextValue {
  query: string
  setQuery: (query: string) => void
  response: SearchResponse | null
  selected: SearchHit | null
  select: (hit: SearchHit | null) => void
  topK: number
  setTopK: (topK: number) => void
  language: string
  setLanguage: (language: string) => void
  /** Regular users: their own documents, public ones, or both. */
  scope: SearchScope
  setScope: (scope: SearchScope) => void
  /** Admins: '' for everyone, 'library', or a user id. */
  owner: string
  setOwner: (owner: string) => void
  /** Admins: '' for either. */
  visibility: Visibility | ''
  setVisibility: (visibility: Visibility | '') => void
  busy: boolean
  error: string | null
  run: (query: string) => Promise<void>
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function SearchProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [selected, setSelected] = useState<SearchHit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The settings are the starting point, not a binding: changing the control on the
  // search page must not be undone by a later settings read.
  const [topK, setTopK] = useState(settings.resultsPerSearch)
  const [language, setLanguage] = useState(settings.defaultLanguage)
  const [scope, setScope] = useState<SearchScope>('all')
  const [owner, setOwner] = useState('')
  const [visibility, setVisibility] = useState<Visibility | ''>('')

  const [answer, dispatch] = useReducer(answerReducer, IDLE)

  // The ask in flight, and a counter so a superseded run never writes state.
  const controllerRef = useRef<AbortController | null>(null)
  const runRef = useRef(0)

  // Whether the backend can answer, as last heard. A search never waits for it: it uses
  // what is known and, when a "no" (or nothing) is older than 30 s, refreshes it in the
  // background for the next search. Starting the model later needs no reload, and a
  // model that stops is noticed from the ask itself (see markUnavailable).
  //
  // The one exception is the very first check: a results link opened in a new tab
  // searches at once, before the check can answer, and would never get an answer box.
  // That first search waits for it, but at most FIRST_CHECK_WAIT_MS.
  const readinessRef = useRef({ available: false, checkedAt: 0, pending: false })
  const firstCheck = useRef<Promise<void> | null>(null)

  const refreshReadiness = useCallback(() => {
    if (readinessRef.current.pending) return
    readinessRef.current = { ...readinessRef.current, pending: true }
    const check = fetchReadiness()
      .then((readiness) => readiness?.answers_available === true)
      .catch(() => false)
      .then((available) => {
        readinessRef.current = { available, checkedAt: Date.now(), pending: false }
      })
    if (readinessRef.current.checkedAt === 0) firstCheck.current = check
  }, [])

  const markUnavailable = useCallback(() => {
    readinessRef.current = { ...readinessRef.current, available: false, checkedAt: Date.now() }
  }, [])

  const answersEnabled = settings.answersEnabled
  useEffect(() => {
    if (answersEnabled && readinessRef.current.checkedAt === 0) refreshReadiness()
  }, [answersEnabled, refreshReadiness])

  // Leaving the signed-in app (logging out) must not leave a model writing.
  // A run still deciding whether to ask is superseded too, so it never searches after.
  useEffect(
    () => () => {
      controllerRef.current?.abort()
      runRef.current++
    },
    [],
  )

  const shouldAsk = useCallback(async (): Promise<boolean> => {
    if (!answersEnabled) return false
    const first = firstCheck.current
    if (first) {
      // Once: a check that never answers must not slow every later search.
      firstCheck.current = null
      let timer = 0
      await Promise.race([
        first,
        new Promise((resolve) => {
          timer = window.setTimeout(resolve, FIRST_CHECK_WAIT_MS)
        }),
      ])
      window.clearTimeout(timer)
    }
    const known = readinessRef.current
    if (known.available) return true
    if (Date.now() - known.checkedAt >= READINESS_RECHECK_MS) refreshReadiness()
    return false
  }, [answersEnabled, refreshReadiness])

  const run = useCallback(
    async (nextQuery: string) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const runId = ++runRef.current
      const current = () => runRef.current === runId

      setQuery(nextQuery)
      setBusy(true)
      dispatch({ type: 'reset' })

      const params: SearchParams = {
        query: nextQuery,
        topK,
        ...(language ? { language } : {}),
        ...(scope !== 'all' ? { scope } : {}),
        // The backend ignores these for anyone but an admin.
        ...(owner ? { ownerId: owner } : {}),
        ...(visibility ? { visibility } : {}),
      }

      function showResults(result: SearchResponse) {
        setResponse(result)
        // The detail panel slides in when the reader picks a result, never by itself.
        setSelected(null)
        setError(null)
        setBusy(false)
      }

      try {
        const asking = await shouldAsk()
        if (!current()) return
        if (asking) {
          let gotResults = false
          try {
            await ask(
              params,
              {
                onResults: (result) => {
                  if (!current()) return
                  gotResults = true
                  showResults(result)
                  dispatch({ type: 'results' })
                },
                onSources: (sources) => {
                  if (current()) dispatch({ type: 'sources', sources })
                },
                onDelta: (text) => {
                  if (current()) dispatch({ type: 'delta', text })
                },
                onDone: (done) => {
                  if (current()) dispatch({ type: 'done', done })
                },
                onError: (failure) => {
                  if (!current()) return
                  // The model server went away: plain searches until readiness says
                  // otherwise, rather than an error panel on every search.
                  if (failure.code === 'unavailable') markUnavailable()
                  dispatch({ type: 'error', message: failure.message })
                },
              },
              controller.signal,
            )
            return
          } catch (caught) {
            if (!current()) return
            if (gotResults) {
              // A handler or the stream failed after the list was shown: keep the list.
              dispatch({
                type: 'error',
                message: caught instanceof Error ? caught.message : 'The answer failed.',
              })
              return
            }
            // No results yet (offline, an older backend without /api/ask, a 503): a
            // plain search still gets the reader their passages. Do not try asking
            // again until a readiness check says it can.
            markUnavailable()
            dispatch({ type: 'reset' })
          }
        }
        if (!current()) return

        const result = await search(params)
        if (current()) showResults(result)
      } catch (caught) {
        if (!current()) return
        setError(caught instanceof Error ? caught.message : 'Search failed')
        setResponse(null)
        setSelected(null)
      } finally {
        if (current()) setBusy(false)
      }
    },
    [topK, language, scope, owner, visibility, shouldAsk, markUnavailable],
  )

  // Who is searching. Someone who must change their password reads as a visitor, as
  // the backend treats them.
  const { user } = useAuth()
  const who = user && !user.must_change_password ? user.user_id : null
  const lastWho = useRef(who)
  const latest = useRef({ run, query })
  useEffect(() => {
    latest.current = { run, query }
  })
  useEffect(() => {
    if (lastWho.current === who) return
    lastWho.current = who
    const { run: runNow, query: current } = latest.current
    if (current) void runNow(current)
  }, [who])

  const stopAnswer = useCallback(() => {
    controllerRef.current?.abort()
    dispatch({ type: 'stop' })
  }, [])

  const value = useMemo<SearchContextValue>(
    () => ({
      query,
      setQuery,
      response,
      selected,
      select: setSelected,
      topK,
      setTopK,
      language,
      setLanguage,
      scope,
      setScope,
      owner,
      setOwner,
      visibility,
      setVisibility,
      busy,
      error,
      run,
    }),
    [query, response, selected, topK, language, scope, owner, visibility, busy, error, run],
  )

  return (
    <SearchContext.Provider value={value}>
      <AnswerProvider state={answer} stopAnswer={stopAnswer} results={response?.results}>
        {children}
      </AnswerProvider>
    </SearchContext.Provider>
  )
}

export function useSearchContext(): SearchContextValue {
  const value = useContext(SearchContext)
  if (!value) throw new Error('useSearchContext must be used inside a SearchProvider')
  return value
}
