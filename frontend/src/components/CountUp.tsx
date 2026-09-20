// frontend/src/components/CountUp.tsx
import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  /** Milliseconds to travel from the old value to the new one. */
  duration?: number
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * Animates between two numbers so a passage count that jumps by a batch reads as
 * counting up rather than flickering. The exact number is always reached: the
 * animation only decides what is shown on the way there.
 */
export function CountUp({ value, duration = 400 }: Props) {
  const [shown, setShown] = useState(value)
  const frame = useRef<number | undefined>(undefined)
  const from = useRef(value)

  useEffect(() => {
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
    if (reduced || from.current === value) {
      from.current = value
      setShown(value)
      return
    }

    const start = performance.now()
    const origin = from.current
    const distance = value - origin

    function step(now: number) {
      const progress = Math.min(1, (now - start) / duration)
      // easeOutCubic: quick at first, settling at the end.
      const eased = 1 - (1 - progress) ** 3
      setShown(Math.round(origin + distance * eased))
      if (progress < 1) {
        frame.current = requestAnimationFrame(step)
      } else {
        from.current = value
      }
    }

    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      from.current = value
    }
  }, [value, duration])

  return <span className="count">{shown.toLocaleString()}</span>
}
