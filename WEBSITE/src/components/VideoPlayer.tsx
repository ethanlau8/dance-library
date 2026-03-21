import { forwardRef, useEffect, useRef, useState, useCallback } from 'react'

interface TimestampMarker {
  time: number
}

interface VideoPlayerProps {
  src: string
  poster?: string
  initialPosition?: number
  timestampMarkers: TimestampMarker[]
  onTimeUpdate?: (currentTime: number) => void
  onPause?: (currentTime: number) => void
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer(
  { src, poster, initialPosition, timestampMarkers, onTimeUpdate, onPause },
  ref
) {
  const internalRef = useRef<HTMLVideoElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoHeightRef = useRef<number>(0)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSticky, setIsSticky] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasSeekedRef = useRef(false)

  // Combine forwarded ref and internal ref
  const videoEl = (typeof ref === 'function' ? internalRef : ref) || internalRef
  const getVideo = useCallback(() => {
    if (typeof ref === 'function') return internalRef.current
    return (ref?.current ?? internalRef.current)
  }, [ref])

  // Set forwarded ref
  useEffect(() => {
    if (typeof ref === 'function') {
      ref(internalRef.current)
    }
  }, [ref])

  // Capture initial video height for spacer
  useEffect(() => {
    if (containerRef.current) {
      videoHeightRef.current = containerRef.current.offsetHeight
    }
  })

  // Sticky behavior via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting)
      },
      { threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  // Auto-hide controls after 3 seconds
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false)
    }, 3000)
  }, [playing])

  useEffect(() => {
    if (!playing) {
      setShowControls(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    } else {
      resetHideTimer()
    }
  }, [playing, resetHideTimer])

  function handleLoadedMetadata() {
    const video = getVideo()
    if (!video) return
    setDuration(video.duration)
    videoHeightRef.current = containerRef.current?.offsetHeight ?? 0

    if (initialPosition && initialPosition > 0 && !hasSeekedRef.current) {
      video.currentTime = initialPosition
      hasSeekedRef.current = true
    }
  }

  function handleTimeUpdate() {
    const video = getVideo()
    if (!video) return
    setCurrentTime(video.currentTime)
    onTimeUpdate?.(video.currentTime)
  }

  function handlePlay() {
    setPlaying(true)
  }

  function handlePause() {
    setPlaying(false)
    const video = getVideo()
    if (video) onPause?.(video.currentTime)
  }

  function handleEnded() {
    setPlaying(false)
  }

  function togglePlayPause() {
    const video = getVideo()
    if (!video) return
    if (video.paused) {
      video.play()
    } else {
      video.pause()
    }
    resetHideTimer()
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const video = getVideo()
    if (!video || duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientX - rect.left) / rect.width
    video.currentTime = Math.max(0, Math.min(duration, fraction * duration))
    resetHideTimer()
  }

  function handleControlsClick() {
    resetHideTimer()
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <>
      {/* Sentinel for IntersectionObserver */}
      <div ref={sentinelRef} className="h-0" />

      {/* Spacer when sticky to prevent layout shift */}
      {isSticky && <div style={{ height: videoHeightRef.current }} />}

      {/* Video container */}
      <div
        ref={containerRef}
        className={
          isSticky
            ? 'fixed top-14 left-0 right-0 z-20 bg-black transition-all duration-300'
            : 'relative w-full bg-black'
        }
        style={isSticky ? { maxHeight: '200px' } : undefined}
        onClick={handleControlsClick}
      >
        <video
          ref={videoEl as React.RefObject<HTMLVideoElement>}
          src={src}
          poster={poster}
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          className={`w-full ${isSticky ? 'max-h-[200px] object-contain' : 'aspect-video object-contain'}`}
        />

        {/* Custom controls overlay */}
        <div
          className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-200 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Play/pause tap area */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause() }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {!playing && (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50">
                <svg className="h-7 w-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
          </button>

          {/* Bottom controls bar */}
          <div className="bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-8">
            {/* Seekbar */}
            <div
              className="relative mb-2 h-4 cursor-pointer flex items-center"
              onClick={(e) => { e.stopPropagation(); handleSeek(e) }}
            >
              {/* Track background */}
              <div className="absolute left-0 right-0 h-1 rounded-full bg-white/30" />
              {/* Progress fill */}
              <div
                className="absolute left-0 h-1 rounded-full bg-white"
                style={{ width: `${progress}%` }}
              />
              {/* Timestamp markers */}
              {duration > 0 &&
                timestampMarkers.map((marker, i) => (
                  <div
                    key={i}
                    className="absolute top-1/2 -translate-y-1/2 h-2.5 w-1 rounded-sm bg-yellow-400"
                    style={{ left: `${(marker.time / duration) * 100}%` }}
                  />
                ))}
            </div>

            {/* Time display */}
            <div className="flex items-center justify-between text-xs text-white/80">
              <span className="font-mono">{formatTime(currentTime)}</span>
              <span className="font-mono">{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})

export default VideoPlayer
