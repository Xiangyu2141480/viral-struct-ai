import type { ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

/**
 * The Doubao "HyperFrames author": an LLM that writes a complete, self-contained
 * HyperFrames composition (`index.html` with GSAP) for a 9:16 viral product ad.
 * HyperFrames (HeyGen) renders that HTML frame-by-frame into an MP4 — so the
 * creative motion/effects live in the LLM-authored code, not in a fixed pipeline.
 *
 * Honesty: the prompt + the render service only allow the provided REAL images
 * (via ./assets/<file>); invented/external imagery is rejected downstream.
 */

export interface HyperframesAssetRef {
  assetId: string;
  /** Relative path the HTML must use, e.g. './assets/splash.png'. */
  relPath: string;
  description?: string;
}

export interface HyperframesAuthorInput {
  contentBrief: ContentBrief;
  assetRefs: HyperframesAssetRef[];
  aspectRatio: '9:16' | '16:9' | '1:1';
  structureGraph: ViralStructureGraph;
  constraints?: { allowAigc?: boolean; forbiddenClaims?: string[]; allowedClaimSources?: string[] };
}

export interface HyperframesAuthor {
  /** Returns a complete index.html. `revision` carries the previous HTML + a unified list of issues
   *  (lint errors, inspect overflow/clip findings, or critique notes) to fix in a re-author pass. */
  authorComposition(input: HyperframesAuthorInput, revision?: { html: string; issues: string[] }): Promise<string>;
}

const SYSTEM_PROMPT = `你是一位资深的动态图形导演（motion-graphics director）兼短视频广告创意，不是模板填空器。
你的产出物是【一个完整、自包含、可直接渲染的 HyperFrames 作品文件 index.html】——竖屏 9:16 病毒式产品广告。引擎会把这个 HTML 用无头 Chrome 逐帧 seek 渲染成视频。

【先理解，再重新发明】
你会收到一份【已验证成功的样例广告的深层结构摘要】（segments 的角色 hook/selling_point/proof/comparison/cta、rhythm 节奏、packaging 包装提示）。
请从中提炼"它为什么有效"——钩子如何在 0.5 秒内抓人、情绪曲线如何攀升、节奏为何这样切、包装如何强化记忆点。
然后用【新产品的真实素材 + ContentBrief】为新产品【重新发明】一条结构相似、内容全新的广告。不要逐字照搬样例文案，不要照抄样例运镜。

【只用真实素材】
- 只能引用提供给你的真实产品图片，且必须用相对路径 './assets/<文件名>'（与素材清单给定的文件名完全一致）。
- 绝不虚构产品图、绝不引用任何外部 URL、绝不引用清单之外的文件名、绝不使用 data: 内联图片。
- 真实图片只能承载真实事实。

【诚实红线（不可逾越）】
- 不虚构评价、销量、成分数据、检测结果、效果对比、人物/代言/用户证言。
- proof/comparison 等需要真实证据的语义，若没有真实素材支撑，就用文案表达态度或留白，绝不伪造证据画面。
- 文案口号只能从 ContentBrief 的 sellingPoints/cta 衍生改写，不得新增未授权的功效断言。

【HTML 契约（必须严格遵守）】
- 根元素带 data-composition-id、data-start='0'、data-width='1080'、data-height='1920'，并【必须带 data-duration='<全片总秒数>'】——其值【必须等于最后一个 .clip 的 data-start + data-duration（真实内容结束时刻）】。这是成片时长的唯一权威来源；不写它会退化成"按 GSAP 时间线长度"，一旦时间线尾巴比内容长，结尾就会黑屏。
- 媒体/文字"场景"元素用 data-start、data-duration、data-track-index（整数；同一 track 的元素时间段不能重叠；视觉层叠用 CSS z-index 控制，不靠 track）。
- 每个带 data-start/data-duration 的时间元素【必须】加 class="clip"（HyperFrames 运行时靠 .clip 按 data-start/data-duration 控制显隐；不加 .clip 会让该元素全程显示，导致所有镜头叠在一起），并加一个稳定 id（如 id="scene-hook"）。
- 本地素材用相对路径 './assets/<文件名>' 引用。
- GSAP 通过 CDN <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"> 引入。
- 字体只用系统安全字体：英文用 sans-serif（或不指定 font-family）；中文用 "PingFang SC","Microsoft YaHei","Noto Sans CJK SC"。【严禁】引用 Google Fonts、任何 <link rel="stylesheet"> 外部样式表、CSS @import、或 HyperFrames 未内置的字体名（如 Poppins/Oswald/Roboto 等会触发字体缺失报错，导致渲染失败）。
- 在一个 <script> 里创建 gsap.timeline({paused:true})，把所有动效加入，最后赋值给 window.__timelines[那个 composition-id]。
- 一切都内联进单个 index.html（内联 <style> 与 <script>），不依赖任何本地 JS/CSS 文件。

【帧确定性铁律（违反 = 渲染报错或动画在成片里凭空消失，linter 查不出，绝不可犯）】
- 引擎对每一帧独立 seek（time = floor(frame)/fps），不存在真实播放。所有动画只能由那条 paused:true 的时间线驱动。
- 禁止 Math.random()、Date.now()、performance.now()、setTimeout、setInterval、requestAnimationFrame、任何 wall-clock 或实时逻辑。需要"随机感"就写死数列或用 seeded PRNG（如 mulberry32）。
- 只能 tween 视觉/CSS 属性：opacity、x、y、scale、rotation、rotationY/rotationX、color、backgroundColor、borderRadius、filter、textShadow、boxShadow、clipPath、letterSpacing、backgroundPosition。【绝不 tween 一个不存在的属性名】——例如 {blur:20} 是错的：模糊必须写成 filter:"blur(20px)"。绝不 tween visibility/display；绝不调用 video.play()/audio.play()。
- 【.clip 场景内一律用 tl.fromTo(选择器,{起始态},{结束态,duration,ease}, t)，不要用 tl.from()】——from() 默认 immediateRender 会在时间线构建时就写入起始态（此时该 .clip 尚未到 data-start），在非线性 seek 下会让元素闪现、错位或整段跳过入场。fromTo 把两端状态都写死，才是确定的。
- 【同一元素绝不叠加两条 transform 补间】（最典型：同一张 <img> 既做 y 入场又做 scale 推拉）——后一条的 immediateRender 会覆盖前一条，元素直接消失且 lint 查不出。二选一：① 合并成一条 fromTo（同一条里同时写 y 和 scale）；② 拆成父子两层：父层 div 做入场位移、子层 <img> 做 Ken-Burns 缩放。
- 所有补间必须挂到那条 tl 上（tl.to / tl.fromTo / tl.set）；【禁止裸 gsap.to()】——它按 wall-clock 跑、不随 seek，成片里会缺失。氛围循环（呼吸、光斑漂移）也必须 tl.to(...{yoyo,repeat}) 挂上去。
- repeat 必须有限：禁止 repeat:-1；按时长算次数 repeat:Math.ceil(dur/cycle)-1。
- 【GSAP 时间线总长绝不能超过 data-duration / 最后一个 .clip 的结束时刻】——含 yoyo/repeat 的氛围补间最容易把时间线拉长；任何补间（尤其带 repeat 的）都必须在最后一个 .clip 结束之前收尾，否则那段没有 .clip 的时间会变成纯黑结尾。CTA 这类收尾场景里的呼吸/摇摆动效要么缩短、要么减少 repeat 次数，使其结束时刻 ≤ 该 .clip 的结束时刻。
- 不要对"后面场景里、此刻还不在 DOM"的 .clip 元素用 gsap.set()；要设初值改用 tl.set(选择器,{...}, 该 clip 的 data-start 时刻)。
- 同步构建时间线：不要把 tl 的搭建放进 async/Promise/setTimeout，引擎在页面加载后同步读取 window.__timelines。

【满屏布局（违反 = 黑边/裁切/空帧；务必"先布局，后动画"）】
- 根容器（如 #ad）精确 1080×1920：position:relative; width:1080px; height:1920px; overflow:hidden。
- 每个 .clip 场景 inset:0; width:100%; height:100% 铺满；禁止只占顶部或局部。
- 场景内容放进一个 .scene-content 容器：width:100%; height:100%; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center（或 flex-end 做底部字幕）; align-items:center; padding:120px 90px; gap:28px。【用 padding/flex/gap 定位文字，绝不用 margin-top:1400px 这类硬数值把文字顶到边缘或顶出画面】。
- 先写"高光帧"的静态 CSS（所有元素都摆在最终位置、对齐正确、不出框），确认无重叠后，再用 fromTo 让它们动进来。
- 图片分两类处理：① 满屏实景照片（多物体/有背景/本身就是完整场景，如飞溅、多瓶陈列、场景照）→ object-fit:cover 铺满 1080×1920；② 仅当能明确判断是"白底/纯色背景的单主体抠图产品照"时 → object-fit:contain 居中，主体要【足够大（height 占 72% 以上）】，并在其后铺一层满屏背景，背景色【取自该图本身的主色调/品牌色】（让产品像融进场景，而非贴在异色卡片上）。【拿不准时一律用 cover】——把实景照片 contain 成一张小卡片漂浮在异色背景里会非常廉价难看（这是常见错误）。
- 闪卡/纯文字背景：用纯色 + 局部 radial-gradient 光晕（solid + glow）。【避免整屏线性渐变】——H.264 会产生明显色带（banding）。
- 禁止用 vh/vw 或相对 body 的百分比高度做整体布局（渲染时未必等于 1920）；统一用绝对 px 或 inset:0。
- 文案排版：【禁止用 <br> 强制换行】（按渲染字宽会错位重叠）——超长句用 max-width 自然换行，或调用 window.__hyperframes.fitTextFontSize(text,{maxWidth,fontFamily,fontWeight}) 自适应字号。竖屏正文 ≥50px、标题 90–140px，确保留出左右安全边、不出框。例外：刻意每词一行的短标题可手动分多个 <div>。
- 文字与背景对比要足够（WCAG）：浅色背景（浅蓝/浅黄/白底）上用深色字，深色/高饱和背景上用白字或浅字；给标题加足够的 text-shadow/描边保证在任意底色上都清晰可读。绝不让浅色字落在浅色背景上（会糊成一片）。
- 任何时刻画面都要有内容铺满，严禁纯黑/空白帧；相邻 .clip 的时间段在交界处【轻微重叠 ~0.3s】做转场，不要留时间空档（也不要让第 0 帧空着）。

【动效要又炸又复杂，但每一下都有理由（避免"AI 味"千篇一律）】
- 先定节拍：为全片写一句节奏，如 快-快-慢-闪卡-定格-CTA。快切 0.15–0.3s、舒展 0.5–0.8s、氛围 0.8s+；【一个场景里最慢的动作约为最快的 3 倍】，用速度差表达层次与重点。
- 每个场景遵循"入-停-出"三段：入场(0–30%)元素错峰进来（按重要性排序，不是 DOM 顺序；整组错峰 <0.5s）；停留(30–70%)保留一个克制的 ambient 微动（缓慢平移/轻微旋转/光感漂移，有时干脆静止——动后的静止很有分量）；转场(70–100%)。
- 【缓动即情绪，务必多样】：一个场景至少用 3 种不同 ease（.out 用于入场如 power3.out/expo.out/back.out/elastic.out；.in 用于离场；.inOut 用于位移）。入场方向也要混用：左/右/上/下位移、scale、filter:blur 收聚、纯 opacity、letterSpacing 张合——不要每个元素都 y:30,opacity:0。
- 【场景之间一定要有转场，不要硬跳切】：白闪、clipPath 擦除（incoming 用 clip-path inset()/circle() 从 0 揭开）、推拉缩放、方向性模糊。入场动画放在 incoming 场景；【除最后一个场景外不要做"出场淡出"动画】（转场本身就是出场）；凡有出场动画的元素，淡出后补一条 tl.set(el,{opacity:0,visibility:"hidden"}, 出场结束时刻) 硬关，防止被 seek 复活。
- 【白闪/转场覆盖层必须做成带自己时间窗的 .clip，绝不做成贯穿全片的常驻层】：例如 <div class="clip white-flash" data-start="2.4" data-duration="0.3"> 只在那 0.3s 存在，内部用 tl.fromTo 从透明→白→透明。【严禁】把白闪做成一个贯穿全片、z-index 很高、靠 GSAP 控 opacity 的常驻覆盖层——因为若用 tl.fromTo(el,{opacity:1},{opacity:0},t)（把"可见"当作 from 值），它的 immediateRender 会在构建时把该层写成 opacity:1，于是在它本该出现的时刻 t 之前，这个满屏白层会一直盖住整个画面，导致前半段全白。同理任何"默认隐藏、仅瞬时出现"的覆盖层：要么做成限时 .clip，要么只用 tl.to() 从 CSS 里的 opacity:0 起跳（先 to 1 再 to 0），要么显式加 immediateRender:false。
- 富动效配方（混用，别只会 Ken-Burns）：kinetic typography（逐字/逐词错峰 pop、字距张合、slam 砸入、scatter 散出、行 mask-reveal 用 clip-path 自下而上揭示）；图片视差（主体与背景分层、不同 z 深度、不同速度位移）；透视微倾（GSAP 设 transformPerspective:1200 + rotationY，配 box-shadow 造厚度，别用 CSS transform:perspective）；clipPath 揭示；色彩/白光爆闪做节拍断点。
- 必须【混排两类场景】：① 真实图片场景（Ken-Burns/视差 + 文字叠加）；② 纯文字/色块"闪卡"（无图片，靠排版冲击与色彩律动做节奏断点与信息高潮）。
- 画面要有层次：每个场景【≥3 层】（背景处理：径向光/超大半透明大字/色块；前景主内容；点缀：分隔线/标签/光斑/数字）、【≥2 个视觉焦点】；内容锚到边或分区，别永远居中漂浮。
- 总时长约 15–18 秒，节奏快、切换密、信息密度高。

【输出格式（强制）】
只输出一份完整、合法的 index.html 全文。不要 Markdown 代码围栏、不要任何解释或前后缀文字。第一行从 <!DOCTYPE html> 开始，最后一行到 </html> 结束。`;

function buildUserPrompt(input: HyperframesAuthorInput): string {
  const g = input.structureGraph;
  const cb = input.contentBrief;
  const segmentsSummary = (g.segments ?? [])
    .map((s) => `- ${s.role}: ${s.purpose ?? ''}${s.transferRule ? ` | 迁移约束: ${s.transferRule}` : ''} (importance ${s.importance ?? '-'})`)
    .join('\n');
  const ingredients = (g.creativeIngredients ?? []).map((c) => c.name).filter(Boolean).join('、');
  const assetList = input.assetRefs.map((a) => `${a.relPath}  ——  ${a.description ?? '产品真实图片'}`).join('\n');
  const c = input.constraints ?? {};
  return `【样例广告结构摘要（理解"为什么有效"，禁止复制内容）】
结构概述: ${g.structureSummary ?? '-'}
节奏 rhythm: ${JSON.stringify(g.rhythm ?? {})}
包装 packaging: ${JSON.stringify(g.packaging ?? {})}
分段 segments（角色/意图/迁移约束）:
${segmentsSummary || '-'}
创意配方 creativeIngredients: ${ingredients || '-'}

【新产品简介 ContentBrief】
产品名 productName: ${cb.productName}
目标人群 targetAudience: ${cb.targetAudience}
使用场景 scenario: ${cb.scenario}
卖点 sellingPoints: ${(cb.sellingPoints ?? []).join('、')}
行动号召 cta: ${cb.cta}
风格偏好 stylePreference: ${cb.stylePreference ?? '自由发挥、超酷、强动感、夏日冰感、快节奏'}

【可用真实素材清单（只能用这些；引用必须用 './assets/<文件名>'，文件名与此处完全一致）】
${assetList || '（无图片素材——请用纯文字/渐变闪卡完成全片）'}

【创作约束 / 诚实红线（必须遵守）】
允许 AIGC 氛围动效: ${c.allowAigc ? 'true' : 'false'}
禁止断言列表 forbiddenClaims: ${JSON.stringify(c.forbiddenClaims ?? [])}
允许的卖点来源 allowedClaimSources: ${JSON.stringify(c.allowedClaimSources ?? [])}

现在，请直接输出为 ${cb.productName} 创作的完整 index.html（9:16，约 15–18 秒，真实素材 + 闪卡混排，GSAP 帧确定性动效，注册到 window.__timelines）。不要任何解释或代码围栏。`;
}

/** Strip ```html fences / surrounding prose; return the <!DOCTYPE…</html> body. */
export function stripHtmlFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  const lower = s.toLowerCase();
  const start = lower.indexOf('<!doctype');
  const startHtml = start === -1 ? lower.indexOf('<html') : start;
  const end = lower.lastIndexOf('</html>');
  if (startHtml !== -1 && end !== -1) {
    return s.slice(startHtml, end + '</html>'.length);
  }
  return s;
}

