import type {
  AssetCard,
  CreativeIngredientType,
  MaterialGap,
  MaterialGapType,
  SlotMatch,
  ViralStructureGraph
} from '@viral-struct/shared';

export function matchSlots(
  graph: ViralStructureGraph,
  assets: AssetCard[]
): { matches: SlotMatch[]; gaps: MaterialGap[] } {
  const matches: SlotMatch[] = graph.shotSlots.map((slot) => {
    const ranked = assets
      .map((asset) => {
        const semanticMatch = asset.suitableSlots.includes(slot.role) ? 0.35 : 0;
        const typeMatch =
          slot.requiredAsset.type === 'generated'
            ? 0.12
            : asset.type === slot.requiredAsset.type
              ? 0.2
              : 0;
        const ingredientMatchScore = getIngredientMatchScore(
          slot.visualIngredientRequirements,
          asset.detectedIngredients
        );
        const motionMatch = getMotionMatch(slot.requiredAsset.motion, asset);
        const quality = asset.qualityScore * 0.1;
        const score = semanticMatch + typeMatch + ingredientMatchScore * 0.2 + motionMatch + quality;
        return {
          asset,
          score,
          ingredientMatchScore,
          missingIngredients: getMissingIngredients(
            slot.visualIngredientRequirements,
            asset.detectedIngredients
          )
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const humanBlocked = best ? violatesHumanRequirement(slot, best.asset) : false;
    const score = best?.score ?? 0;

    if (score >= 0.75 && !humanBlocked && (best.missingIngredients.length === 0 || best.ingredientMatchScore >= 0.75)) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        score,
        ingredientMatchScore: best.ingredientMatchScore,
        missingIngredients: sanitizeMissingIngredients(best.missingIngredients),
        status: 'matched',
        reason: '素材类型、槽位语义、关键创作要素和质量均满足。'
      };
    }

    if (score >= 0.45) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        score,
        ingredientMatchScore: best.ingredientMatchScore,
        missingIngredients: sanitizeMissingIngredients(best.missingIngredients),
        status: 'partial',
        reason: humanBlocked
          ? '槽位需要授权演示或指定动作，但当前素材缺少对应动作要素，最多只能部分满足。'
          : '素材语义部分满足，但类型、动作、时长或创作要素不足，需要补全。'
      };
    }

    return {
      slotId: slot.id,
      score,
      ingredientMatchScore: best?.ingredientMatchScore ?? 0,
      missingIngredients: sanitizeMissingIngredients(best?.missingIngredients ?? slot.visualIngredientRequirements ?? []),
      status: 'missing',
      reason: '没有找到能支撑该结构槽位的素材。'
    };
  });

  const gaps: MaterialGap[] = matches
    .filter((match) => match.status !== 'matched')
    .map((match) => {
      const slot = graph.shotSlots.find((s) => s.id === match.slotId)!;
      const rawMissingIngredients = match.missingIngredients ?? slot.visualIngredientRequirements ?? [];
      const missingIngredients = sanitizeMissingIngredients(rawMissingIngredients);
      return {
        slotId: slot.id,
        role: slot.role,
        type: getGapType(slot.role, rawMissingIngredients),
        severity: match.status === 'missing' ? 'high' : 'medium',
        reason: getGapReason(match.reason, missingIngredients),
        impact: `该缺口会影响 ${slot.segmentId} 段落的画面表达，需要使用 ${slot.fallbackStrategies.join(' / ')} 补足。`,
        affectedSegmentId: slot.segmentId,
        missingIngredients
      };
    });

  return { matches, gaps };
}

function getIngredientMatchScore(
  requiredIngredients: CreativeIngredientType[] | undefined,
  detectedIngredients: CreativeIngredientType[] | undefined
): number {
  if (!requiredIngredients || requiredIngredients.length === 0) return 1;
  if (!detectedIngredients || detectedIngredients.length === 0) return 0;
  const matchedCount = requiredIngredients.filter((ingredient) =>
    detectedIngredients.includes(ingredient)
  ).length;
  return matchedCount / requiredIngredients.length;
}

function getMissingIngredients(
  requiredIngredients: CreativeIngredientType[] | undefined,
  detectedIngredients: CreativeIngredientType[] | undefined
): CreativeIngredientType[] {
  if (!requiredIngredients) return [];
  return requiredIngredients.filter((ingredient) => !detectedIngredients?.includes(ingredient));
}

function getMotionMatch(
  requiredMotion: ViralStructureGraph['shotSlots'][number]['requiredAsset']['motion'],
  asset: AssetCard
): number {
  if (!requiredMotion || requiredMotion === 'unknown') return 0.15;
  if (requiredMotion === 'hand_operation') {
    return asset.humanPresence?.actions?.some((action) =>
      ['applying_product', 'swatching', 'holding_product'].includes(action)
    )
      ? 0.15
      : 0;
  }
  if (asset.type === 'video') return 0.1;
  return 0;
}

function violatesHumanRequirement(
  slot: ViralStructureGraph['shotSlots'][number],
  asset: AssetCard
): boolean {
  if (!slot.humanRequirement?.required) return false;
  if (!asset.humanPresence?.hasHuman) return true;
  if (slot.humanRequirement.framing && !asset.humanPresence.framing?.includes(slot.humanRequirement.framing)) {
    return true;
  }
  const requiredAction = slot.humanRequirement.action;
  if (requiredAction && requiredAction !== 'none' && !asset.humanPresence.actions?.includes(requiredAction)) {
    return true;
  }
  return false;
}

function getGapType(
  role: ViralStructureGraph['shotSlots'][number]['role'],
  missingIngredients: CreativeIngredientType[]
): MaterialGapType {
  if (missingIngredients.includes('human_presence') || missingIngredients.includes('host_talking')) {
    return 'missing_human_host';
  }
  if (missingIngredients.includes('face_closeup')) return 'missing_human_host';
  if (missingIngredients.includes('beauty_demo') || missingIngredients.includes('makeup_application')) {
    return 'missing_usage_action';
  }
  if (missingIngredients.includes('before_after_comparison')) return 'missing_before_after';
  if (missingIngredients.includes('trust_building') || missingIngredients.includes('social_proof')) {
    return 'missing_trust_element';
  }
  if (missingIngredients.includes('scene_style') || missingIngredients.includes('soft_light')) {
    return 'missing_scene_style';
  }
  if (role === 'opening_attention') return 'missing_opening_visual';
  if (role === 'product_closeup') return 'missing_product_closeup';
  if (role === 'usage_demo') return 'missing_usage_demo';
  if (role === 'comparison') return 'missing_comparison';
  if (role === 'cta_visual') return 'missing_cta_visual';
  return 'missing_visual_ingredient';
}

function getGapReason(
  baseReason: string,
  missingIngredients: CreativeIngredientType[]
): string {
  if (missingIngredients.length === 0) return baseReason;
  return `${baseReason} 缺失关键创作要素：${missingIngredients.join(' / ')}。`;
}

function sanitizeMissingIngredients(missingIngredients: CreativeIngredientType[]): CreativeIngredientType[] {
  return missingIngredients
    .map((ingredient) => {
      if (ingredient === 'face_closeup') {
        return 'human_presence';
      }
      if (ingredient === 'beauty_demo' || ingredient === 'makeup_application' || ingredient === 'skin_texture_display') {
        return 'hand_demo';
      }
      return ingredient;
    })
    .filter((ingredient, index, items) => items.indexOf(ingredient) === index);
}
