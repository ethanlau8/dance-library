import { useEffect, type ReactNode } from 'react'
import { useKeyboardInset } from '../hooks/useKeyboardInset'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Rendered opposite the title in the header — e.g. a "Done" or "Clear" button. */
  headerAction?: ReactNode
  /** Pinned below the header, above the scroll area — e.g. a search field. */
  subheader?: ReactNode
  /** Pinned below the scroll area — e.g. an "Apply" button. */
  footer?: ReactNode
  children: ReactNode
  /** Desktop dialog width. */
  size?: 'md' | 'lg'
  /** `nested` raises the sheet above another already-open sheet. */
  layer?: 'base' | 'nested'
  /** Set false while a destructive action is in flight. */
  dismissible?: boolean
}

const SIZE_CLASS = {
  md: 'lg:max-w-md',
  lg: 'lg:max-w-lg',
} as const

const LAYER_CLASS = {
  base: { backdrop: 'z-40', sheet: 'z-50' },
  nested: { backdrop: 'z-50', sheet: 'z-[60]' },
} as const

/**
 * Mobile bottom sheet that becomes a centered dialog at `lg`.
 *
 * Sheets are bottom-anchored, so the on-screen keyboard would otherwise cover
 * their contents — the two most-used fields in this app (tag search, category
 * name) sit right where the keyboard lands. `useKeyboardInset` lifts the sheet
 * by the covered height and shrinks its max height to match, so the whole sheet
 * stays reachable with the keyboard up.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  headerAction,
  subheader,
  footer,
  children,
  size = 'lg',
  layer = 'base',
  dismissible = true,
}: BottomSheetProps) {
  const keyboardInset = useKeyboardInset()

  useEffect(() => {
    if (!open || !dismissible) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, dismissible, onClose])

  if (!open) return null

  const z = LAYER_CLASS[layer]

  return (
    <>
      <div
        className={`fixed inset-0 ${z.backdrop} bg-black/40`}
        onClick={() => dismissible && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`fixed inset-x-0 bottom-0 ${z.sheet} flex flex-col rounded-t-2xl bg-white shadow-xl lg:inset-0 lg:m-auto lg:h-fit lg:rounded-2xl ${SIZE_CLASS[size]}`}
        style={{
          // Only override `bottom` when a keyboard is actually up, so the
          // desktop `lg:inset-0` + `m-auto` centering is left intact.
          ...(keyboardInset > 0 ? { bottom: keyboardInset } : null),
          maxHeight: `calc(100dvh - 3rem - ${keyboardInset}px)`,
        }}
      >
        {/* Drag handle (mobile only) */}
        <div className="flex shrink-0 justify-center py-2 lg:hidden">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {(title || headerAction) && (
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 lg:pt-4">
            {typeof title === 'string' ? (
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            ) : (
              title
            )}
            {headerAction}
          </div>
        )}

        {subheader && <div className="shrink-0">{subheader}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>

        {footer && <div className="shrink-0 border-t border-gray-100">{footer}</div>}
      </div>
    </>
  )
}
