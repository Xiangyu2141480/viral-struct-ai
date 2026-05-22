import type {
  CreativeIngredient,
  CreativeIngredientEvidence,
  CreativeIngredientType,
  GapRepairStrategy,
  SegmentNode,
  SegmentRole,
  Shot,
  ShotSlotNode,
  ShotSlotRole,
  TranscriptSegment,
  VideoAnalysis,
  ViralStructureGraph
} from '@viral-struct/shared';
import { extractCreativeIngredientsMock } from './visualIngredientExtractor';

type StructureSource = {
  start: number;
  end: number;
  text: string;
  transcript?: TranscriptSegment;
  shot?: Shot;
  keyframeUrl?: string;
  keyframeDescription?: string;
};

export async function extractStructureGraph(
  videoAnalysis?: VideoAnalysis
): Promise<ViralStructureGraph> {
  if (!isUsableVideoAnalysis(videoAnalysis)) {
    return buildMockFallbackGraph();
  }

  try {
    return buildRuleBasedGraph(videoAnalysis);
  } catch {
    return buildMockFallbackGraph();
  }
}

export async function extractStructureMock(
  videoAnalysis?: VideoAnalysis
): Promise<ViralStructureGraph> {
  return extractStructureGraph(videoAnalysis);
}

function buildRuleBasedGraph(videoAnalysis: VideoAnalysis): ViralStructureGraph {
  const duration = safeDuration(videoAnalysis.metadata.duration);
  const sources = buildStructureSources(videoAnalysis, duration);
  const segments = sources.map((source, index) => buildSegment(source, index, sources.length));
  const shotSlots = segments.map((segment, index) =>
    buildShotSlot(segment, sources[index], index, segments.length)
  );
  const avgShotDuration = getAverageShotDuration(videoAnalysis.shots, duration, segments.length);
  const cutFrequency = classifyCutFrequency(avgShotDuration);
  const creativeIngredients = buildCreativeIngredients(videoAnalysis, segments, shotSlots);

  return {
    meta: {
      duration,
      aspectRatio: videoAnalysis.metadata.aspectRatio,
      videoType: inferVideoType(videoAnalysis),
      style: inferStyle(videoAnalysis, cutFrequency)
    },
    structureSummary: buildSummary(videoAnalysis, segments, cutFrequency),
    segments,
    shotSlots,
    rhythm: {
      avgShotDuration,
      cutFrequency,
      peakAt: findPeakAt(segments),
      pattern: buildRhythmPattern(segments, cutFrequency)
    },
    packaging: buildPackaging(videoAnalysis, duration),
    creativeIngredients,
    edges: buildEdges(segments, shotSlots, creativeIngredients)
  };
}

