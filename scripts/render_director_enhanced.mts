/**
 * ENHANCEMENT BRIDGE (runner) — executes the director handoff timeline via the HyperFrames channel.
 *
 * The director handoff is an AuthoredTimeline whose beats each carry a real video clip + an `enhancement`
 * plan (recommendedChannel:'hyperframes' + prose `guidance`). The baseline ffmpeg executor only stacked the
 * raw clips. THIS bridge does what the director asked: per beat, render the REAL clip as a full-frame
 * HyperFrames <video> base with an authored overlay, preserving the clip's audio, then stitch the beats in
 * timeline order into the finished ad.
 *
 * Per beat the overlay is authored by DOUBAO from the director's enhancement.guidance (the agent authors,
 * not us); a deterministic overlay (honest brand caption by role + push-in) is the guaranteed fallback if
 * Doubao is unavailable / fails the honesty gate / fails to render. Only the director's chosen real clips
 * are used — no fabricated content.
 *
 * Run:  cd apps/api && node --import tsx ../../scripts/render_director_enhanced.mts
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenAICompatibleClient } from '../apps/api/src/services/llmProvider';
import { stripHtmlFences, ensureRootDuration } from '../apps/api/src/services/hyperframesAuthor';

const PINNED = 'hyperframes@0.6.80';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (avoid a `dotenv` dep that doesn't resolve from scripts/).
function loadEnv(p: string): void {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1]! in process.env)) process.env[m[1]!] = v;
  }
}
loadEnv(path.join(repoRoot, '.env'));
const testDir = path.join(repoRoot, '.tmp', 'test');
const assetDir = path.join(testDir, 'kangshifu_iced_tea');
const handoffPath = path.join(testDir, 'director-agent-authored-handoff(1).json');
const workRoot = path.join(testDir, 'enhanced');
const outPath = path.join(testDir, 'out', 'director_enhanced.mp4');

const HF_MANIFEST = {
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }
};

interface EnhOption { channel: string; title?: string; guidance?: string; recommended?: boolean }
interface Beat {
  id: string;
  segmentRole: string;
  startSeconds: number;
  endSeconds: number;
  mediaLayers: Array<{ media?: { resolvedPath?: string; startSec?: number } }>;
  enhancement?: { options?: EnhOption[] };
}
interface Handoff {
  renderProfile: { width: number; height: number; fps: number };
  beats: Beat[];
  meta?: { productName?: string };
}

// Honest, on-brand captions by role (product descriptors only — NO efficacy/sales claims). Fallback only.
const CAPTIONS: Record<string, string[]> = {
  hook: ['冰爽一夏'],
  selling_point: ['康师傅冰红茶'],
  proof: ['冰爽茶香', '好友共享'],
  usage: ['畅快畅饮', '随时随地'],
  cta: ['就来一瓶\n康师傅冰红茶']
};
const roleCounter: Record<string, number> = {};
function captionFor(role: string, product: string): string {
  const pool = CAPTIONS[role] ?? [product];
  const i = roleCounter[role] ?? 0;
  roleCounter[role] = i + 1;
  return pool[i % pool.length]!;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/** Honesty gate (self-contained): every <img>/<video> src + css url() must be the local ./assets/clip.mp4. */
function honestOverlay(html: string): boolean {
  let m: RegExpExecArray | null;
  const media = /<(?:img|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  while ((m = media.exec(html))) {
    if (!/^\.?\/?assets\/clip\.mp4$/.test(m[1]!.trim())) return false;
  }
  const css = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = css.exec(html))) {
    const v = m[1]!.trim();
    if (v.startsWith('data:') || /^https?:/i.test(v)) return false;
  }
  return /<video[\s>]/i.test(html); // must keep the real-clip video base
}

/** Deterministic fallback composition: real clip as full-frame video base + slow push-in + kinetic caption. */
function beatHtml(compId: string, durationSec: number, caption: string): string {
  const d = Math.max(0.5, Number(durationSec.toFixed(3)));
  const capStart = Math.min(0.3, d * 0.12);
  const capDur = Math.max(0.4, d - capStart - 0.05);
  const lines = caption.split('\n').map((l) => esc(l)).join('<br/>');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000; overflow: hidden; font-family: "PingFang SC","Microsoft YaHei","Noto Sans CJK SC", sans-serif; }
  #ad { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #000; }
  .vwrap { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; transform-origin: 50% 50%; }
  .full { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 620px;
           background: linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0)); }
  .cap { position: absolute; left: 60px; right: 60px; bottom: 300px; text-align: center; color: #fff;
         font-size: 116px; font-weight: 900; line-height: 1.12; letter-spacing: 3px;
         text-shadow: 0 6px 32px rgba(0,0,0,.7); }
