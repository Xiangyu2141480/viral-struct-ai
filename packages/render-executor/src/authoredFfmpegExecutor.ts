import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  beatIsUnresolved,
  mediaLayerIsRenderable,
  HONEST_SUBSTITUTE,
  CAPTION_REGISTRY,
  isKnownCaptionStyle,
  type AuthoredTimeline,
  type AuthoredComposition,
  type MediaLayer,
  type TextElement
} from '@viral-struct/shared';
import { framesFor } from './manifestExecutor';
import type { RenderResult, RenderSegmentManifestEntry } from './RenderContract';

// ffmpeg-static is CommonJS (module.exports = path); load via createRequire to avoid ESM default-interop friction.
const requireCjs = createRequire(import.meta.url);

/** Resolve an ffmpeg binary: prefer ffmpeg-static, but its binary is sometimes absent (postinstall skipped) —
 *  fall back to a system ffmpeg on PATH so rendering still works. */
function resolveFfmpegBin(): string {
  let staticPath: string | null = null;
  try {
    staticPath = requireCjs('ffmpeg-static');
  } catch {
    staticPath = null;
  }
  if (staticPath && existsSync(staticPath)) return staticPath;
  return 'ffmpeg';
}

const FONT_CANDIDATES: Array<{ path: string; family: string }> = [
  { path: 'C:/Windows/Fonts/simhei.ttf', family: 'SimHei' },
  { path: 'C:/Windows/Fonts/msyh.ttc', family: 'Microsoft YaHei' },
  { path: 'C:/Windows/Fonts/simsun.ttc', family: 'SimSun' },
  { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFang SC' },
  { path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', family: 'DejaVu Sans' }
];

export interface AuthoredRenderOptions {
  outputPath: string;
  fontPath?: string;
  /** Override the H.264 codec; auto-detected (libx264 if the build's encoder works, else mpeg4) when omitted. */
  videoCodec?: string;
}

// Some ffmpeg builds ship a broken libx264 (fails even on synthetic input); detect once and fall back to mpeg4.
let cachedCodec: string | null = null;
async function detectVideoCodec(ffmpeg: string): Promise<string> {
  if (cachedCodec) return cachedCodec;
  try {
    await runFfmpeg(ffmpeg, ['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=2', '-t', '0.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'null', '-']);
    cachedCodec = 'libx264';
  } catch {
    cachedCodec = 'mpeg4';
  }
  return cachedCodec;
}

/** Encoder args for the chosen codec (mpeg4 needs a quality flag; libx264 a preset). */
function codecArgs(videoCodec: string): string[] {
  if (videoCodec === 'libx264') return ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
  return ['-c:v', videoCodec, '-q:v', '4', '-pix_fmt', 'yuv420p'];
}

interface ResolvedFont {
  dir: string;
  family: string;
}

/**
 * P0 renderer for the creative producer: consumes an AuthoredTimeline and composites REAL pixels
 * (image/video media, cover-fit + Ken-Burns motion, authored libass text), one MP4 per beat, then concats.
 * This kills the "solid colour block for matched real assets" model — the colour block now survives ONLY as
 * the honest substitute. Honesty is enforced at PAINT TIME: a beat where beatIsUnresolved() is true renders
 * teal + the yellow 「替代卡片 · 素材缺失」 marker regardless of how it was authored.
 *
 * v1 scope (deliberate, documented): one primary media layer per beat (lowest zOrder renderable); video plays
 * scaled/cropped to cover; images get a centred zoom when motion is authored (pan deferred); transitions are
 * hard cuts (xfade deferred); audio is dropped (-an, mix deferred). Multi-layer overlay, pan, transitions, and
 * audio are follow-on work — the spec already carries them.
 */
export class AuthoredFfmpegExecutor {
  readonly name = 'ffmpeg-authored';

  constructor(private readonly options: AuthoredRenderOptions) {}

  async render(timeline: AuthoredTimeline): Promise<RenderResult> {
    if (timeline.beats.length === 0) throw new Error('cannot render an empty timeline');
    const ffmpegPath = resolveFfmpegBin();
    const videoCodec = this.options.videoCodec ?? (await detectVideoCodec(ffmpegPath));

    const { width, height, fps } = timeline.renderProfile;
    const font = resolveFont(this.options.fontPath);
    const warnings: string[] = [];
    if (!font) warnings.push('No caption font found; rendered without burned-in text.');
    if (videoCodec !== 'libx264') warnings.push(`libx264 unavailable in this ffmpeg build; encoded with ${videoCodec}.`);

    const workDir = mkdtempSync(path.join(tmpdir(), 'vs-authored-'));
    try {
      const beatFiles: string[] = [];
      for (let i = 0; i < timeline.beats.length; i += 1) {
        const beat = timeline.beats[i]!;
        const beatPath = path.join(workDir, `beat_${i}.mp4`);
        await renderBeat(ffmpegPath, videoCodec, beat, i, width, height, fps, font, workDir, beatPath, warnings);
        beatFiles.push(beatPath);
      }

      // Concat demuxer: every beat is encoded with identical params, so a stream copy is safe + fast.
      const listPath = path.join(workDir, 'concat.txt');
      writeFileSync(listPath, beatFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
      await runFfmpeg(ffmpegPath, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', this.options.outputPath]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }

    const manifest: RenderSegmentManifestEntry[] = timeline.beats.map((beat) => {
      const unresolved = beatIsUnresolved(beat);
      const hasMedia = beat.mediaLayers.some(mediaLayerIsRenderable);
      const startMs = Math.round(beat.startSeconds * 1000);
      const endMs = Math.round(beat.endSeconds * 1000);
      return {
        id: beat.id,
        slotId: beat.id,
        startMs,
        endMs,
        frames: framesFor(startMs, endMs, fps),
        source: unresolved ? 'substitute' : hasMedia ? 'asset' : 'card',
        unresolvedEvidence: unresolved,
        label: `${beat.segmentRole}:${unresolved ? 'substitute' : hasMedia ? 'asset' : 'card'}`
      };
    });
    const totalDurationMs = timeline.beats.reduce((sum, b) => sum + Math.round((b.endSeconds - b.startSeconds) * 1000), 0);
    const frameCount = manifest.reduce((sum, m) => sum + m.frames, 0);
    const contentHash = createHash('sha256').update(JSON.stringify(timeline)).digest('hex').slice(0, 16);

    return {
      ok: true,
      rendered: true,
      executor: this.name,
      format: 'mp4',
      outputPath: this.options.outputPath,
      durationMs: totalDurationMs,
      frameCount,
      segmentCount: timeline.beats.length,
      unresolvedSegmentIds: timeline.beats.filter(beatIsUnresolved).map((b) => b.id),
      manifest,
      contentHash,
      warnings
    };
  }
}

async function renderBeat(
  ffmpeg: string,
  videoCodec: string,
  beat: AuthoredComposition,
  index: number,
  width: number,
  height: number,
  fps: number,
  font: ResolvedFont | null,
  workDir: string,
  outPath: string,
  warnings: string[]
): Promise<void> {
  const durationSec = Math.max(0.1, beat.endSeconds - beat.startSeconds);
  const unresolved = beatIsUnresolved(beat);
  const layer = unresolved
    ? undefined
    : beat.mediaLayers.filter(mediaLayerIsRenderable).sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0))[0];

  const inputArgs: string[] = [];
  const chain: string[] = [];

  if (layer && layer.media.resolvedPath) {
    if (layer.media.type === 'image') {
      // -framerate fps so the looped still has exactly dur*fps frames → Ken-Burns `on` reaches the final scale.
      inputArgs.push('-loop', '1', '-framerate', String(fps), '-t', durationSec.toFixed(3), '-i', layer.media.resolvedPath);
    } else {
      const ss = layer.media.startSec ?? 0;
      inputArgs.push('-ss', ss.toFixed(3), '-t', durationSec.toFixed(3), '-i', layer.media.resolvedPath);
    }
    chain.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`);
    const motion = layer.media.type === 'image' ? layer.motion : undefined;
    if (motion && motion.kind !== 'static' && motion.keyframes.length >= 2) {
      const from = motion.keyframes[0]!.scale;
      const to = motion.keyframes[motion.keyframes.length - 1]!.scale;
      const totalFrames = Math.max(1, Math.round(durationSec * fps));
      // Centred Ken-Burns zoom (pan deferred): z linear over output frame index `on`, capped at `to`.
      chain.push(
        `zoompan=z='min(${from}+(${to - from})*on/${totalFrames}\\,${to})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`
      );
    }
  } else {
    const bg = unresolved ? HONEST_SUBSTITUTE.background : beat.fallbackBackground ?? '0x14141c';
    inputArgs.push('-f', 'lavfi', '-t', durationSec.toFixed(3), '-i', `color=c=${toFfmpegColor(bg)}:s=${width}x${height}:r=${fps}`);
    if (!unresolved && !layer && beat.mediaLayers.length > 0) {
      warnings.push(`beat ${beat.id}: media layer(s) had no resolvedPath; fell back to colour background.`);
    }
  }

  const ass = font ? buildAuthoredAss(beat, height, font.family, unresolved) : null;
  if (font && ass?.hasEvents) {
    const assPath = path.join(workDir, `beat_${index}.ass`);
    writeFileSync(assPath, ass.content, 'utf8');
    chain.push(`subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(font.dir)}'`);
  }
  // Flash cut: each real beat flashes up from white (~0.12s) for punchy energy at the boundary.
  // Honest substitutes stay plain (no flash) so styling never dresses up missing evidence.
  if (!unresolved) chain.push('fade=t=in:st=0:d=0.12:color=white');
  chain.push('fps=' + fps, 'format=yuv420p', 'setsar=1');

  const args = [...inputArgs, '-vf', chain.join(','), '-an', ...codecArgs(videoCodec), '-r', String(fps), '-y', outPath];
  await runFfmpeg(ffmpeg, args);
}

function resolveFont(explicitPath?: string): ResolvedFont | null {
  if (explicitPath && existsSync(explicitPath)) return { dir: path.dirname(explicitPath), family: path.parse(explicitPath).name };
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate.path)) return { dir: path.dirname(candidate.path), family: candidate.family };
  }
  return null;
}