function buildMockFallbackGraph(): ViralStructureGraph {
  const duration = 15;
  const creativeIngredients = extractCreativeIngredientsMock();

  return {
    meta: {
      duration,
      aspectRatio: '9:16',
      videoType: 'ecommerce',
      style: 'high_click'
    },
    structureSummary:
      '该样例采用「强 Hook → 痛点 → 核心卖点 → 对比证明 → CTA」的营销短视频结构，前 3 秒节奏快，后半段用卖点卡和对比卡提高转化。',
    segments: [
      {
        id: 'seg_hook',
        role: 'hook',
        start: 0,
        end: 2,
        duration: 2,
        purpose: '制造注意力和冲突',
        caption: '你还在这样选 XX？',
        transferRule: '替换为新商品的高频痛点或反常识问题。',
        importance: 5
      },
      {
        id: 'seg_pain',
        role: 'pain_point',
        start: 2,
        end: 4,
        duration: 2,
        purpose: '让用户意识到当前方案的问题',
        caption: '普通方案的问题',
        transferRule: '用新商品目标用户最常见的使用痛点展开。',
        importance: 4
      },
      {
        id: 'seg_sp1',
        role: 'selling_point',
        start: 4,
        end: 8,
        duration: 4,
        purpose: '展示核心卖点',
        caption: '核心功能 / 核心卖点',
        transferRule: '优先映射到新商品最能带来转化的卖点。',
        importance: 5
      },
      {
        id: 'seg_proof',
        role: 'comparison',
        start: 8,
        end: 12,
        duration: 4,
        purpose: '通过对比或证明增强可信度',
        caption: '对比证明',
        transferRule: '使用对比、数据卡或用户评价证明卖点。',
        importance: 4
      },
      {
        id: 'seg_cta',
        role: 'cta',
        start: 12,
        end: 15,
        duration: 3,
        purpose: '促成行动',
        caption: '立即行动',
        transferRule: '用新商品场景化 CTA 收束。',
        importance: 4
      }
    ],
    shotSlots: [
      {
        id: 'slot_hook_visual',
        segmentId: 'seg_hook',
        role: 'opening_attention',
        requiredAsset: { type: 'video', subject: '强视觉开头或冲突场景', motion: 'fast_cut', minDuration: 1.5 },
        visualIngredientRequirements: ['scene_style', 'product_closeup_trait'],
        humanRequirement: { required: false },
        fallbackStrategies: ['product_closeup_replacement', 'caption_rewrite', 'text_card'],
        importance: 5
      },
      {
        id: 'slot_product_closeup',
        segmentId: 'seg_sp1',
        role: 'product_closeup',
        requiredAsset: { type: 'image', subject: '商品清晰特写', camera: 'closeup' },
        visualIngredientRequirements: ['product_closeup_trait', 'soft_light', 'clean_background'],
        fallbackStrategies: ['crop_zoom', 'selling_point_card', 'style_filter_suggestion'],
        importance: 4
      },
      {
        id: 'slot_usage_demo',
        segmentId: 'seg_sp1',
        role: 'usage_demo',
        requiredAsset: { type: 'video', subject: '手部操作或商品使用过程', motion: 'hand_operation', minDuration: 2 },
        visualIngredientRequirements: ['hand_demo', 'product_closeup_trait', 'soft_light'],
        humanRequirement: {
          required: true,
          role: 'hand_only',
          framing: 'hands',
          action: 'holding_product'
        },
        fallbackStrategies: ['hand_demo', 'selling_point_card', 'caption_rewrite'],
        importance: 5
      },
      {
        id: 'slot_comparison',
        segmentId: 'seg_proof',
        role: 'comparison',
        requiredAsset: { type: 'video', subject: '使用前后或竞品对比', minDuration: 2 },
        visualIngredientRequirements: ['before_after_comparison', 'trust_building'],
        fallbackStrategies: ['before_after_card', 'comparison_card', 'trust_card'],
        importance: 4
      },
      {
        id: 'slot_cta',
        segmentId: 'seg_cta',
        role: 'cta_visual',
        requiredAsset: { type: 'generated', subject: '结尾行动卡' },
        visualIngredientRequirements: ['trust_building', 'social_proof'],
        fallbackStrategies: ['cta_card', 'selling_point_card', 'trust_card'],
        importance: 4
      }
    ],
    rhythm: {
      avgShotDuration: 1.2,
      cutFrequency: 'high',
      peakAt: 8,
      pattern: 'fast_hook_medium_selling_point_fast_cta'
    },
    packaging: {
      captionDensity: 'high',
      captionPosition: 'bottom_center',
      titleStyle: 'large_bold_center_with_emphasis',
      cardTypes: ['title_card', 'selling_point_card', 'comparison_card', 'cta_card'],
      transitions: ['quick_cut', 'zoom_in', 'push'],
      coverStyle: 'product_left_big_headline_right'
    },
    creativeIngredients,
    edges: [
      { from: 'seg_hook', to: 'seg_pain', type: 'sequence' },
      { from: 'seg_pain', to: 'seg_sp1', type: 'sequence' },
      { from: 'seg_sp1', to: 'seg_proof', type: 'sequence' },
      { from: 'seg_proof', to: 'seg_cta', type: 'sequence' }
    ]
  };
}

function isUsableVideoAnalysis(value: VideoAnalysis | undefined): value is VideoAnalysis {
  return Boolean(
    value?.metadata &&
    Number.isFinite(value.metadata.duration) &&
    Array.isArray(value.shots) &&
    Array.isArray(value.keyframes) &&
    Array.isArray(value.transcript)
  );
}

