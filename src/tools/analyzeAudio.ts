import { z } from 'zod';
import { waitForCapture } from '../client.js';
import { analyzePcm, type AudioAnalysisReport } from '../analysis/pcmAnalyzer.js';
import { decodeWebmToPcm, isFfmpegAvailable } from '../analysis/decode.js';

export const analyzeAudioSchema = {
  capture_id: z.string()
    .regex(/^[a-zA-Z0-9_-]{4,64}$/, 'capture_id must be 4–64 alphanumeric characters')
    .describe('The capture ID returned by capture_audio'),
};

const API_BASE = process.env.MCP_API_URL || 'https://www.codedswitch.com';
const API_KEY = process.env.CODEDSWITCH_API_KEY || '';

function log(msg: string) { process.stderr.write(`[webear] ${msg}\n`) }

/**
 * Signal analysis is PURE MATHS — RMS, peak, crest factor, spectral centroid,
 * band energy, onsets. It needs no account, no server and no inference, and
 * this package has shipped `analyzePcm` since day one.
 *
 * It was nonetheless gated behind an API key and the audio uploaded to compute
 * the same numbers, so a new user's first tool call answered "CODEDSWITCH_API_KEY
 * is not set" — after a six-step setup, before they had ever heard the thing
 * work. Nobody adopts a tool they have not seen do anything.
 *
 * Local first, therefore, whenever ffmpeg is present (diff_audio has decoded
 * that way from the start). The hosted API remains the fallback for machines
 * without ffmpeg. AI DESCRIPTION still needs a key — that one costs real
 * inference, and it is the fair place to draw the line.
 *
 * Local analysis also means the audio never leaves the machine, which matters
 * for anyone pointing this at unreleased work.
 */
export async function analyzeAudioHandler(args: { capture_id: string }) {
  let buffer: Buffer;
  try {
    buffer = await waitForCapture(args.capture_id, 5000);
  } catch {
    return {
      content: [{
        type: 'text' as const,
        text: `Capture "${args.capture_id}" not found. Run capture_audio first.`,
      }],
    };
  }

  // ── Free path: local, no key, no upload, no network ──
  // Deliberately BASIC. It proves the capture is real — the tool genuinely
  // heard your audio, this long, at this level — without handing over the
  // diagnostic dataset. Band energy, spectral centroid, crest factor, BPM and
  // onset timing are the numbers an LLM can reason a full mix critique from, so
  // they belong to the paid tier along with everything that requires listening.
  if (!API_KEY && await isFfmpegAvailable()) {
    try {
      const decoded = await decodeWebmToPcm(buffer);
      const report = analyzePcm(decoded.samples, decoded.sampleRate);
      return { content: [{ type: 'text' as const, text: formatBasicReport(report) }] };
    } catch (err: any) {
      log(`Local analysis failed (${err?.message ?? err})`);
    }
  }

  if (!API_KEY) {
    return {
      content: [{
        type: 'text' as const,
        text: [
          'Could not analyze. Either:',
          '',
          '  1. Install ffmpeg — https://ffmpeg.org/download.html',
          '     A basic analysis then runs on your machine, free, with no audio uploaded.',
          '',
          '  2. Or set CODEDSWITCH_API_KEY for the FULL analysis — https://www.codedswitch.com/developer',
        ].join('\n'),
      }],
    };
  }

  try {
    // Build multipart body manually for reliable Node.js compatibility
    const boundary = `----webear${Date.now()}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="capture.webm"\r\nContent-Type: audio/webm\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)]);

    const res = await fetch(`${API_BASE}/api/mcp/analyze`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Server returned ${res.status}: ${errText}`);
    }

    const { report } = await res.json() as any;
    return { content: [{ type: 'text' as const, text: formatReport(report) }] };
  } catch (err: any) {
    return {
      content: [{
        type: 'text' as const,
        text: `Analysis failed: ${err.message}`,
      }],
    };
  }
}

/**
 * The FREE report: proof of life, not a diagnosis.
 *
 * Duration and level demonstrate the capture really happened and really holds
 * your audio. Clipping is included because it is a yes/no fault a user would be
 * annoyed to have been charged to discover.
 *
 * Everything omitted here is omitted on purpose: hand over band energy, crest
 * factor and onset timing and any LLM can write the mix critique the paid tools
 * exist to sell.
 */
function formatBasicReport(report: AudioAnalysisReport): string {
  return [
    `── Audio Capture ─────────────────────`,
    `Duration:          ${report.durationSeconds.toFixed(2)}s`,
    `Loudness (RMS):    ${report.rmsDb.toFixed(1)} dBFS`,
    `Peak:              ${report.peakDb.toFixed(1)} dBFS`,
    `Clipping:          ${report.hasClipping ? `YES — ${report.clippingPercent.toFixed(2)}% of samples` : 'none'}`,
    ``,
    `Analyzed locally — no audio left this machine.`,
    ``,
    `── What the full version tells you ─────────────`,
    `  • What it actually SOUNDS like — instruments, genre, mood, what is wrong`,
    `  • Frequency balance, dynamics, tempo and timing accuracy`,
    `  • Mix coaching that references what it HEARS, not only what it measures`,
    `  • Before/after comparison across takes`,
    ``,
    `Free key, no card: https://www.codedswitch.com/developer`,
  ].join('\n');
}

/** One renderer for both the local and hosted reports, so they cannot drift. */
function formatReport(report: AudioAnalysisReport): string {
  return [
    `── Audio Analysis Report ──────────────────────────────`,
    `Duration:          ${report.durationSeconds.toFixed(2)}s`,
    ``,
    `── Loudness ─────────────────────────────────────────`,
    `RMS:               ${report.rmsDb.toFixed(1)} dBFS`,
    `Peak:              ${report.peakDb.toFixed(1)} dBFS`,
    `Dynamic range:     ${report.dynamicRangeDb.toFixed(1)} dB`,
    `Crest factor:      ${report.crestFactor.toFixed(2)}`,
    `Clipping:          ${report.hasClipping ? `YES — ${report.clippingPercent.toFixed(3)}% of samples` : 'none'}`,
    ``,
    `── Tone ──────────────────────────────────────────────`,
    `Spectral centroid: ${report.spectralCentroidHz.toFixed(0)} Hz`,
    `DC offset:         ${report.dcOffset.toFixed(5)} ${report.hasDcOffset ? '⚠ elevated' : '(ok)'}`,
    ``,
    `── Frequency Bands ───────────────────────────────────`,
    `Sub  (20-80 Hz):   ${(report.bandEnergy.sub     * 100).toFixed(1)}%`,
    `Bass (80-250 Hz):  ${(report.bandEnergy.bass    * 100).toFixed(1)}%`,
    `Mid  (250-2k Hz):  ${(report.bandEnergy.lowMid  * 100).toFixed(1)}%`,
    `Hi-mid (2-6k Hz):  ${(report.bandEnergy.highMid * 100).toFixed(1)}%`,
    `High (6k+ Hz):     ${(report.bandEnergy.high    * 100).toFixed(1)}%`,
    ``,
    `── Rhythm ────────────────────────────────────────────`,
    `Estimated BPM:     ${report.estimatedBpm ?? 'not detected'}`,
    `Onset count:       ${report.onsetCount}`,
    `Timing jitter:     ${report.onsetTimingStdDevMs.toFixed(1)} ms std dev`,
    ``,
    `── Summary ───────────────────────────────────────────`,
    report.summary,
  ].join('\n');
}
