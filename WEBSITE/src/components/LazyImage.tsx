import { useEffect, useRef, useState } from 'react'

interface LazyImageProps {
  src: string
  alt: string
  className?: string
}

/**
 * Lazy-mounts/unmounts an <img> based on viewport proximity.
 * When the element is far from the viewport, only a lightweight
 * placeholder div is rendered, keeping memory usage bounded
 * regardless of how many items are in the list.
 */
export default function LazyImage({ src, alt, className }: LazyImageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting)
      },
      // Generous margin: start loading 600px before entering viewport,
      // keep loaded until 600px after leaving. Prevents flicker during
      // normal scroll speeds.
      { rootMargin: '600px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={className}>
      {visible ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gray-200" />
      )}
    </div>
  )
}