function buildStructureSources(videoAnalysis: VideoAnalysis, duration: number): StructureSource[] {
  const transcript = normalizeTranscript(videoAnalysis.transcript, duration);
  const shots = normalizeShots(videoAnalysis.shots, duration);

  if (transcript.length > 0 && transcript.length < 3 && shots.length >= 3) {
    const transcriptChunks = splitTranscriptForShots(transcript, shots.length);
    return shots.map((shot, index) => {
      const center = midpoint(shot.start, shot.end);
      const keyframe = findKeyframeForTime(videoAnalysis, center);
      const chunk = transcriptChunks[index];
      const text = [shot.description, chunk].filter(Boolean).join('：') || `镜头 ${index + 1}`;

      return {
        start: shot.start,
        end: shot.end,
        text,
        transcript: transcript[Math.min(index, transcript.length - 1)],
        shot,
        keyframeUrl: shot.keyframeUrl || keyframe?.url,
        keyframeDescription: keyframe?.description
      };
    });
  }

  if (transcript.length) {
    return transcript.map((segment) => {
      const center = midpoint(segment.start, segment.end);
      const shot = findShotForTime(videoAnalysis.shots, center);
      const keyframe = findKeyframeForTime(videoAnalysis, center);

      return {
        start: segment.start,
        end: segment.end,
        text: segment.text,
        transcript: segment,
        shot,
        keyframeUrl: keyframe?.url,
        keyframeDescription: keyframe?.description
      };
    });
  }

  return shots.map((shot, index) => {
    const center = midpoint(shot.start, shot.end);
    const keyframe = findKeyframeForTime(videoAnalysis, center);

    return {
      start: shot.start,
      end: shot.end,
      text: shot.description || `镜头 ${index + 1}`,
      shot,
      keyframeUrl: shot.keyframeUrl || keyframe?.url,
      keyframeDescription: keyframe?.description
    };
  });
}

function splitTranscriptForShots(transcript: TranscriptSegment[], count: number): string[] {
  const text = transcript.map((segment) => segment.text).join(' ').trim();
  const sentences = text
    .replace(/([。！？!?；;])/g, '$1\n')
    .split(/\s*\n\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentences.length >= count) {
    return sentences.slice(0, count - 1).concat(sentences.slice(count - 1).join(' '));
  }

  if (sentences.length > 1) {
    return distributeItems(sentences, count);
  }

  const chunkSize = Math.max(1, Math.ceil(text.length / count));
  return Array.from({ length: count }, (_value, index) =>
    text.slice(index * chunkSize, (index + 1) * chunkSize).trim()
  );
}

function distributeItems(items: string[], count: number): string[] {
  const buckets = Array.from({ length: count }, () => [] as string[]);

  items.forEach((item, index) => {
    const bucketIndex = Math.min(count - 1, Math.floor((index * count) / items.length));
    buckets[bucketIndex].push(item);
  });

  return buckets.map((bucket) => bucket.join(' '));
}

function normalizeTranscript(transcript: TranscriptSegment[], duration: number): TranscriptSegment[] {
  return transcript
    .map((segment) => ({
      start: clamp(round(segment.start), 0, duration),
      end: clamp(round(segment.end), 0, duration),
      text: segment.text.trim()
    }))
    .filter((segment) => segment.text && segment.end > segment.start);
}

function normalizeShots(shots: Shot[], duration: number): Shot[] {
  const validShots = shots
    .map((shot) => ({
      ...shot,
      start: clamp(round(shot.start), 0, duration),
      end: clamp(round(shot.end), 0, duration)
    }))
    .filter((shot) => shot.end > shot.start);

  if (validShots.length) {
    return validShots;
  }

  const count = duration <= 8 ? 3 : 5;
  return Array.from({ length: count }, (_value, index) => ({
    id: `shot_auto_${index + 1}`,
    start: round((duration * index) / count),
    end: round(index === count - 1 ? duration : (duration * (index + 1)) / count),
    description: `按时长保底切分的镜头 ${index + 1}`
  }));
}

function buildSegment(source: StructureSource, index: number, total: number): SegmentNode {
  const role = inferSegmentRole(source.text, index, total);
  const evidence = buildEvidenceText(source);
  const caption = summarize(source.text, 32);

  return {
    id: `seg_${role}_${index + 1}`,
    role,
    start: source.start,
    end: source.end,
    duration: round(source.end - source.start),
    purpose: `${purposeForRole(role)}；依据：${evidence}`,
    narration: source.transcript?.text,
    caption,
    transferRule: `${transferRuleForRole(role)} 原样例证据：${evidence}`,
    importance: importanceForRole(role)
  };
}

function buildShotSlot(
  segment: SegmentNode,
  source: StructureSource,
  index: number,
  total: number
): ShotSlotNode {
  const role = slotRoleForSegment(segment.role, index, total);
  const requirements = ingredientRequirementsForSlot(role, source.text);

  return {
    id: `slot_${role}_${index + 1}`,
    segmentId: segment.id,
    role,
    requiredAsset: {
      type: role === 'cta_visual' ? 'generated' : 'video',
      subject: `${slotLabel(role)}：${summarize(source.text, 36)}`,
      camera: cameraForSlot(role),
      motion: motionForSlot(role),
      minDuration: Math.max(1, Math.min(4, segment.duration))
    },
    visualIngredientRequirements: requirements,
    humanRequirement: humanRequirementForRequirements(requirements),
    fallbackStrategies: fallbackStrategiesForSlot(role),
    importance: segment.importance
  };
}