function attrNum(attrs: string, name: string): number | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Guarantee the root composition element declares an accurate `data-duration`.
 *
 * HyperFrames uses the root's `data-duration` as the AUTHORITATIVE render length
 * (it takes precedence over the GSAP timeline length). When it's missing, the
 * render falls back to the timeline length — and a trailing yoyo/repeat tween can
 * run past the last `.clip`, rendering the gap as a pure-black tail. We compute
 * the true content end = max(data-start + data-duration) across timed `.clip`
 * elements and set the root's `data-duration` to it (belt-and-suspenders behind
 * the author prompt rule).
 *
 * Pure/string-based and safe: if no root or no numeric clips are found, returns
 * the HTML unchanged. Non-numeric `data-start` (clip-id references) are skipped.
 */
export function ensureRootDuration(html: string): string {
  const tagRe = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let contentEnd = 0;
  let rootTag: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[2];
    const isRoot = /\bdata-composition-id\s*=/.test(attrs) && attrNum(attrs, 'data-width') !== null;
    if (isRoot) {
      rootTag = m[0];
      continue;
    }
    const isClip = /\bclass\s*=\s*["'][^"']*\bclip\b[^"']*["']/.test(attrs);
    const start = attrNum(attrs, 'data-start');
    const dur = attrNum(attrs, 'data-duration');
    if (isClip && start !== null && dur !== null) {
      contentEnd = Math.max(contentEnd, start + dur);
    }
  }
  if (!rootTag || contentEnd <= 0) return html;

  const durStr = String(Number(contentEnd.toFixed(3)));
  let newRootTag: string;
  if (/\bdata-duration\s*=\s*["'][^"']*["']/.test(rootTag)) {
    newRootTag = rootTag.replace(/(\bdata-duration\s*=\s*["'])[^"']*(["'])/, `$1${durStr}$2`);
  } else {
    newRootTag = rootTag.replace(
      /(\bdata-composition-id\s*=\s*["'][^"']*["'])/,
      `$1 data-duration="${durStr}"`
    );
  }
  return newRootTag === rootTag ? html : html.replace(rootTag, newRootTag);
}