</style>
</head>
<body>
  <div id="ad" data-composition-id="${compId}" data-start="0" data-width="1080" data-height="1920" data-duration="${d}">
    <div class="vwrap" id="vwrap">
      <video class="full clip" data-start="0" data-duration="${d}" data-track-index="0" src="./assets/clip.mp4" muted playsinline></video>
    </div>
    <div class="scrim clip" data-start="0" data-duration="${d}" data-track-index="1"></div>
    <div class="cap clip" id="cap" data-start="${capStart.toFixed(2)}" data-duration="${capDur.toFixed(2)}" data-track-index="2">${lines}</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    var tl = gsap.timeline({ paused: true });
    tl.fromTo("#vwrap", { scale: 1.0 }, { scale: 1.07, duration: ${d}, ease: "none" }, 0);
    tl.fromTo("#cap", { opacity: 0, y: 60, scale: 0.7, filter: "blur(16px)" },
                      { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.5, ease: "back.out(1.8)" }, ${capStart.toFixed(2)});
    window.__timelines = window.__timelines || {};
    window.__timelines["${compId}"] = tl;
  </script>
</body>
</html>
`;
}

const DOUBAO_SYSTEM = `你是 HyperFrames 视频镜头增强器（不是从零创作整支广告）。你会收到【一个真实视频片段作为本镜头底层画面】和【导演对这一镜头的增强指引 guidance】。
产出：一个完整、自包含、可直接渲染的 HyperFrames index.html —— 让该视频全屏播放作为底层，并在其上严格按 guidance 叠加帧确定的 GSAP 动效与文字/图形（推近、标签高光、箭头、步骤卡、卖点文字、CTA 卡等）。

【视频底层（固定，不可替换，不可整屏遮挡）】
- 底层必须是：<video class="full clip" data-start="0" data-duration="D" data-track-index="0" src="./assets/clip.mp4" muted playsinline>，CSS object-fit:cover 铺满 1080×1920，保留其音频。
- 想做"推近/拉远"就把 <video> 包进一个【非定时】wrapper <div>，对 wrapper 做 GSAP transform scale；【绝不】给 <video> 元素本身做尺寸/缩放动画。
- 叠加层只占画面局部（文字安全区/卡片/箭头/高光），真实视频画面必须始终大面积可见。

【按 guidance 叠加】严格依据 guidance 的节奏与元素来编排叠加层；文字/卡片放上方或下方安全区，配深色 scrim 或描边保证可读；中文用系统字体 "PingFang SC","Microsoft YaHei","Noto Sans CJK SC"。

【诚实红线】只描述产品本身与画面已有内容；不得虚构功效、价格、未授权品牌、检测数据、效果对比、人物证言。文案从产品名与镜头语义衍生，简短有力。

【帧确定 + 契约】根元素带 data-composition-id、data-start="0"、data-width="1080"、data-height="1920"、data-duration="D"。每个带 data-start/data-duration 的时间元素加 class="clip" 与稳定 id。一律用 tl.fromTo（不要 tl.from）；禁止 Math.random()/Date.now()/任何 wall-clock；只 tween 视觉属性（opacity/x/y/scale/rotation/filter/clipPath/letterSpacing 等，模糊写 filter:"blur()"）。GSAP 用 <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js">。在一个 <script> 里建 gsap.timeline({paused:true})，挂上所有动效，最后赋给 window.__timelines[那个 composition-id]。只能引用 ./assets/clip.mp4，不得引用任何其它文件或外链图片/字体。
【输出】只输出 index.html 全文，第一行 <!DOCTYPE html>，最后 </html>。不要解释、不要 Markdown 代码围栏。`;

const llm = (() => { try { return createOpenAICompatibleClient(); } catch { return null; } })();
const MODEL = process.env.LLM_MODEL;

async function authorBeatWithDoubao(
  compId: string,
  durationSec: number,
  role: string,
  product: string,
  opt: EnhOption | undefined
): Promise<string | null> {
  if (!llm || !MODEL || !opt?.guidance) return null;
  const d = Math.max(0.5, Number(durationSec.toFixed(3)));
  const user = `产品: ${product}
本镜头角色 role: ${role}
本镜头时长 D: ${d} 秒（root 与 video 的 data-duration 都用 ${d}）
底层视频固定为 ./assets/clip.mp4（保留音频）。
导演增强指引 guidance（严格据此叠加）:
${opt.title ? `【${opt.title}】` : ''}${opt.guidance}

