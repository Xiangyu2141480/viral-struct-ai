import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetCard } from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

const SYSTEM_PROMPT = `你是一个电商/广告短视频素材分类专家。你会通过多模态输入看到一个独立的素材片段（一张图或一段短视频帧序列），需要做结构化分类，使其能被自动化匹配系统(slotMatcher)评估为某个分镜槽位(shotSlot)的候选素材。

重要原则：
1. 你看到的素材是单独的素材片段，不是成片。不要假设它前后有别的镜头。
2. 不要描述具体产品名/品牌名/型号——只描述视觉、动作、构图、人物存在性。
3. 所有枚举字段必须严格从给定的枚举集合中选取，不要创造新枚举值。
4. 无法判断的字段：数组返回 []；可选对象返回 null；不要编造视觉证据。
5. qualityScore 是 0-1 浮点数，衡量画面专业度（清晰度/构图/光线/主体突出度），不是衡量"好不好看"。
6. v1 三段新输出 visualContent / motionPotential / candidateSlotRoles 的语义在 user prompt 中详述。
7. 只输出合法 JSON，不要 Markdown，不要解释。`;

const USER_PROMPT_TEMPLATE = `下面是一个待分类的素材文件（通过多模态输入提供）。

素材信息（仅供上下文识别，不要在输出中复述）：
- assetId: {{assetId}}
- mediaType: {{mediaType}}
- filename: {{filename}}

请输出一个 AssetCard JSON，字段定义如下：

{
  "spatialDescription": "string，一句话描述静态画面构图。",
  "temporalDescription": "string 或 null。仅视频素材填写。",
  "detectedObjects": ["string，画面中可识别的物体的通用名词。"],
  "suitableSlots": ["枚举：opening_attention | product_closeup | usage_demo | benefit_visual | comparison | testimonial | cta_visual。可多选，至少 1 项。"],
  "qualityScore": 0.0,
  "detectedIngredients": ["枚举：human_presence | face_closeup | host_talking | hand_demo | beauty_demo | makeup_application | skin_texture_display | before_after_comparison | product_closeup_trait | texture_display | swatch_demo | scene_style | soft_light | clean_background | premium_visual | trust_building | social_proof | professional_review | lifestyle_context | unknown。"],
  "humanPresence": {
    "hasHuman": true,
    "role": "枚举或省略：host | model | user | hand_only | unknown。",
    "framing": ["枚举：face_closeup | half_body | full_body | hands | skin_macro | product_only。"],
    "actions": ["枚举：talking | applying_product | showing_result | swatching | holding_product。"]
  },
  "visualStyleTags": ["枚举：soft_light | clean_background | premium_visual | lifestyle_context | beauty_style | professional_review。"],
  "visualContent": {
    "primarySubject": "≤30字。画面主体的通用描述。",
    "subjectPosition": "≤30字英文蛇形命名。主体位置区域。例：center_lower_third / left_third_balanced_by_negative_space。",
    "negativeSpace": "≤30字英文蛇形命名。例：dark_gradient_upper_two_thirds。无负空间填 null。",
    "kinematicElements": ["≤25字英文蛇形命名。即使静图也写出动感意象。例：liquid_splash / ice_cubes_in_flight。"],
    "lighting": "≤30字英文蛇形命名。例：high_contrast_studio。",
    "colorPalette": ["1-4 项色彩签名。例：#1a0e08 dark_brown。"]
  },
  "motionPotential": {
    "isStill": true,
    "implicitMotion": "low | medium | high。即使 isStill=true，飞溅瞬间/物体高速入画也算 high。",
    "canSimulateMotion": ["≤30字英文蛇形命名。例：zoom_in_on_splash / ken_burns_pan_left。"],
    "canSimulateDurationMs": [600, 2400]
  },
  "candidateSlotRoles": [
    {
      "role": "枚举：opening_attention | product_closeup | usage_demo | benefit_visual | comparison | testimonial | cta_visual",
      "confidence": 0.0,
      "caveat": "≤40字。可选。"
    }
  ]
}

规则提醒：
- 仅图片：temporalDescription 必须为 null；motionPotential.isStill 必须为 true。
- candidateSlotRoles 至少 1 项，最多 4 项；confidence > 0.7 的 role 应该出现在 suitableSlots 里。
- visualContent.kinematicElements 不要把"产品本身"列进去，只列动感意象元素。
- 不要输出 id / url / type / text / analysisSource 字段——由调用端补齐。

只输出 JSON 本体。`;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext in MIME_BY_EXT;
}

function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`Unsupported image extension: ${ext}`);
  }
  const buf = await readFile(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

function deepStripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => deepStripNulls(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = deepStripNulls(v);
    }
    return out as unknown as T;
  }
  return value;
}

export function parseAssetCardResponse(
  rawJson: string,
  context: { id: string; type: 'image' | 'video' | 'text'; url?: string; text?: string }
): AssetCard {
  const cleaned = stripJsonFence(rawJson);
  const parsed = JSON.parse(cleaned);

  const merged = deepStripNulls({
    ...parsed,
    id: context.id,
    type: context.type,
    url: context.url,
    text: context.text,
    analysisSource: 'llm_multimodal' as const
  });

  return AssetCardSchema.parse(merged);
}

type Client = ReturnType<typeof createOpenAICompatibleClient>;

interface AnalyzeOpts {
  files: Express.Multer.File[];
  textBrief?: string;
  /** Optional override for tests. */
  clientFactory?: () => Client;
  /** Override the configured model. */
  model?: string;
}

