import { z } from 'zod'
import { decodeWebmToPcm, isFfmpegAvailable } from '../analysis/decode.js'
import { analyzePcm } from '../analysis/pcmAnalyzer.js'

// Base64 accepts MP3, WAV, M4A, WebM, etc.; ffmpeg auto-detects the format.
// A small upload cap prevents accidental multi-hundred-MB requests.
const MAX_BYTES = 12 * 1024 * 1024
export const analyzeRecordingSchema = {
  audio_base64: z.string().min(4).max(Math.ceil(MAX_BYTES * 4 / 3) + 16)
    .describe('Base64-encoded audio file (MP3, WAV, M4A, WebM), maximum 12 MiB decoded'),
  label: z.string().max(120).optional().describe('Optional recording label'),
}

export async function analyzeRecordingHandler(args: { audio_base64: string; label?: string }) {
  if (!(await isFfmpegAvailable())) {
    return { isError: true, content: [{ type: 'text' as const, text: 'ffmpeg is required for recording analysis.' }] }
  }
  const data = args.audio_base64
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    return { isError: true, content: [{ type: 'text' as const, text: 'Invalid base64 audio.' }] }
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return { isError: true, content: [{ type: 'text' as const, text: 'Audio must be between 1 byte and 12 MiB.' }] }
  }
  try {
    const decoded = await decodeWebmToPcm(bytes)
    const report = analyzePcm(decoded.samples, decoded.sampleRate)
    const safeReport = JSON.parse(JSON.stringify(report, (_key, value) =>
      typeof value === 'number' && !Number.isFinite(value) ? null : value))
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ label: args.label ?? null, report: safeReport }) }],
    }
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: 'Unable to decode recording: ' + (error instanceof Error ? error.message : String(error)) }] }
  }
}