function inferSegmentRole(text: string, index: number, total: number): SegmentRole {
  const normalized = text.toLowerCase();

  if (index === 0) {
    return 'hook';
  }
  if (index === total - 1) {
    return 'cta';
  }
  if (/痛点|问题|普通|不够|容易|麻烦|困扰|尴尬|还在/.test(normalized)) {
    return 'pain_point';
  }
  if (/对比|证明|实测|测试|评价|口碑|数据|前后|不漏|效果/.test(normalized)) {
    return 'proof';
  }
  if (/使用|试用|演示|步骤|打开|涂|拿|倒|操作|安装|上手/.test(normalized)) {
    return 'usage';
  }
  if (/卖点|核心|功能|保温|优势|升级|成分|设计|清晰|特写/.test(normalized)) {
    return 'selling_point';
  }
  if (index >= Math.max(1, total - 2)) {
    return 'proof';
  }
  return 'selling_point';
}

function slotRoleForSegment(role: SegmentRole, index: number, total: number): ShotSlotRole {
  if (role === 'hook') {
    return 'opening_attention';
  }
  if (role === 'pain_point') {
    return 'benefit_visual';
  }
  if (role === 'selling_point') {
    return index <= Math.ceil(total / 2) ? 'product_closeup' : 'benefit_visual';
  }
  if (role === 'usage') {
    return 'usage_demo';
  }
  if (role === 'proof' || role === 'comparison') {
    return 'comparison';
  }
  return 'cta_visual';
}

function buildCreativeIngredients(
  videoAnalysis: VideoAnalysis,
  segments: SegmentNode[],
  shotSlots: ShotSlotNode[]
): CreativeIngredient[] {
  const text = searchableText(videoAnalysis);
  const ingredients: CreativeIngredient[] = [];
  const transcriptEvidenceItems = transcriptEvidence(videoAnalysis);

  if (transcriptEvidenceItems.length) {
    ingredients.push(buildIngredient({
      id: 'ing_caption_driven_structure',
      type: 'scene_style',
      name: '字幕驱动的信息节奏',
      description: '样例可通过字幕段落拆成开头、痛点、卖点、证明和行动召唤，适合迁移为新商品脚本。',
      segmentIds: segments.map((segment) => segment.id),
      requiredForSlotIds: shotSlots.map((slot) => slot.id),
      transferability: 'can_be_recreated_by_packaging',
      fallbackStrategies: ['caption_rewrite', 'text_card'],
      evidence: transcriptEvidenceItems,
      confidence: 0.78
    }));
  }

  if (/特写|产品|商品|杯|电脑|口红|奶粉|酒|保温|macbook|chanel|ysl|saint|laurent/i.test(text)) {
    ingredients.push(buildIngredient({
      id: 'ing_product_focus',
      type: 'product_closeup_trait',
      name: '商品聚焦展示',
      description: '样例中段围绕商品、功能或使用场景展开，需要迁移为新商品的清晰特写或卖点视觉。',
      segmentIds: idsForRoles(segments, ['selling_point', 'usage', 'proof']),
      requiredForSlotIds: idsForSlotRoles(shotSlots, ['product_closeup', 'usage_demo', 'benefit_visual']),
      transferability: 'requires_user_asset',
      requiredAssets: ['product_closeup', 'usage_demo'],
      fallbackStrategies: ['crop_zoom', 'selling_point_card', 'product_closeup_replacement'],
      evidence: frameAndTextEvidence(videoAnalysis),
      confidence: 0.74
    }));
  }

  if (/实测|对比|证明|评价|口碑|数据|前后|不漏|放心|效果/.test(text)) {
    ingredients.push(buildIngredient({
      id: 'ing_trust_proof',
      type: 'trust_building',
      name: '证明与信任建立',
      description: '样例使用实测、对比、结果或评价类信息增强可信度，迁移时需要补足证明卡或对比卡。',
      segmentIds: idsForRoles(segments, ['proof', 'comparison', 'cta']),
      requiredForSlotIds: idsForSlotRoles(shotSlots, ['comparison', 'testimonial', 'cta_visual']),
      transferability: 'can_be_replaced_by_repair',
      fallbackStrategies: ['comparison_card', 'trust_card', 'cta_card'],
      evidence: transcriptEvidence(videoAnalysis).concat(frameEvidence(videoAnalysis)).slice(0, 4),
      confidence: 0.72
    }));
  }

  if (/手|拿|打开|倒|涂|试用|操作|演示|安装|使用/.test(text)) {
    ingredients.push(buildIngredient({
      id: 'ing_operation_demo',
      type: 'hand_demo',
      name: '操作演示动作',
      description: '样例包含使用、操作或演示语义，迁移时优先匹配手部演示、产品操作或步骤类素材。',
      segmentIds: idsForRoles(segments, ['usage', 'selling_point', 'proof']),
      requiredForSlotIds: idsForSlotRoles(shotSlots, ['usage_demo', 'product_closeup']),
      transferability: 'requires_user_asset',
      requiredAssets: ['hand_operation_video'],
      fallbackStrategies: ['hand_demo', 'caption_rewrite', 'reuse_asset'],
      evidence: transcriptEvidence(videoAnalysis).concat(timestampEvidence(videoAnalysis)).slice(0, 4),
      confidence: 0.68
    }));
  }

  if (videoAnalysis.metadata.aspectRatio === '9:16' || /柔光|干净|高亮|质感|高级|premium/i.test(text)) {
    ingredients.push(buildIngredient({
      id: 'ing_mobile_packaging_style',
      type: videoAnalysis.metadata.aspectRatio === '9:16' ? 'scene_style' : 'premium_visual',
      name: '移动端包装风格',
      description: '样例比例和关键帧支持短视频信息卡包装，迁移时可复用字幕卡、卖点卡和 CTA 卡节奏。',
      segmentIds: segments.slice(0, 3).map((segment) => segment.id),
      requiredForSlotIds: shotSlots.slice(0, 3).map((slot) => slot.id),
      transferability: 'can_be_recreated_by_packaging',
      fallbackStrategies: ['text_card', 'selling_point_card', 'style_filter_suggestion'],
      evidence: frameEvidence(videoAnalysis).concat([{ type: 'timestamp', value: `aspectRatio=${videoAnalysis.metadata.aspectRatio}` }]),
      confidence: 0.64
    }));
  }

  return mergeWithMockFallback(ingredients, segments, shotSlots);
}

