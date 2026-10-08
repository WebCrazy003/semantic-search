// frontend/src/components/DocSageMark.tsx
const BLUE = '#82B1FF'

/**
 * The DocSage mark, drawn rather than loaded: a magnifier whose lens holds a speech
 * bubble — searching, and an answer.
 *
 * Inline SVG so it stays sharp at any size and needs no network. The viewBox is cropped
 * to the artwork so it fills its box. `public/favicon.svg` carries the same artwork for
 * the browser tab.
 */
export function DocSageMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="86 82 340 340"
      className="docsage-mark"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <g fill={BLUE}>
        <line x1="308.85" y1="304.85" x2="402" y2="398" stroke={BLUE} strokeWidth="44" />
        <circle cx="402" cy="398" r="22" />
        <circle cx="224" cy="220" r="120" fill="none" stroke={BLUE} strokeWidth="32" />
        <path d="M192 248 L182 296 L236 248 Z" />
        <path
          fillRule="evenodd"
          d="M186 171 H262 a28 28 0 0 1 28 28 V229 a28 28 0 0 1 -28 28 H186 a28 28 0 0 1 -28 -28 V199 a28 28 0 0 1 28 -28 Z M182.5 214 a9.5 9.5 0 1 0 19 0 a9.5 9.5 0 1 0 -19 0 Z M214.5 214 a9.5 9.5 0 1 0 19 0 a9.5 9.5 0 1 0 -19 0 Z M246.5 214 a9.5 9.5 0 1 0 19 0 a9.5 9.5 0 1 0 -19 0 Z"
        />
      </g>
    </svg>
  )
}
