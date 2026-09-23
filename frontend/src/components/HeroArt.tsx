// frontend/src/components/HeroArt.tsx
/**
 * The hero illustration: a stack of documents with a magnifier over the passage that
 * matched. Inline SVG rather than an image file, because the app has to render with no
 * network at all — and because drawing it with `currentColor` and the accent token means
 * it themes with light and dark instead of needing two exported assets.
 */
export function HeroArt({ accent }: { accent: string }) {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 320 240"
      role="img"
      aria-label="A stack of documents with a magnifier over a highlighted passage"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="hero-page" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {/* Two pages behind, fanned out, to read as a collection rather than one file. */}
      <g stroke="currentColor" strokeOpacity="0.25" fill="url(#hero-page)">
        <rect x="52" y="34" width="150" height="180" rx="10" transform="rotate(-8 127 124)" />
        <rect x="74" y="28" width="150" height="180" rx="10" transform="rotate(-3 149 118)" />
      </g>

      {/* The front page, with lines of text. */}
      <rect
        x="92"
        y="24"
        width="150"
        height="184"
        rx="10"
        fill="url(#hero-page)"
        stroke="currentColor"
        strokeOpacity="0.45"
      />

      <g stroke="currentColor" strokeOpacity="0.32" strokeWidth="6" strokeLinecap="round">
        <line x1="110" y1="52" x2="196" y2="52" />
        <line x1="110" y1="70" x2="224" y2="70" />
        <line x1="110" y1="88" x2="208" y2="88" />
        <line x1="110" y1="150" x2="224" y2="150" />
        <line x1="110" y1="168" x2="186" y2="168" />
      </g>

      {/* The matched passage, in the accent colour: the whole point of the tool. */}
      <g stroke={accent} strokeWidth="6" strokeLinecap="round">
        <line x1="110" y1="112" x2="224" y2="112" />
        <line x1="110" y1="130" x2="200" y2="130" />
      </g>
      <rect
        x="102"
        y="100"
        width="132"
        height="44"
        rx="6"
        fill={accent}
        fillOpacity="0.12"
        stroke={accent}
        strokeOpacity="0.45"
      />

      {/* The magnifier. */}
      <g stroke={accent} strokeWidth="8" fill="none" strokeLinecap="round">
        <circle cx="206" cy="150" r="38" fill="var(--hero-lens)" fillOpacity="0.55" />
        <line x1="234" y1="178" x2="266" y2="210" />
      </g>
    </svg>
  )
}
