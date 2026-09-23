// frontend/src/settings/settings.ts
// UI preferences. These live in localStorage and nowhere else: they are never sent to
// the backend, never written to a cookie, and never leave this machine, which keeps the
// privacy promise in docs/user-spec.md §8 intact.

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Density = 'comfortable' | 'compact'
export type DetailView = 'auto' | 'drawer'
export type PreviewLines = 3 | 4 | 6

export interface UiSettings {
  theme: ThemeChoice
  accent: string
  density: Density
  resultsPerSearch: number
  defaultLanguage: string
  previewLines: PreviewLines
  detailView: DetailView
  highlightTerms: boolean
  animations: boolean
  showAdminLinks: boolean
}

export const ACCENTS: { value: string; label: string }[] = [
  { value: '#1677ff', label: 'Blue' },
  { value: '#13c2c2', label: 'Teal' },
  { value: '#722ed1', label: 'Purple' },
  { value: '#389e0d', label: 'Green' },
  { value: '#d4380d', label: 'Rust' },
]

export const TOP_K_CHOICES = [5, 10, 20, 50]

export const LANGUAGES = [
  { value: '', label: 'Any language' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'en', label: 'English' },
]

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'system',
  accent: ACCENTS[0].value,
  density: 'comfortable',
  resultsPerSearch: 10,
  defaultLanguage: '',
  previewLines: 3,
  detailView: 'auto',
  highlightTerms: true,
  animations: true,
  showAdminLinks: false,
}

export const STORAGE_KEY = 'semantic-search.ui.v1'

/** How tall a result card may be, per preview-line setting. See the spec, §3.2. */
export const CARD_MAX_HEIGHT: Record<PreviewLines, number> = { 3: 152, 4: 176, 6: 224 }

const THEMES: ThemeChoice[] = ['system', 'light', 'dark']
const DENSITIES: Density[] = ['comfortable', 'compact']
const DETAIL_VIEWS: DetailView[] = ['auto', 'drawer']
const PREVIEW_LINES: PreviewLines[] = [3, 4, 6]

function pick<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Every field is validated on the way in. A hand-edited, half-written or stale value
 * falls back to its default rather than breaking the app, so there is never a state
 * the user can only escape by clearing site data.
 */
export function coerceSettings(raw: unknown): UiSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
  const value = raw as Record<string, unknown>
  return {
    theme: pick(value.theme, THEMES, DEFAULT_SETTINGS.theme),
    accent: ACCENTS.some((entry) => entry.value === value.accent)
      ? (value.accent as string)
      : DEFAULT_SETTINGS.accent,
    density: pick(value.density, DENSITIES, DEFAULT_SETTINGS.density),
    resultsPerSearch: pick(value.resultsPerSearch, TOP_K_CHOICES, DEFAULT_SETTINGS.resultsPerSearch),
    defaultLanguage: pick(
      value.defaultLanguage,
      LANGUAGES.map((entry) => entry.value),
      DEFAULT_SETTINGS.defaultLanguage,
    ),
    previewLines: pick(value.previewLines, PREVIEW_LINES, DEFAULT_SETTINGS.previewLines),
    detailView: pick(value.detailView, DETAIL_VIEWS, DEFAULT_SETTINGS.detailView),
    highlightTerms: bool(value.highlightTerms, DEFAULT_SETTINGS.highlightTerms),
    animations: bool(value.animations, DEFAULT_SETTINGS.animations),
    showAdminLinks: bool(value.showAdminLinks, DEFAULT_SETTINGS.showAdminLinks),
  }
}

export function readSettings(): UiSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? coerceSettings(JSON.parse(stored)) : DEFAULT_SETTINGS
  } catch {
    // Private browsing, a disabled store, or malformed JSON. Defaults are always usable.
    return DEFAULT_SETTINGS
  }
}

export function writeSettings(settings: UiSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage being unavailable must not break the interaction that changed a setting.
  }
}