function mergeWithMockFallback(
  ingredients: CreativeIngredient[],
  segments: SegmentNode[],
  shotSlots: ShotSlotNode[]
): CreativeIngredient[] {
  if (ingredients.length >= 2) {
    return ingredients;
  }

  const segmentIds = segments.map((segment) => segment.id);
  const slotIds = shotSlots.map((slot) => slot.id);
  const fallback = extractCreativeIngredientsMock().slice(0, 2 - ingredients.length).map((ingredient, index) => ({
    ...ingredient,
    id: `ing_mock_fallback_${index + 1}`,
    segmentIds: segmentIds.slice(0, Math.min(3, segmentIds.length)),
    requiredForSlotIds: slotIds.slice(0, Math.min(3, slotIds.length)),
    evidence: [
      {
        type: 'model_observation' as const,
        value: '规则证据不足，保留 mock creativeIngredient 作为 demo fallback。'
      }
    ],
    confidence: Math.min(ingredient.confidence, 0.55)
  }));

  return ingredients.concat(fallback);
}

function buildIngredient(input: {
  id: string;
  type: CreativeIngredientType;
  name: string;
  description: string;
  segmentIds: string[];
  requiredForSlotIds: string[];
  transferability: CreativeIngredient['transferability'];
  requiredAssets?: string[];
  fallbackStrategies: GapRepairStrategy[];
  evidence: CreativeIngredientEvidence[];
  confidence: number;
}): CreativeIngredient {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    description: input.description,
    segmentIds: input.segmentIds.length ? input.segmentIds : [],
    requiredForSlotIds: input.requiredForSlotIds.length ? input.requiredForSlotIds : [],
    transferability: input.transferability,
    requiredAssets: input.requiredAssets,
    fallbackStrategies: input.fallbackStrategies,
    evidence: input.evidence.length ? input.evidence : [{ type: 'model_observation', value: '规则引擎生成，无额外证据。' }],
    confidence: input.confidence
  };
}