export function createDoubaoHyperframesAuthor(opts: { model?: string } = {}): HyperframesAuthor {
  const client = createOpenAICompatibleClient();
  const modelId = opts.model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for the HyperFrames author.');
  }
  return {
    async authorComposition(input, revision) {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) }
      ];
      if (revision) {
        messages.push({ role: 'assistant', content: revision.html });
        messages.push({
          role: 'user',
          content: `你上面输出的 index.html 有以下需要修复的问题（来自 HyperFrames lint / inspect 校验或质检）。请逐条修复后，重新输出【完整 index.html 全文】（只输出 HTML，不要解释、不要代码围栏）：\n${revision.issues.map((i) => `- ${i}`).join('\n')}`
        });
      }
      const response = await client.chat.completions.create(
        { model: modelId, messages, temperature: 0.8, max_tokens: 8000 },
        { timeout: 90_000 }
      );
      return stripHtmlFences(response.choices[0]?.message?.content ?? '');
    }
  };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
function esc(text: string): string {
  return text.replace(/[&<>]/g, (ch) => ESC[ch] ?? ch);
}

/**
 * Deterministic fallback composition (no LLM). Lays the real images out as
 * Ken-Burns scenes with kinetic captions + white-flash cuts + a CTA flash slide,
 * registered as a paused GSAP timeline. Only references the provided ./assets files.
 */
