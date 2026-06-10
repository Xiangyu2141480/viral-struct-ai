import type { AssetCard, CategoryEquivalentVocabulary, ContentBrief, ProductIntelligence } from '@viral-struct/shared';
import { CategoryEquivalentVocabularySchema, VOCAB_ROLES, VOCAB_SUBTYPES } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';
import { sourceSpecificProfile } from './sourceSpecificAbstraction';

/**
 * Category-Equivalent Translator (MANDATORY LLM).
 *
 * Turns the product (brief + product-intelligence + the assets actually scanned) into a product-native
 * vocabulary for the structural anchors (8 abstract-grammar subtypes + 7 roles + motion tokens). This is the
 * ONLY place that decides "what does this abstract structural beat look like for THIS product"; the five
 * Director layers read the result instead of any hardcoded beverage template. There is NO deterministic
 * fallback — if the LLM is unavailable or returns an incomplete vocabulary, this throws.
 */

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface TranslateCategoryEquivalentsInput {
  contentBrief: ContentBrief;
  productIntelligence?: ProductIntelligence;
  assetCards: AssetCard[];
  clientFactory?: () => Client;
  model?: string;
  /** Test seam: when this KEY is present (even as undefined) it overrides process.env.LLM_MODEL. */
  envModel?: string;
  maxRetries?: number;
}

const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `你是短视频「结构迁移」的品类翻译器。给定一条爆款视频的抽象结构语法（与具体产品无关）、以及目标产品的描述、产品情报与真实素材证据，请把每一种抽象结构「翻译」成目标产品自己品类里**真实、具体、可执行**的等价动作与画面。

硬性要求：
1. 只用目标产品自己品类的语言。严禁出现与目标产品无关的他品类专属意象（例如目标是耳机时，绝不能出现冰块、柠檬、红茶、瓶身、倒茶、开瓶盖、汽水等饮料词；目标是饮料时则用饮料语言）。
2. 不要用跨品类有歧义的裸动词。凡涉及"盖子/打开/开启"，必须点明具体部件并用本品类说法（如耳机要写「打开充电盒」「揭开盒盖」「开盒取出耳机」，绝不要写裸的「开盖」——它会被误读为瓶盖；饮料则写「拧开瓶盖」等本品类说法）。
3. 必须落到这款产品真实可拍/可表现的动作，并尽量引用素材证据里实际出现的具体物体/部件（detectedObjects、primarySubject、kinematicElements、镜头描述）。不得编造素材里完全没有依据的部件或画面。
4. 8 个 subtype 必须各自落到**不同的部件或不同的行为逻辑**上，彼此动作不得雷同；同一个具体动作不要跨 subtype 复用。保留抽象语法的结构含义，只把表层换成本品类里最贴切且**互不相同**的具体动作，每个动作尽量点名具体部件（如耳机的充电盒/单元腔体/硅胶套/logo/金属接缝/指示灯/触控区/出音网 等）。
5. 不得出现具体品牌型号、明星、价格、医疗或功效宣称。
6. 覆盖给定的全部 subtype 与 role，缺一不可；每个 subtype 给 2-4 个 actions，越具体越好。

只输出一个 JSON 对象，结构严格为：
{"product": "产品名",
 "bySubtype": {"<subtype>": {"label": "≤10字镜头名", "actions": ["具体动作", ...]}, ...},
 "byRole": {"<role>": {"label": "≤10字", "reshootShot": "真人可拍的补拍说明", "mustCapture": ["必拍要素"], "animationHints": ["图层/动效提示"], "aigcScene": "该镜头的画面质感与氛围（光影、材质、色调、景深、情绪等感官层面），不要写具体动作或动词"}, ...},
 "tokenActions": {"<motionToken>": "该运动手法在本品类里的等价中文动作"},
 "connective": {"afterUseResult": "用'使用之后的结果'表达利益的中文短语", "productHero": "产品 hero 定格的中文短语"}}`;