function buildPackaging(videoAnalysis: VideoAnalysis, duration: number): ViralStructureGraph['packaging'] {
  const captionDensity = classifyCaptionDensity(normalizeTranscript(videoAnalysis.transcript, duration).length, duration);
  const isVertical = videoAnalysis.metadata.aspectRatio === '9:16';
  const keyframeCount = videoAnalysis.keyframes.length;

  return {
    captionDensity,
    captionPosition: isVertical ? 'bottom_center' : 'mixed',
    titleStyle: captionDensity === 'high' ? 'caption_led_key_points' : 'shot_led_summary_cards',
    cardTypes: keyframeCount >= 4
      ? ['title_card', 'selling_point_card', 'comparison_card', 'cta_card']
      : ['title_card', 'selling_point_card', 'cta_card'],
    transitions: getAverageShotDuration(videoAnalysis.shots, duration, 5) <= 2
      ? ['quick_cut', 'zoom_in', 'push']
      : ['clean_cut', 'caption_card'],
    coverStyle: `${videoAnalysis.metadata.aspectRatio}_cover_${keyframeCount}_keyframes`
  };
}

function buildEdges(
  segments: SegmentNode[],
  shotSlots: ShotSlotNode[],
  ingredients: CreativeIngredient[]
): ViralStructureGraph['edges'] {
  return [
    ...segments.slice(0, -1).map((segment, index) => ({
      from: segment.id,
      to: segments[index + 1].id,
      type: 'sequence' as const,
      explanation: '按字幕或镜头时间顺序推进。'
    })),
    ...shotSlots.map((slot) => ({
      from: slot.segmentId,
      to: slot.id,
      type: 'requires' as const,
      explanation: '该结构段需要这个素材槽位承载。'
    })),
    ...ingredients.flatMap((ingredient) =>
      ingredient.requiredForSlotIds.map((slotId) => ({
        from: ingredient.id,
        to: slotId,
        type: 'maps_to' as const,
        explanation: 'creativeIngredient 影响槽位素材选择或包装补全。'
      }))
    )
  ];
}

function purposeForRole(role: SegmentRole): string {
  const map: Record<SegmentRole, string> = {
    hook: '开头制造注意力和观看理由',
    pain_point: '放大目标用户当前方案的问题',
    selling_point: '展示核心卖点和商品价值',
    proof: '用证明信息增强可信度',
    usage: '展示使用动作或操作场景',
    comparison: '通过对比强化差异',
    cta: '用行动召唤完成收束'
  };
  return map[role];
}

function transferRuleForRole(role: SegmentRole): string {
  const map: Record<SegmentRole, string> = {
    hook: '迁移为新商品的高频痛点、反常识问题或强利益点开头。',
    pain_point: '替换为新目标用户最容易共鸣的使用阻碍。',
    selling_point: '映射到新商品最能支撑转化的核心卖点。',
    proof: '替换为实测、评价、数据卡或可信解释。',
    usage: '用用户素材中的真实操作、手部演示或使用场景承接。',
    comparison: '迁移为前后对比、竞品对比或效果对照卡。',
    cta: '替换为新商品的场景化购买、咨询或关注提示。'
  };
  return map[role];
}

function importanceForRole(role: SegmentRole): 1 | 2 | 3 | 4 | 5 {
  if (role === 'hook' || role === 'selling_point') {
    return 5;
  }
  if (role === 'pain_point' || role === 'proof' || role === 'usage' || role === 'comparison' || role === 'cta') {
    return 4;
  }
  return 3;
}

function ingredientRequirementsForSlot(role: ShotSlotRole, text: string): CreativeIngredientType[] {
  if (role === 'opening_attention') {
    return ['scene_style'];
  }
  if (role === 'product_closeup') {
    return ['product_closeup_trait', 'clean_background'];
  }
  if (role === 'usage_demo') {
    return ['hand_demo', 'product_closeup_trait'];
  }
  if (role === 'comparison') {
    return /前后|对比/.test(text) ? ['before_after_comparison', 'trust_building'] : ['trust_building'];
  }
  if (role === 'cta_visual') {
    return ['trust_building', 'social_proof'];
  }
  return ['scene_style'];
}

function humanRequirementForRequirements(
  requirements: CreativeIngredientType[]
): ShotSlotNode['humanRequirement'] {
  if (requirements.includes('hand_demo')) {
    return {
      required: true,
      role: 'hand_only',
      framing: 'hands',
      action: 'holding_product'
    };
  }

  return { required: false };
}

