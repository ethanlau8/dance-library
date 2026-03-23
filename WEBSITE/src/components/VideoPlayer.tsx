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
  disableSticky?: boolean
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer(
  { src, poster, initialPosition, timestampMarkers, onTimeUpdate, onPause, disableSticky = false },
  ref
) {
  const internalRef = useRef<HTMLVideoElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const seekbarRef = useRef<HTMLDivElement>(null)
  const videoHeightRef = useRef<number>(0)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSticky, setIsSticky] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
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

  // Sticky behavior via IntersectionObserver (disabled on desktop where CSS sticky is used)
  useEffect(() => {
    if (disableSticky) {
      setIsSticky(false)
      return
    }
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
  }, [disableSticky])

  // Track fullscreen changes
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
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

  function skipForward() {
    const video = getVideo()
    if (!video) return
    video.currentTime = Math.min(duration, video.currentTime + 10)
    resetHideTimer()
  }

  function skipBack() {
    const video = getVideo()
    if (!video) return
    video.currentTime = Math.max(0, video.currentTime - 10)
    resetHideTimer()
  }

  // Drag-to-seek via pointer events
  function seekFromPointerEvent(e: React.PointerEvent<HTMLDivElement> | PointerEvent) {
    const video = getVideo()
    const bar = seekbarRef.current
    if (!video || !bar || duration === 0) return
    const rect = bar.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    video.currentTime = fraction * duration
    setCurrentTime(fraction * duration)
  }

  function handleSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    setIsSeeking(true)
    seekFromPointerEvent(e)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resetHideTimer()
  }

  function handleSeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSeeking) return
    e.stopPropagation()
    seekFromPointerEvent(e)
  }

  function handleSeekPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSeeking) return
    e.stopPropagation()
    setIsSeeking(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    resetHideTimer()
  }

  // Fullscreen toggle
  function toggleFullscreen() {
    const container = containerRef.current
    const video = getVideo()
    if (!container) return

    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else if ((document as any).webkitFullscreenElement) {
      ;(document as any).webkitExitFullscreen()
    } else if (container.requestFullscreen) {
      container.requestFullscreen()
    } else if ((container as any).webkitRequestFullscreen) {
      ;(container as any).webkitRequestFullscreen()
    } else if (video && (video as any).webkitEnterFullscreen) {
      // iOS Safari fallback — fullscreen on the video element itself
      ;(video as any).webkitEnterFullscreen()
    }
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
          className={`w-full ${
            isFullscreen
              ? 'h-full w-full object-contain'
              : isSticky
                ? 'max-h-[200px] object-contain'
                : 'aspect-video object-contain'
          }`}
        />

        {/* Custom controls overlay */}
        <div
          className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-200 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Center controls: skip back, play/pause, skip forward */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-8">
              {/* Skip back 10s */}
              <button
                onClick={(e) => { e.stopPropagation(); skipBack() }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50"
              >
                <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                  <text x="10" y="15.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">10</text>
                </svg>
              </button>

              {/* Play/pause */}
              <button
                onClick={(e) => { e.stopPropagation(); togglePlayPause() }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50"
              >
                {playing ? (
                  <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="h-7 w-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Skip forward 10s */}
              <button
                onClick={(e) => { e.stopPropagation(); skipForward() }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50"
              >
                <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z" />
                  <text x="13" y="15.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill="currentColor" fontFamily="sans-serif">10</text>
                </svg>
              </button>
            </div>
          </div>

          {/* Tap area for showing/hiding controls (behind the buttons) */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause() }}
            className="absolute inset-0 -z-10"
            aria-label="Toggle play/pause"
          />

          {/* Bottom controls bar */}
          <div className="bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-8">
            {/* Seekbar */}
            <div
              ref={seekbarRef}
              className="relative mb-2 h-4 cursor-pointer flex items-center"
              style={{ touchAction: 'none' }}
              onPointerDown={handleSeekPointerDown}
              onPointerMove={handleSeekPointerMove}
              onPointerUp={handleSeekPointerUp}
              onPointerCancel={handleSeekPointerUp}
            >
              {/* Track background */}
              <div className="absolute left-0 right-0 h-1 rounded-full bg-white/30" />
              {/* Progress fill */}
              <div
                className="absolute left-0 h-1 rounded-full bg-white"
                style={{ width: `${progress}%` }}
              />
              {/* Seek thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-white shadow"
                style={{ left: `${progress}%` }}
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

            {/* Time display + fullscreen */}
            <div className="flex items-center justify-between text-xs text-white/80">
              <span className="font-mono">{formatTime(currentTime)} / {formatTime(duration)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
                className="p-1"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? (
                  <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})

export default VideoPlayer
