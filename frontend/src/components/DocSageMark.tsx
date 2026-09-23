// frontend/src/components/DocSageMark.tsx
/**
 * The DocSage mark, drawn rather than loaded: a document behind a privacy shield, read
 * through a magnifier whose lens holds a small graph — the meaning in the text rather
 * than the words.
 *
 * Inline SVG so it stays sharp at any size, works on the dark header bar where the
 * raster logo's white background would not, and needs no network. `public/favicon.svg`
 * carries the same artwork for the browser tab.
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
      <defs>
        <linearGradient id="ds-page" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dbeafe" />
          <stop offset="100%" stopColor="#a9ccf6" />
        </linearGradient>
        <linearGradient id="ds-shield" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4cb87f" />
          <stop offset="100%" stopColor="#2f9b86" />
        </linearGradient>
      </defs>

      {/* The document, with a folded corner. */}
      <path
        d="M18 6h20l10 10v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z"
        fill="url(#ds-page)"
      />
      <path d="M38 6l10 10H40a2 2 0 0 1-2-2V6z" fill="#7fb3ea" />
      <g stroke="#5b8fd0" strokeWidth="3" strokeLinecap="round" opacity="0.75">
        <line x1="21" y1="19" x2="34" y2="19" />
        <line x1="21" y1="26" x2="37" y2="26" />
        <line x1="21" y1="33" x2="31" y2="33" />
      </g>

      {/* The privacy shield: nothing leaves this machine. */}
      <path
        d="M14 26l10-4 10 4v12c0 7-4.4 12.2-10 14.5C18.4 50.2 14 45 14 38V26z"
        fill="url(#ds-shield)"
      />
      <g fill="#ffffff">
        <rect x="19.5" y="35" width="9" height="8" rx="1.6" />
        <path
          d="M21.5 35v-2.5a2.5 2.5 0 0 1 5 0V35"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2"
        />
      </g>

      {/* The lens, holding a graph rather than a letter. */}
      <circle cx="41" cy="35" r="14" fill="#ffffff" />
      <circle cx="41" cy="35" r="14" fill="none" stroke="#1b5fa8" strokeWidth="4.5" />
      <g stroke="#3aa0e8" strokeWidth="2.2">
        <line x1="41" y1="27.5" x2="34.5" y2="34" />
        <line x1="41" y1="27.5" x2="47.5" y2="34" />
        <line x1="34.5" y1="34" x2="41" y2="42" />
        <line x1="47.5" y1="34" x2="41" y2="42" />
      </g>
      <circle cx="41" cy="27.5" r="3" fill="#2196f3" />
      <circle cx="34.5" cy="34" r="3" fill="#3aa76d" />
      <circle cx="47.5" cy="34" r="3" fill="#2196f3" />
      <circle cx="41" cy="42" r="3" fill="#3aa76d" />

      <line
        x1="51"
        y1="45"
        x2="58"
        y2="52"
        stroke="#1b4a7a"
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* Rays: the moment of finding it. */}
      <g stroke="#3fb98b" strokeWidth="3" strokeLinecap="round">
        <line x1="53" y1="14" x2="57.5" y2="9.5" />
        <line x1="56" y1="22" x2="61.5" y2="19.5" />
      </g>
    </svg>
  )
}
