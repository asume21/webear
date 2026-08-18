import { spawn } from 'child_process'

/**
 * WebM/Opus → mono PCM, via ffmpeg on the user's PATH.
 *
 * Lives here rather than inside a tool because MORE THAN ONE tool needs it:
 * diff_audio decoded locally from day one while analyze_audio uploaded the same
 * bytes to a server to compute the same numbers. Two copies of this function
 * would have been the obvious next step, and then they would have drifted.
 */

export const DECODE_SAMPLE_RATE = 44100

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: number
}

/** True when ffmpeg can be spawned — decides whether local analysis is possible. */
export async function isFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const ff = spawn('ffmpeg', ['-version'])
      ff.on('error', () => done(false))
      ff.on('close', (code) => done(code === 0))
      ff.stdout?.on('data', () => {})
      ff.stderr?.on('data', () => {})
    } catch {
      done(false)
    }
  })
}

export async function decodeWebmToPcm(webmBuffer: Buffer): Promise<DecodedAudio> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 'f32le',
      '-ac', '1',
      '-ar', String(DECODE_SAMPLE_RATE),
      'pipe:1',
    ])
    const chunks: Buffer[] = []
    ff.stdout.on('data', (c: Buffer) => chunks.push(c))
    ff.stderr.on('data', () => {})
    ff.stdout.on('end', () => {
      const combined = Buffer.concat(chunks)
      if (combined.byteLength === 0) {
        reject(new Error('ffmpeg produced no audio — the capture may be empty or not decodable'))
        return
      }
      resolve({
        samples: new Float32Array(
          combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength),
        ),
        sampleRate: DECODE_SAMPLE_RATE,
      })
    })
    ff.on('error', reject)
    ff.stdin.on('error', () => { /* ffmpeg exited early; the close handler reports it */ })
    ff.stdin.write(webmBuffer)
    ff.stdin.end()
  })
}
