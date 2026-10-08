// frontend/src/components/DocSageMark.tsx
const TILE = '#101b2d'
const TEAL = '#1cc4a5'
const PAPER = '#f1f5fa'
const TEXT = '#a3b1c6'

/**
 * The DocSage mark, drawn rather than loaded: a document read through a magnifier whose
 * lens holds a small graph — the meaning in the text rather than the words.
 *
 * Inline SVG so it stays sharp at any size and needs no network. It carries its own
 * dark tile, so it reads the same on the dark header bar and on a light card.
 * `public/favicon.svg` carries the same artwork, square-cornered, for the browser tab.
 */
export function DocSageMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="docsage-mark"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <rect width="64" height="64" rx="12" fill={TILE} />

      {/* The document, with a folded corner and lines of text, one of them found. */}
      <path
        d="M20.8 11.1h16.3l8.3 8.3v28.9a3.5 3.5 0 0 1-3.5 3.5H20.8a3.5 3.5 0 0 1-3.5-3.5V14.6a3.5 3.5 0 0 1 3.5-3.5z"
        fill={PAPER}
      />
      <path d="M37.1 11.1l8.3 8.3h-5.3a3 3 0 0 1-3-3v-5.3z" fill="#c5d0dc" />
      <g strokeWidth="1.7" strokeLinecap="round">
        <line x1="22.8" y1="24.3" x2="35.1" y2="24.3" stroke={TEXT} />
        <line x1="22.8" y1="29.4" x2="39.6" y2="29.4" stroke={TEAL} />
        <line x1="22.8" y1="34.3" x2="30.4" y2="34.3" stroke={TEXT} />
        <line x1="22.8" y1="39.2" x2="27" y2="39.2" stroke={TEXT} />
        <line x1="22.8" y1="44.3" x2="26.4" y2="44.3" stroke={TEXT} />
      </g>

      {/* The lens, set off from the page by a ring of the tile colour. */}
      <circle cx="42" cy="42.9" r="11.8" fill={TILE} />
      <line
        x1="49.9"
        y1="50.9"
        x2="54.6"
        y2="55.4"
        stroke={TEAL}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="42" cy="42.9" r="9.6" fill={TILE} stroke={TEAL} strokeWidth="2.6" />

      {/* A graph rather than a letter. */}
      <path
        d="M42 38.8l-4.05 5.8h7.45z"
        fill="none"
        stroke={PAPER}
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <g fill={TEAL}>
        <circle cx="42" cy="38.8" r="1.35" />
        <circle cx="37.95" cy="44.6" r="1.35" />
        <circle cx="45.4" cy="44.6" r="1.35" />
      </g>
    </svg>
  )
}