/** Build the libass script for a beat. Each text element gets its own authored style; honesty is enforced. */
function buildAuthoredAss(beat: AuthoredComposition, height: number, fontFamily: string, unresolved: boolean): { content: string; hasEvents: boolean } {
  const base = Math.max(28, Math.round(height * 0.038));
  const end = msToAss(Math.round((beat.endSeconds - beat.startSeconds) * 1000));
  const styles: string[] = [];
  const events: string[] = [];
  let styleIndex = 0;

  const emit = (el: TextElement, forcePlain: boolean) => {
    const lines = el.content.map((line) => sanitizeAss(line.trim())).filter(Boolean);
    if (lines.length === 0) return;
    const name = `T${styleIndex++}`;
    styles.push(textStyleLine(name, el, base, height, fontFamily, forcePlain));
    events.push(`Dialogue: 0,0:00:00.00,${end},${name},,0,0,0,,${textAnim(el.type, forcePlain)}${lines.join('\\N')}`);
  };

  if (unresolved) {
    // Honest substitute: the yellow marker is non-overridable; any authored text shows in PLAIN style (never
    // styled to mask the missing evidence).
    styles.push(markerStyleLine('Marker', base, height, fontFamily));
    events.push(`Dialogue: 0,0:00:00.00,${end},Marker,,0,0,0,,${HONEST_SUBSTITUTE.markerText}`);
    for (const el of beat.textElements) if (el.type !== 'honest_marker') emit(el, true);
  } else {
    for (const el of beat.textElements) {
      if (el.type === 'honest_marker') {
        styles.push(markerStyleLine('Marker', base, height, fontFamily));
        events.push(`Dialogue: 0,0:00:00.00,${end},Marker,,0,0,0,,${sanitizeAss(el.content.join(' ')) || HONEST_SUBSTITUTE.markerText}`);
      } else {
        emit(el, false);
      }
    }
  }

  if (events.length === 0) return { content: '', hasEvents: false };
  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events
  ].join('\n');
  return { content, hasEvents: true };
}

