import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { framesFor } from './manifestExecutor';
import type { RenderExecutor, RenderInput, RenderResult, RenderSegmentManifestEntry } from './RenderContract';
import { buildRenderTrack, type RenderTrackSlice } from './renderTrack';

// ffmpeg-static is CommonJS (module.exports = path); load via createRequire to avoid ESM default-interop friction.
const requireCjs = createRequire(import.meta.url);
const ffmpegPath: string | null = requireCjs('ffmpeg-static');

// Captions are burned via the libass `subtitles` filter (NOT drawtext): on ffmpeg 6.1.x drawtext's textfile=
// is broken and its freetype path tofu-renders CJK, whereas libass shapes Chinese correctly.
// Candidates are CJK-capable; first existing wins. { family } must match the font's family name for libass.
const FONT_CANDIDATES: Array<{ path: string; family: string }> = [
  { path: 'C:/Windows/Fonts/simhei.ttf', family: 'SimHei' },
  { path: 'C:/Windows/Fonts/msyh.ttc', family: 'Microsoft YaHei' },
  { path: 'C:/Windows/Fonts/simsun.ttc', family: 'SimSun' },
  { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFang SC' },
  { path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', family: 'DejaVu Sans' }
];

export interface FfmpegRenderOptions {
  outputPath: string;
  /** Font file for burned-in captions. Auto-detected (CJK-capable) when omitted. */
  fontPath?: string;
}

interface ResolvedFont {
  dir: string;
  family: string;
}

/**
 * Real renderer: lays the flattened track on a single timeline (duration = span), encodes each slice as a
 * solid-colour clip, concatenates them, and burns captions via libass. Honest substitutes carry an on-screen
 * "（替代卡片 · 素材缺失）" marker. Richer visuals come from swapping in a HyperFrames executor behind the
 * same RenderExecutor interface.
 */
export class FfmpegRenderExecutor implements RenderExecutor {
  readonly name = 'ffmpeg';

  constructor(private readonly options: FfmpegRenderOptions) {}

  async render(input: RenderInput): Promise<RenderResult> {
    if (!ffmpegPath) throw new Error('ffmpeg-static binary path not found');
    if (input.segments.length === 0) throw new Error('cannot render an empty timeline');

    const track = buildRenderTrack(input);
    if (track.length === 0) throw new Error('cannot render an empty track');

    const { width, height, fps } = input.profile;
    const font = resolveFont(this.options.fontPath);
    const warnings: string[] = [];

    // Keep the .ass in an ASCII temp dir (os.tmpdir() resolves to a short-name path) so libass can open it.
    const workDir = mkdtempSync(path.join(tmpdir(), 'vs-render-'));
    try {
      const args: string[] = [];
      for (const slice of track) {
        const durationSec = Math.max(0.1, (slice.endMs - slice.startMs) / 1000);
        args.push('-f', 'lavfi', '-i', `color=c=${toFfmpegColor(slice.background)}:s=${width}x${height}:d=${durationSec.toFixed(3)}:r=${fps}`);
      }
      let filter = track.map((_, index) => `[${index}:v]`).join('') + `concat=n=${track.length}:v=1:a=0[base]`;
      let mapLabel = '[base]';

      const ass = font ? buildAss(track, width, height, font.family) : null;
      if (font && ass?.hasEvents) {
        const assPath = path.join(workDir, 'captions.ass');
        writeFileSync(assPath, ass.content, 'utf8');
        // Values MUST be single-quoted: ffmpeg unescapes the filtergraph once, then parses each filter's
        // options; an unquoted (even colon-escaped) Windows path gets split and mis-mapped to original_size.
        filter += `;[base]subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(font.dir)}'[v]`;
        mapLabel = '[v]';
      } else if (!font) {
        warnings.push('No caption font found; rendered without burned-in subtitles.');
      }

      args.push('-filter_complex', filter, '-map', mapLabel, '-pix_fmt', 'yuv420p', '-y', this.options.outputPath);
      await runFfmpeg(ffmpegPath, args);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }

    const manifest: RenderSegmentManifestEntry[] = input.segments.map((segment) => ({
      id: segment.id,
      slotId: segment.slotId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      frames: framesFor(segment.startMs, segment.endMs, fps),
      source: segment.source,
      unresolvedEvidence: segment.unresolvedEvidence,
      label: segment.label
    }));
    const frameCount = track.reduce((sum, slice) => sum + framesFor(slice.startMs, slice.endMs, fps), 0);
    const contentHash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);

    return {
      ok: true,
      rendered: true,
      executor: this.name,
      format: 'mp4',
      outputPath: this.options.outputPath,
      durationMs: input.totalDurationMs,
      frameCount,
      segmentCount: input.segments.length,
      unresolvedSegmentIds: input.segments.filter((segment) => segment.unresolvedEvidence).map((segment) => segment.id),
      manifest,
      contentHash,
      warnings
    };
  }
}

function resolveFont(explicitPath?: string): ResolvedFont | null {
  if (explicitPath && existsSync(explicitPath)) {
    return { dir: path.dirname(explicitPath), family: path.parse(explicitPath).name };
  }
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate.path)) return { dir: path.dirname(candidate.path), family: candidate.family };
  }
  return null;
}

function buildAss(
  track: RenderTrackSlice[],
  width: number,
  height: number,
  fontFamily: string
): { content: string; hasEvents: boolean } {
  const fontSize = Math.max(28, Math.round(height * 0.038));
  const marginV = Math.round(height * 0.1);

  const events: string[] = [];
  for (const slice of track) {
    const lines = slice.captionLines.map((line) => sanitizeAss(line.trim())).filter(Boolean);
    if (slice.unresolvedEvidence) lines.push('（替代卡片 · 素材缺失）');
    if (lines.length === 0) continue;
    events.push(`Dialogue: 0,${msToAss(slice.startMs)},${msToAss(slice.endMs)},Default,,0,0,0,,${lines.join('\\N')}`);
  }
  if (events.length === 0) return { content: '', hasEvents: false };

  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontFamily},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,2,2,80,80,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events
  ].join('\n');

  return { content, hasEvents: true };
}

function sanitizeAss(line: string): string {
  // Strip characters that would be parsed as ASS override tags / escapes.
  return line.replace(/\\/g, ' ').replace(/[{}]/g, '');
}

function msToAss(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(cs)}`;
}

// ffmpeg filter option values use ':' as a separator, so a Windows drive colon must be escaped; use forward slashes.
function escapeFilterPath(target: string): string {
  return target.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function toFfmpegColor(token: string): string {
  if (token.startsWith('0x')) return token;
  if (/^[0-9a-fA-F]{6}$/.test(token)) return `0x${token}`;
  return token;
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
    });
  });
}
