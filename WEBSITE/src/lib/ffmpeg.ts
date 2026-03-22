import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loadPromise: Promise<void> | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg

  if (loadPromise) {
    await loadPromise
    return ffmpeg!
  }

  ffmpeg = new FFmpeg()

  loadPromise = (async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    await ffmpeg!.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
  })()

  await loadPromise
  return ffmpeg!
}

export async function generateThumbnail(
  file: File
): Promise<{ blob: Blob; dataUrl: string }> {
  const ff = await getFFmpeg()
  const inputName = 'input' + getExtension(file.name)

  await ff.writeFile(inputName, await fetchFile(file))

  // Extract a single frame at 1 second (falls back to first frame if video is shorter)
  await ff.exec([
    '-i', inputName,
    '-ss', '1',
    '-frames:v', '1',
    '-q:v', '2',
    'thumbnail.jpg',
  ])

  const data = await ff.readFile('thumbnail.jpg')
  // Clean up
  await ff.deleteFile(inputName)
  await ff.deleteFile('thumbnail.jpg')

  const uint8 = data as Uint8Array
  // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer TS issues
  const ab = new ArrayBuffer(uint8.byteLength)
  new Uint8Array(ab).set(uint8)
  const blob = new Blob([ab], { type: 'image/jpeg' })
  const dataUrl = URL.createObjectURL(blob)

  return { blob, dataUrl }
}

export async function extractRecordedDate(
  file: File
): Promise<string | null> {
  const ff = await getFFmpeg()
  const inputName = 'probe_input' + getExtension(file.name)

  await ff.writeFile(inputName, await fetchFile(file))

  // Collect log output to find creation_time
  let logOutput = ''
  const logHandler = ({ message }: { type: string; message: string }) => {
    logOutput += message + '\n'
  }
  ff.on('log', logHandler)

  try {
    // Use ffprobe to get format tags including creation_time
    await ff.ffprobe([
      '-v', 'quiet',
      '-print_format', 'default',
      '-show_entries', 'format_tags=creation_time',
      inputName,
      '-o', 'probe_output.txt',
    ])

    const probeData = await ff.readFile('probe_output.txt', 'utf8')
    await ff.deleteFile('probe_output.txt')
    await ff.deleteFile(inputName)

    const probeStr = typeof probeData === 'string' ? probeData : new TextDecoder().decode(probeData as Uint8Array)
    const match = probeStr.match(/creation_time=(.+)/)
    if (match) {
      const date = new Date(match[1].trim())
      if (!isNaN(date.getTime())) {
        return date.toISOString()
      }
    }
  } catch {
    // ffprobe might not be available - try reading from log output
    const match = logOutput.match(/creation_time\s*:\s*(.+)/)
    if (match) {
      const date = new Date(match[1].trim())
      if (!isNaN(date.getTime())) {
        return date.toISOString()
      }
    }
  } finally {
    ff.off('log', logHandler)
    // Clean up in case of error
    try { await ff.deleteFile(inputName) } catch { /* already deleted */ }
  }

  // Fallback: run exec with -i to get metadata from log output
  try {
    logOutput = ''
    const fallbackInput = 'probe_fallback' + getExtension(file.name)
    const logHandler2 = ({ message }: { type: string; message: string }) => {
      logOutput += message + '\n'
    }
    ff.on('log', logHandler2)

    await ff.writeFile(fallbackInput, await fetchFile(file))
    // Run ffmpeg -i which will output metadata to logs (and exit with error since no output)
    await ff.exec(['-i', fallbackInput, '-f', 'null', '-']).catch(() => {})
    await ff.deleteFile(fallbackInput).catch(() => {})
    ff.off('log', logHandler2)

    const match = logOutput.match(/creation_time\s*:\s*(.+)/)
    if (match) {
      const date = new Date(match[1].trim())
      if (!isNaN(date.getTime())) {
        return date.toISOString()
      }
    }
  } catch {
    // Best effort
  }

  return null
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.substring(dot) : ''
}