/** Kinetic entrance per text type (libass override tags). Headlines pop in (fade + scale overshoot);
 *  body/annotation fade in. Substitutes and the honest marker stay plain (no animation). */
function textAnim(type: TextElement['type'], forcePlain: boolean): string {
  if (forcePlain || type === 'honest_marker') return '';
  const bs = '\\'; // single backslash for ASS override tags
  if (type === 'headline') {
    return `{${bs}fad(120,0)${bs}t(0,160,${bs}fscx118${bs}fscy118)${bs}t(160,300,${bs}fscx100${bs}fscy100)}`;
  }
  return `{${bs}fad(160,0)}`;
}

function textStyleLine(name: string, el: TextElement, base: number, height: number, fontFamily: string, forcePlain: boolean): string {
  // Type defaults.
  let scale = 1;
  let alignment = 2; // bottom-center
  let bold = 0;
  let primary = '0xffffff';
  let outline = '0x000000';
  let outlineW = 4;
  if (el.type === 'headline') {
    scale = 1.5;
    alignment = 5; // mid-center
    bold = -1;
  } else if (el.type === 'annotation') {
    scale = 0.8;
  }
  let marginV = alignment === 2 ? Math.round(height * 0.1) : Math.round(height * 0.04);

  if (!forcePlain) {
    if (el.stylePreset && el.stylePreset !== 'custom' && isKnownCaptionStyle(el.stylePreset)) {
      const c = CAPTION_REGISTRY[el.stylePreset];
      scale *= c.fontScale;
      primary = c.primaryColour;
      outline = c.outlineColour;
      outlineW = c.outlineWidth;
      alignment = c.align === 'center' ? 5 : c.align === 'top' ? 8 : 2;
      marginV = Math.round(height * c.marginVRatio);
    }
    if (el.stylePreset === 'custom' && el.customStyle) {
      const cs = el.customStyle;
      if (cs.fontScale != null) scale *= cs.fontScale;
      if (cs.primaryColour) primary = cs.primaryColour;
      if (cs.outlineColour) outline = cs.outlineColour;
      if (cs.outlineWidth != null) outlineW = cs.outlineWidth;
      if (cs.align) alignment = cs.align === 'center' ? 5 : cs.align === 'top' ? 8 : 2;
      if (cs.marginVRatio != null) marginV = Math.round(height * cs.marginVRatio);
    }
  }
  const fontSize = Math.round(base * scale);
  return `Style: ${name},${fontFamily},${fontSize},${hexToAss(primary)},&H000000FF,${hexToAss(outline)},&H64000000,${bold},0,0,0,100,100,0,0,1,${outlineW},2,${alignment},80,80,${marginV},1`;
}

function markerStyleLine(name: string, base: number, height: number, fontFamily: string): string {
  const fontSize = Math.max(22, Math.round(base * 0.66));
  const marginV = Math.round(height * 0.05);
  return `Style: ${name},${fontFamily},${fontSize},${hexToAss(HONEST_SUBSTITUTE.markerColour)},&H000000FF,${hexToAss('0x000000')},&H64000000,-1,0,0,0,100,100,0,0,1,3,1,8,60,60,${marginV},1`;
}

function sanitizeAss(line: string): string {
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

function escapeFilterPath(target: string): string {
  return target.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function toFfmpegColor(token: string): string {
  if (token.startsWith('0x')) return token;
  if (/^[0-9a-fA-F]{6}$/.test(token)) return `0x${token}`;
  return token;
}

function hexToAss(token: string): string {
  const hex = token.replace(/^0x/i, '').replace(/^#/, '').padStart(6, '0').slice(-6);
  const rr = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const bb = hex.slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
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
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1000)}`));
    });
  });
}