function fallbackStrategiesForSlot(role: ShotSlotRole): GapRepairStrategy[] {
  const map: Record<ShotSlotRole, GapRepairStrategy[]> = {
    opening_attention: ['caption_rewrite', 'text_card', 'product_closeup_replacement'],
    product_closeup: ['crop_zoom', 'selling_point_card', 'style_filter_suggestion'],
    usage_demo: ['hand_demo', 'caption_rewrite', 'reuse_asset'],
    benefit_visual: ['selling_point_card', 'text_card', 'reuse_asset'],
    comparison: ['comparison_card', 'before_after_card', 'trust_card'],
    testimonial: ['trust_card', 'caption_rewrite'],
    cta_visual: ['cta_card', 'trust_card']
  };
  return map[role];
}

function cameraForSlot(role: ShotSlotRole): ShotSlotNode['requiredAsset']['camera'] {
  if (role === 'product_closeup' || role === 'opening_attention') {
    return 'closeup';
  }
  if (role === 'usage_demo') {
    return 'medium';
  }
  return 'unknown';
}

function motionForSlot(role: ShotSlotRole): ShotSlotNode['requiredAsset']['motion'] {
  if (role === 'opening_attention') {
    return 'fast_cut';
  }
  if (role === 'usage_demo') {
    return 'hand_operation';
  }
  if (role === 'product_closeup') {
    return 'push_in';
  }
  return 'static';
}

function slotLabel(role: ShotSlotRole): string {
  const map: Record<ShotSlotRole, string> = {
    opening_attention: '开头注意力镜头',
    product_closeup: '商品特写镜头',
    usage_demo: '使用演示镜头',
    benefit_visual: '利益点视觉',
    comparison: '证明或对比镜头',
    testimonial: '评价证言镜头',
    cta_visual: '行动召唤视觉'
  };
  return map[role];
}

function buildEvidenceText(source: StructureSource): string {
  const pieces = [
    source.transcript ? `transcript ${formatSeconds(source.transcript.start)}-${formatSeconds(source.transcript.end)}` : '',
    source.shot ? `shot ${source.shot.id} ${formatSeconds(source.shot.start)}-${formatSeconds(source.shot.end)}` : '',
    source.keyframeUrl ? `keyframe ${source.keyframeUrl}${source.keyframeDescription ? ` ${source.keyframeDescription}` : ''}` : ''
  ].filter(Boolean);

  return pieces.join('；') || '规则保底切分';
}

function buildSummary(
  videoAnalysis: VideoAnalysis,
  segments: SegmentNode[],
  cutFrequency: ViralStructureGraph['rhythm']['cutFrequency']
): string {
  const roles = segments.map((segment) => roleName(segment.role)).join(' → ');
  const transcriptCount = normalizeTranscript(videoAnalysis.transcript, safeDuration(videoAnalysis.metadata.duration)).length;
  const source = transcriptCount
    ? `${transcriptCount} 段字幕`
    : `${videoAnalysis.shots.length || segments.length} 段镜头`;
  return `基于 M1 的 ${source} 和 ${videoAnalysis.keyframes.length} 张关键帧，规则引擎生成「${roles}」结构；节奏为 ${cutFrequency}，可迁移重点是开头表达、卖点承接、证明方式和 CTA 收束。`;
}

function roleName(role: SegmentRole): string {
  const map: Record<SegmentRole, string> = {
    hook: 'Hook',
    pain_point: '痛点',
    selling_point: '卖点',
    proof: '证明',
    usage: '使用',
    comparison: '对比',
    cta: 'CTA'
  };
  return map[role];
}

function inferVideoType(videoAnalysis: VideoAnalysis): ViralStructureGraph['meta']['videoType'] {
  const text = searchableText(videoAnalysis);
  if (/课程|学习|训练|老师|教程/.test(text)) {
    return 'course';
  }
  if (/门店|到店|附近|预约|本地/.test(text)) {
    return 'local_service';
  }
  if (/品牌|发布|故事|理念|chanel|ysl|saint|laurent|macbook/i.test(text)) {
    return 'brand';
  }
  return 'ecommerce';
}

function inferStyle(
  videoAnalysis: VideoAnalysis,
  cutFrequency: ViralStructureGraph['rhythm']['cutFrequency']
): ViralStructureGraph['meta']['style'] {
  const text = searchableText(videoAnalysis);
  if (/高级|质感|品牌|chanel|ysl|saint|laurent|macbook/i.test(text)) {
    return 'premium';
  }
  if (cutFrequency === 'high') {
    return 'high_click';
  }
  if (/下单|领取|购买|咨询|立即|转化/.test(text)) {
    return 'high_conversion';
  }
  return 'unknown';
}

