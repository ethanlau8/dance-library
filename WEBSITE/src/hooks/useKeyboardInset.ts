import { useEffect, useState } from 'react'

/**
 * Height in pixels that the on-screen keyboard currently covers at the bottom of
 * the window.
 *
 * Bottom sheets are `position: fixed; bottom: 0`, which anchors them to the
 * *layout* viewport. When the keyboard opens, browsers either:
 *
 *   - shrink the layout viewport too (`interactive-widget=resizes-content`,
 *     honoured by Chrome) — the sheet lifts on its own and this returns ~0; or
 *   - shrink only the *visual* viewport (Safari, and the default elsewhere) —
 *     the sheet stays put and the keyboard covers it.
 *
 * `innerHeight - (visualViewport.height + offsetTop)` is zero in the first case
 * and the keyboard height in the second, so the same expression works for both
 * and never double-counts.
 *
 * Returns 0 when there is no keyboard, no visualViewport support, or the
 * computed inset is too small to be a keyboard (pinch-zoom, elastic scroll).
 */

// Below this an inset is browser chrome or overscroll rubber-banding, not a keyboard.
const MIN_KEYBOARD_PX = 120

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function update() {
      const viewport = window.visualViewport
      if (!viewport) return
      const covered = window.innerHeight - (viewport.height + viewport.offsetTop)
      setInset(covered > MIN_KEYBOARD_PX ? Math.round(covered) : 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