现在输出本镜头完整 index.html（视频底层 + 按 guidance 的叠加层）。`;
  try {
    const resp = await llm.chat.completions.create(
      { model: MODEL, messages: [{ role: 'system', content: DOUBAO_SYSTEM }, { role: 'user', content: user }], temperature: 0.7, max_tokens: 8000 },
      { timeout: 120_000 }
    );
    const html = ensureRootDuration(stripHtmlFences(resp.choices?.[0]?.message?.content ?? ''));
    if (!html || !/__timelines/.test(html) || !honestOverlay(html)) return null;
    return html;
  } catch {
    return null;
  }
}

function spawnHf(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['--yes', PINNED, ...args], {
      cwd,
      env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    let out = '';
    const t = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (c) => (out += String(c)));
    proc.stderr.on('data', (c) => (out += String(c)));
    proc.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: out + String(e) }); });
    proc.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }); });
  });
}

function ffmpeg(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (c) => (out += String(c)));
    proc.stderr.on('data', (c) => (out += String(c)));
    proc.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: out + String(e) }); });
    proc.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }); });
  });
}

async function renderProject(proj: string): Promise<boolean> {
  await spawnHf(['lint', '.', '--json'], proj, 90_000);
  await spawnHf(['render', '-c', 'index.html', '-o', 'out.mp4', '--fps', '30', '--resolution', 'portrait', '--quality', 'high'], proj, 6 * 60_000);
  return existsSync(path.join(proj, 'out.mp4'));
}

async function main(): Promise<void> {
  const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as Handoff;
  const product = handoff.meta?.productName ?? '康师傅冰红茶';
  console.log(`Doubao author: ${llm && MODEL ? `enabled (${MODEL})` : 'DISABLED -> deterministic overlays'}\n`);

  const byBasename = new Map<string, string>();
  for (const f of readdirSync(assetDir)) byBasename.set(f, path.join(assetDir, f));

  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(path.dirname(outPath), { recursive: true });

  const beatMp4s: string[] = [];
  for (let i = 0; i < handoff.beats.length; i += 1) {
    const beat = handoff.beats[i]!;
    const dur = Math.max(0.5, beat.endSeconds - beat.startSeconds);
    const rp = beat.mediaLayers?.[0]?.media?.resolvedPath;
    if (!rp) { console.error(`beat ${i} (${beat.id}): no media; ABORT`); process.exit(1); }
    const src = byBasename.get(path.basename(rp));
    if (!src || !existsSync(src)) { console.error(`beat ${i}: asset not found: ${path.basename(rp)}; ABORT`); process.exit(1); }

    const proj = path.join(workRoot, `beat_${i}`);
    mkdirSync(path.join(proj, 'assets'), { recursive: true });
    copyFileSync(src, path.join(proj, 'assets', 'clip.mp4'));
    writeFileSync(path.join(proj, 'hyperframes.json'), JSON.stringify(HF_MANIFEST, null, 2));
    writeFileSync(path.join(proj, 'meta.json'), JSON.stringify({ id: `beat_${i}`, name: beat.id }, null, 2));

    const opt = (beat.enhancement?.options ?? []).find((o) => o.channel === 'hyperframes' && o.recommended)
      ?? (beat.enhancement?.options ?? []).find((o) => o.channel === 'hyperframes');

    let html = await authorBeatWithDoubao(`beat_${i}`, dur, beat.segmentRole, product, opt);
    let source = html ? 'doubao' : 'deterministic';
    if (!html) html = beatHtml(`beat_${i}`, dur, captionFor(beat.segmentRole, product));
    writeFileSync(path.join(proj, 'index.html'), html);

    let ok = await renderProject(proj);
    if (!ok && source === 'doubao') {
      console.log(`  beat ${i}: doubao render failed -> deterministic fallback`);
      writeFileSync(path.join(proj, 'index.html'), beatHtml(`beat_${i}`, dur, captionFor(beat.segmentRole, product)));
      source = 'deterministic';
      ok = await renderProject(proj);
    }
    console.log(`beat ${i} [${beat.segmentRole.padEnd(13)}] ${dur.toFixed(2)}s  via=${source.padEnd(13)} render=${ok ? 'OK' : 'FAIL'}`);
    if (!ok) { console.error(`  ABORT: beat ${i} failed to render`); process.exit(1); }
    beatMp4s.push(path.join(proj, 'out.mp4'));
  }

  console.log(`\nstitching ${beatMp4s.length} beats -> ${outPath}`);
  const inputs = beatMp4s.flatMap((f) => ['-i', f]);
  const streams = beatMp4s.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('');
  const filter = `${streams}concat=n=${beatMp4s.length}:v=1:a=1[v][a]`;
  const stitch = await ffmpeg(
    [...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-r', '30', '-y', outPath],
    8 * 60_000
  );
  if (!existsSync(outPath)) { console.error(`stitch FAILED:\n${stitch.out.slice(-800)}`); process.exit(1); }
  console.log(`\n=== DONE -> ${outPath} ===`);
}

await main();