function classifyCutFrequency(avgShotDuration: number): ViralStructureGraph['rhythm']['cutFrequency'] {
  if (avgShotDuration <= 2) {
    return 'high';
  }
  if (avgShotDuration <= 4) {
    return 'medium';
  }
  return 'low';
}

function classifyCaptionDensity(count: number, duration: number): ViralStructureGraph['packaging']['captionDensity'] {
  const perTenSeconds = duration > 0 ? (count / duration) * 10 : count;
  if (perTenSeconds >= 2) {
    return 'high';
  }
  if (perTenSeconds >= 0.8) {
    return 'medium';
  }
  return 'low';
}

function buildRhythmPattern(
  segments: SegmentNode[],
  cutFrequency: ViralStructureGraph['rhythm']['cutFrequency']
): string {
  return `${cutFrequency}_${segments.map((segment) => segment.role).join('_')}`;
}

function findPeakAt(segments: SegmentNode[]): number | undefined {
  const peak = segments.find((segment) => segment.role === 'selling_point' || segment.role === 'proof') ?? segments[0];
  return peak?.start;
}

function getAverageShotDuration(shots: Shot[], duration: number, fallbackCount: number): number {
  const validDurations = shots.map((shot) => shot.end - shot.start).filter((value) => value > 0);
  if (validDurations.length) {
    return round(validDurations.reduce((total, value) => total + value, 0) / validDurations.length);
  }
  return round(duration / Math.max(fallbackCount, 1));
}

function searchableText(videoAnalysis: VideoAnalysis): string {
  return [
    videoAnalysis.metadata.videoId,
    ...videoAnalysis.transcript.map((segment) => segment.text),
    ...videoAnalysis.shots.map((shot) => shot.description ?? ''),
    ...videoAnalysis.keyframes.map((keyframe) => keyframe.description ?? '')
  ].join(' ');
}

function idsForRoles(segments: SegmentNode[], roles: SegmentRole[]): string[] {
  return segments.filter((segment) => roles.includes(segment.role)).map((segment) => segment.id);
}

function idsForSlotRoles(slots: ShotSlotNode[], roles: ShotSlotRole[]): string[] {
  return slots.filter((slot) => roles.includes(slot.role)).map((slot) => slot.id);
}

function transcriptEvidence(videoAnalysis: VideoAnalysis): CreativeIngredientEvidence[] {
  return normalizeTranscript(videoAnalysis.transcript, safeDuration(videoAnalysis.metadata.duration))
    .slice(0, 3)
    .map((segment) => ({
      type: 'transcript',
      value: `${formatSeconds(segment.start)}-${formatSeconds(segment.end)} ${segment.text}`
    }));
}

function frameEvidence(videoAnalysis: VideoAnalysis): CreativeIngredientEvidence[] {
  return videoAnalysis.keyframes.slice(0, 3).map((keyframe) => ({
    type: 'frame',
    value: `${formatSeconds(keyframe.time)} ${keyframe.url}${keyframe.description ? ` ${keyframe.description}` : ''}`
  }));
}

function timestampEvidence(videoAnalysis: VideoAnalysis): CreativeIngredientEvidence[] {
  return videoAnalysis.shots.slice(0, 3).map((shot) => ({
    type: 'timestamp',
    value: `${formatSeconds(shot.start)}-${formatSeconds(shot.end)} ${shot.description ?? shot.id}`
  }));
}

function frameAndTextEvidence(videoAnalysis: VideoAnalysis): CreativeIngredientEvidence[] {
  return transcriptEvidence(videoAnalysis).concat(frameEvidence(videoAnalysis), timestampEvidence(videoAnalysis)).slice(0, 4);
}

function findShotForTime(shots: Shot[], time: number): Shot | undefined {
  return shots.find((shot) => time >= shot.start && time <= shot.end);
}

function findKeyframeForTime(videoAnalysis: VideoAnalysis, time: number): VideoAnalysis['keyframes'][number] | undefined {
  if (!videoAnalysis.keyframes.length) {
    return undefined;
  }

  return videoAnalysis.keyframes.reduce((best, keyframe) =>
    Math.abs(keyframe.time - time) < Math.abs(best.time - time) ? keyframe : best
  );
}

function safeDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? round(duration) : 15;
}

function midpoint(start: number, end: number): number {
  return start + (end - start) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function summarize(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function formatSeconds(value: number): string {
  return `${round(value)}s`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