export function mockHyperframesComposition(input: HyperframesAuthorInput): string {
  const cb = input.contentBrief;
  const points = (cb.sellingPoints && cb.sellingPoints.length ? cb.sellingPoints : [cb.productName]).slice(0, 4);
  const imgs = input.assetRefs;
  const sceneSec = 3;
  const scenes: string[] = [];
  const tl: string[] = [];
  let t = 0;
  let track = 0;

  // Opening flash text slide
  scenes.push(
    `<div class="layer clip flash-slide flash-slide-0" id="scene-intro" data-start="${t}" data-duration="2" data-track-index="${track++}">
      <div class="flash-word">${esc(points[0] ?? cb.productName)}</div>
    </div>`
  );
  tl.push(
    `tl.fromTo(".flash-slide-0",{opacity:0},{opacity:1,duration:0.2},${t});
     tl.fromTo(".flash-slide-0 .flash-word",{opacity:0,scale:2.2,letterSpacing:"40px"},{opacity:1,scale:1,letterSpacing:"6px",duration:0.5,ease:"expo.out"},${t + 0.05});
     tl.to(".flash-slide-0 .flash-word",{scale:1.08,duration:0.3,yoyo:true,repeat:1,ease:"sine.inOut"},${t + 1.0});
     tl.to(".flash-slide-0",{opacity:0,duration:0.25},${t + 1.7});`
  );
  t += 2;

  imgs.forEach((img, i) => {
    const cls = `img-${i}`;
    const cap = points[(i % points.length)] ?? cb.productName;
    scenes.push(
      `<div class="layer clip scene ${cls}" id="${cls}" data-start="${t}" data-duration="${sceneSec}" data-track-index="${track++}">
        <img class="kb-img" src="${img.relPath}" alt="" />
        <div class="cap cap-hook">${esc(cap)}</div>
      </div>`
    );
    const zoom = 1 + 0.16 + (i % 2) * 0.04;
    tl.push(
      `tl.fromTo(".${cls} .kb-img",{scale:1.0},{scale:${zoom.toFixed(2)},duration:${sceneSec},ease:"none"},${t});
       tl.fromTo(".${cls} .cap-hook",{opacity:0,scale:0.6,filter:"blur(18px)"},{opacity:1,scale:1,filter:"blur(0px)",duration:0.5,ease:"back.out(2)"},${t + 0.2});
       tl.to(".${cls} .cap-hook",{scale:1.06,duration:0.4,ease:"sine.inOut"},${t + 1.2});
       tl.to(".${cls}",{opacity:0,duration:0.3},${t + sceneSec - 0.3});
       tl.to(".whiteflash",{opacity:1,duration:0.1,ease:"power2.in"},${t + sceneSec - 0.15});
       tl.to(".whiteflash",{opacity:0,duration:0.18,ease:"power2.out"},${t + sceneSec - 0.02});`
    );
    t += sceneSec;
  });

  // CTA flash slide
  scenes.push(
    `<div class="layer clip flash-slide cta-slide" id="scene-cta" data-start="${t}" data-duration="3" data-track-index="${track++}">
      <div class="flash-word cta-word">${esc(cb.cta)}</div>
    </div>`
  );
  tl.push(
    `tl.fromTo(".cta-slide",{opacity:0},{opacity:1,duration:0.2},${t});
     tl.fromTo(".cta-word",{opacity:0,scale:0.4},{opacity:1,scale:1,duration:0.5,ease:"back.out(2.2)"},${t + 0.05});
     tl.to(".cta-word",{scale:1.06,duration:0.4,yoyo:true,repeat:2,ease:"sine.inOut"},${t + 0.8});`
  );
  const total = t + 3;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #000; }
  #ad { position: relative; width: 1080px; height: 1920px; overflow: hidden;
        font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; background: #050507; }
  .layer { position: absolute; inset: 0; }
  .kb-img { width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 42%; }
  .cap { position: absolute; left: 60px; right: 60px; text-align: center; color: #fff;
         font-weight: 900; letter-spacing: 2px; text-shadow: 0 6px 30px rgba(0,0,0,.65); }
  .cap-hook { bottom: 380px; font-size: 110px; line-height: 1.06; }
  .flash-slide { display: flex; align-items: center; justify-content: center;
                 background: linear-gradient(135deg, #ff2d2d, #ff9500); }
  .flash-word { color: #fff; font-size: 140px; font-weight: 900; letter-spacing: 6px;
                text-align: center; padding: 0 60px; line-height: 1.1; }
  .cta-slide { background: linear-gradient(135deg, #c1121f, #6a040f); }
  .cta-word { font-size: 92px; }
  .whiteflash { background: #fff; opacity: 0; }
</style>
</head>
<body>
  <div id="ad" data-composition-id="viral_ad" data-start="0" data-width="1080" data-height="1920">
${scenes.join('\n')}
    <div class="layer clip whiteflash" id="whiteflash" data-start="0" data-duration="${total}" data-track-index="99"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    var tl = gsap.timeline({ paused: true });
${tl.join('\n')}
    window.__timelines = window.__timelines || {};
    window.__timelines["viral_ad"] = tl;
  </script>
</body>
</html>
`;
}
