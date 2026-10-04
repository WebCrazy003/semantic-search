// frontend/src/app/answerState.ts
// The answer streamed with a search, as one reducer: its parts always move together.

import type { AskDone, AskSources } from '../services/api'

/**
 * idle: no answer for this response (answers off, unavailable, or no search yet).
 * waiting: results are in, the first word is not. streaming: words are arriving.
 * done / not_found: finished. error: the answer failed; the results stay.
 * stopped: the reader pressed Stop.
 */
export type AnswerPhase =
  | { status: 'idle' }
  | { status: 'waiting' }
  | { status: 'streaming'; text: string }
  | { status: 'done'; text: string; meta: AskDone }
  | { status: 'not_found'; text: string; meta: AskDone }
  | { status: 'error'; text: string; message: string }
  | { status: 'stopped'; text: string }

export type AnswerStatus = AnswerPhase['status']

export interface AnswerState {
  phase: AnswerPhase
  /** Which results the [n] citations point at, and the answer's language. */
  sources: AskSources | null
}

export type AnswerAction =
  | { type: 'reset' }
  | { type: 'results' }
  | { type: 'sources'; sources: AskSources }
  | { type: 'delta'; text: string }
  | { type: 'done'; done: AskDone }
  | { type: 'error'; message: string }
  | { type: 'stop' }

export const IDLE: AnswerState = { phase: { status: 'idle' }, sources: null }

/** The answer written so far, exactly as streamed. */
export function textOf(phase: AnswerPhase): string {
  return 'text' in phase ? phase.text : ''
}

export function answerReducer(state: AnswerState, action: AnswerAction): AnswerState {
  const { phase } = state
  const writing = phase.status === 'waiting' || phase.status === 'streaming'
  const text = textOf(phase)
  switch (action.type) {
    case 'reset':
      return IDLE
    case 'results':
      return { phase: { status: 'waiting' }, sources: null }
    case 'sources':
      return phase.status === 'idle' ? state : { ...state, sources: action.sources }
    case 'delta':
      return writing
        ? { ...state, phase: { status: 'streaming', text: text + action.text } }
        : state
    case 'done':
      if (!writing) return state
      return {
        ...state,
        phase:
          action.done.status === 'not_found'
            ? { status: 'not_found', text, meta: action.done }
            : { status: 'done', text, meta: action.done },
      }
    case 'error':
      return phase.status === 'idle'
        ? state
        : { ...state, phase: { status: 'error', text, message: action.message } }
    case 'stop':
      return writing ? { ...state, phase: { status: 'stopped', text } } : state
  }
}