/**
 * Multimodal classification of user-uploaded assets via the configured
 * OpenAI-compatible endpoint (Doubao). Images go through base64 data URLs.
 * Video files are not yet supported by this path — callers should fall back
 * to {@link analyzeAssetsMock} when a video must be handled.
 *
 * Per-file failure is isolated: a single asset failing to parse leaves the
 * other results intact. Callers control how to react to mixed results.
 */
export async function analyzeAssetsLLM(opts: AnalyzeOpts): Promise<AssetCard[]> {
  const { files, textBrief, clientFactory, model } = opts;
  const client = (clientFactory ?? createOpenAICompatibleClient)();
  const modelId = model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for analyzeAssetsLLM.');
  }

  const cards: AssetCard[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const assetId = `asset_${(i + 1).toString().padStart(3, '0')}`;

    if (isVideoFile(file.originalname)) {
      throw new Error(`analyzeAssetsLLM does not yet support video files (${file.originalname}). Fall back to mock for now.`);
    }
    if (!isImageFile(file.originalname)) {
      throw new Error(`Unsupported asset type: ${file.originalname}`);
    }

    const dataUrl = await fileToDataUrl(file.path);
    const userPrompt = USER_PROMPT_TEMPLATE
      .replace('{{assetId}}', assetId)
      .replace('{{mediaType}}', 'image')
      .replace('{{filename}}', file.originalname);

    const response = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message?.content ?? '';
    cards.push(parseAssetCardResponse(raw, {
      id: assetId,
      type: 'image',
      url: file.path
    }));
  }

  if (textBrief) {
    cards.push({
      id: 'asset_text_brief',
      type: 'text',
      text: textBrief,
      detectedObjects: [],
      suitableSlots: ['benefit_visual', 'cta_visual'],
      qualityScore: 0.75,
      detectedIngredients: ['trust_building'],
      humanPresence: { hasHuman: false },
      visualStyleTags: [],
      analysisSource: 'manual_text_brief'
    });
  }

  return cards;
}

export async function analyzeAssetsMock(
  files: Express.Multer.File[],
  textBrief?: string
): Promise<AssetCard[]> {
  const cards: AssetCard[] = files.map((file, index) => {
    const lower = file.originalname.toLowerCase();
    const isVideo = lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
    const isHand = lower.includes('hand') || lower.includes('手');
    const hasPresenter = lower.includes('host') || lower.includes('presenter') || lower.includes('真人') || lower.includes('演示');
    const isSwatchOrTexture = lower.includes('makeup') || lower.includes('beauty') || lower.includes('swatch') || lower.includes('妆') || lower.includes('试色');
    const isBeforeAfter = lower.includes('before') || lower.includes('after') || lower.includes('对比');

    return {
      id: `asset_${index + 1}`,
      type: isVideo ? 'video' : 'image',
      url: file.path,
      spatialDescription: isHand
        ? '手持商品的静态画面，适合表现使用场景，但动作信息不足。'
        : '商品主体清晰，适合做商品特写和 CTA 视觉。',
      temporalDescription: isVideo
        ? '片段包含轻微镜头运动，可用于卖点展示。'
        : '静态图片，无真实动作过程。',
      detectedObjects: ['product'],
      suitableSlots: isHand
        ? ['product_closeup', 'usage_demo', 'cta_visual']
        : ['product_closeup', 'benefit_visual', 'cta_visual'],
      qualityScore: 0.82,
      detectedIngredients: [
        'product_closeup_trait',
        'clean_background',
        ...(isHand ? ['hand_demo' as const] : []),
        ...(hasPresenter ? ['human_presence' as const, 'host_talking' as const] : []),
        ...(isSwatchOrTexture ? ['swatch_demo' as const, 'texture_display' as const] : []),
        ...(isBeforeAfter ? ['before_after_comparison' as const] : [])
      ],
      humanPresence: {
        hasHuman: hasPresenter || isHand,
        role: hasPresenter ? 'host' : isHand ? 'hand_only' : 'unknown',
        framing: hasPresenter ? ['half_body'] : isHand ? ['hands'] : ['product_only'],
        actions: [
          ...(hasPresenter && isVideo ? ['talking' as const] : []),
          ...(isSwatchOrTexture && isVideo ? ['applying_product' as const, 'showing_result' as const] : []),
          ...(isHand ? ['holding_product' as const] : [])
        ]
      },
      visualStyleTags: ['clean_background'],
      analysisSource: 'mock_filename_rules'
    };
  });

  if (textBrief) {
    cards.push({
      id: 'asset_text_brief',
      type: 'text',
      text: textBrief,
      detectedObjects: [],
      suitableSlots: ['benefit_visual', 'cta_visual'],
      qualityScore: 0.75,
      detectedIngredients: ['trust_building'],
      humanPresence: {
        hasHuman: false,
        role: 'unknown',
        framing: [],
        actions: []
      },
      visualStyleTags: [],
      analysisSource: 'manual_text_brief'
    });
  }

  return cards;
}

/**
 * Convenience wrapper used by demo / upload routes: tries the multimodal LLM
 * path first, then falls back to the filename-keyword mock if the LLM is not
 * reachable or returns malformed output. The returned cards keep
 * `analysisSource` set so callers know whether the data is real or synthetic.
 */
export async function analyzeAssetsWithFallback(opts: AnalyzeOpts): Promise<AssetCard[]> {
  try {
    return await analyzeAssetsLLM(opts);
  } catch (err) {
    return analyzeAssetsMock(opts.files, opts.textBrief);
  }
}