function assetEvidence(cards: AssetCard[]): unknown[] {
  return cards.slice(0, 12).map((card) => {
    const card_ = card as AssetCard & { visualContent?: any; motionPotential?: any; analysis?: any };
    const vlm = card_.analysis?.vlm ?? card_.analysis;
    return {
      id: card.id,
      type: card.type,
      primarySubject: card_.visualContent?.primarySubject,
      kinematicElements: card_.visualContent?.kinematicElements,
      implicitMotion: card_.motionPotential?.implicitMotion,
      caption: vlm?.shortCaption,
      sceneType: vlm?.sceneType,
      detectedObjects: card.detectedObjects?.slice(0, 8)
    };
  });
}

function buildUserPrompt(input: TranslateCategoryEquivalentsInput): string {
  const { contentBrief: brief, productIntelligence: pi } = input;
  const anchors = {
    subtypes: VOCAB_SUBTYPES.map((subtype) => ({ subtype, abstractGrammar: sourceSpecificProfile(subtype).abstractGrammar })),
    roles: VOCAB_ROLES
  };
  const product = {
    productName: brief.productName,
    category: brief.category,
    scenario: brief.scenario,
    sellingPoints: brief.sellingPoints,
    coreBenefits: pi?.coreBenefits?.map((f) => f.value),
    sensoryCues: pi?.sensoryCues?.map((f) => f.value),
    usageRituals: pi?.usageRituals?.map((f) => f.value),
    socialContexts: pi?.socialContexts?.map((f) => f.value),
    complexity: pi?.complexity,
    proofTypes: pi?.recommendedProofTypes
  };
  return `目标产品：\n${JSON.stringify(product, null, 2)}\n\n真实素材证据（请让等价动作贴合这些素材）：\n${JSON.stringify(assetEvidence(input.assetCards), null, 2)}\n\n需要翻译的抽象结构锚点（subtype 的 abstractGrammar 是产品无关的结构，请保留其结构含义，只替换为本品类动作）：\n${JSON.stringify(anchors, null, 2)}\n\n请只输出规定结构的 JSON 本体。`;
}

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  return t.startsWith('```') ? t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim() : t;
}

function assertComplete(vocab: CategoryEquivalentVocabulary): void {
  const missingSub = VOCAB_SUBTYPES.filter((k) => !vocab.bySubtype[k]);
  const missingRole = VOCAB_ROLES.filter((k) => !vocab.byRole[k]);
  if (missingSub.length || missingRole.length) {
    throw new Error(`incomplete vocabulary: missing subtypes [${missingSub.join(',')}] roles [${missingRole.join(',')}]`);
  }
}

export async function translateCategoryEquivalents(input: TranslateCategoryEquivalentsInput): Promise<CategoryEquivalentVocabulary> {
  const envModel = 'envModel' in input ? input.envModel : process.env.LLM_MODEL;
  const model = input.model ?? envModel;
  if (!model) {
    throw new Error('LLM_MODEL is required: category-equivalent translation must run via the LLM (no fallback).');
  }
  const client = (input.clientFactory ?? createOpenAICompatibleClient)();
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(input) }
  ];
  const maxRetries = input.maxRetries ?? 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      let response;
      try {
        response = await client.chat.completions.create({ model, messages, temperature: 0.4, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' } });
      } catch (err) {
        if (!/response_format|json_object/i.test(err instanceof Error ? err.message : String(err))) throw err;
        response = await client.chat.completions.create({ model, messages, temperature: 0.4, max_tokens: MAX_TOKENS });
      }
      const raw = response.choices[0]?.message?.content ?? '';
      const vocab = CategoryEquivalentVocabularySchema.parse(JSON.parse(stripJsonFence(raw)));
      assertComplete(vocab);
      return vocab;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`category-equivalent vocabulary failed after ${maxRetries + 1} attempt(s): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
