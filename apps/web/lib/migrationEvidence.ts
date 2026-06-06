import type {
  AssetCard,
  AssetMatchEvidence,
  ContentBrief,
  GapRepair,
  MaterialGap,
  SlotMatch,
  StoryboardShot,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';

export interface MigrationEvidenceInput {
  structureGraph: ViralStructureGraph | null;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  timeline: TimelineItem[];
  storyboard: StoryboardShot[];
}

export interface MigrationEvidenceRow {
  id: string;
  order: number;
  source: {
    segmentId: string;
    segmentRole: string;
    segmentPurpose: string;
    slotId: string;
    slotRole: string;
    intent: string;
    sourceInstance: string;
    acceptanceCriteria: string;
  };
  mapping: {
    summary: string;
    sellingPoint: string;
    rationale: string;
  };
  asset: {
    assetId: string;
    assetLabel: string;
    assetType: string;
    score: string;
    status: string;
    reason: string;
  };
  assetEvidence: {
    assetId: string;
    qualityScore: number | null;
    topAffordanceRole: string;
    topAffordanceScore: number | null;
    productVisibilityScore: number | null;
    keyframeIds: string[];
    keyframeCaptions: string[];
    reasons: string[];
    warnings: string[];
  };
  whyMatched: string;
  whyWeakOrMissing: string;
  suggestedRepair: string;
  gap: {
    hasGap: boolean;
    type: string;
    reason: string;
    impact: string;
  };
  repair: {
    strategy: string;
    explanation: string;
    spec: string;
  };
  final: {
    timelineId: string;
    duration: string;
    script: string;
    visual: string;
    packaging: string;
  };
}

export function buildMigrationEvidenceRows(input: MigrationEvidenceInput): MigrationEvidenceRow[] {
  const graph = input.structureGraph;
  if (!graph) return [];

  const segmentById = new Map(graph.segments.map((segment) => [segment.id, segment]));
  const slotById = new Map(graph.shotSlots.map((slot) => [slot.id, slot]));
  const matchBySlotId = new Map(input.slotMatches.map((match) => [match.slotId, match]));
  const gapBySlotId = new Map(input.materialGaps.map((gap) => [gap.slotId, gap]));
  const repairBySlotId = new Map(input.repairs.map((repair) => [repair.slotId, repair]));
  const assetById = new Map(input.assetCards.map((asset) => [asset.id, asset]));
  const storyByTime = input.storyboard;

  const timelineItems: TimelineItem[] = input.timeline.length
    ? input.timeline
    : graph.shotSlots.map((slot, index) => {
        const segment = segmentById.get(slot.segmentId);
        return {
          id: `pending_${slot.id}`,
          start: segment?.start ?? 0,
          end: segment?.end ?? 0,
          segmentRole: segment?.role ?? 'hook',
          sourceSegmentId: slot.segmentId,
          slotId: slot.id,
          script: 'Not available',
          subtitles: [],
          visualAction: 'Not available',
          packaging: { captionStyle: 'not_available' }
        } satisfies TimelineItem;
      });

  return timelineItems.map((item, index) => {
    const slot = slotById.get(item.slotId);
    const segment = segmentById.get(item.sourceSegmentId ?? slot?.segmentId ?? '');
    const match = matchBySlotId.get(item.slotId);
    const gap = gapBySlotId.get(item.slotId);
    const repair = item.repair ?? repairBySlotId.get(item.slotId);
    const asset = item.assetId ? assetById.get(item.assetId) : match?.assetId ? assetById.get(match.assetId) : undefined;
    const story = storyByTime.find((shot) => closeEnough(shot.start, item.start) && closeEnough(shot.end, item.end));
    const assetEvidence = formatAssetEvidence(match?.assetEvidence, asset);

    return {
      id: item.id,
      order: index + 1,
      source: {
        segmentId: segment?.id ?? item.sourceSegmentId ?? 'Not available',
        segmentRole: segment?.role ?? item.segmentRole ?? 'Not available',
        segmentPurpose: segment?.purpose ?? 'Not available',
        slotId: slot?.id ?? item.slotId ?? 'Not available',
        slotRole: slot?.role ?? 'Not available',
        intent: slot?.intent?.purpose ?? segment?.transferRule ?? 'Not available',
        sourceInstance: formatSourceInstance(slot?.sourceInstance),
        acceptanceCriteria: formatAcceptanceCriteria(slot?.acceptanceCriteria)
      },
      mapping: {
        summary: formatMappingSummary(input.contentBrief, segment?.role ?? item.segmentRole, index),
        sellingPoint: pickSellingPoint(input.contentBrief, index),
        rationale: segment?.transferRule ?? slot?.intent?.compositionPrincipal ?? 'Migrate the source pattern into the new product brief.'
      },
      asset: {
        assetId: asset?.id ?? match?.assetId ?? 'Not available',
        assetLabel: formatAssetLabel(asset),
        assetType: asset?.type ?? 'Not available',
        score: typeof match?.score === 'number' ? match.score.toFixed(2) : 'Not available',
        status: match?.status ?? 'Not available',
        reason: match?.reason ?? 'Not available'
      },
      assetEvidence,
      whyMatched: formatWhyMatched(match, assetEvidence),
      whyWeakOrMissing: formatWhyWeakOrMissing(match, gap),
      suggestedRepair: formatSuggestedRepair(repair, gap),
      gap: {
        hasGap: Boolean(gap),
        type: gap?.type ?? 'No material gap',
        reason: gap?.reason ?? 'Asset coverage is enough for this slot.',
        impact: gap?.impact ?? 'No gap impact.'
      },
      repair: {
        strategy: repair?.strategy ?? 'Not needed',
        explanation: repair?.explanation ?? 'No repair required for this slot.',
        spec: formatRepairSpec(repair)
      },
      final: {
        timelineId: item.id,
        duration: `${formatSeconds(item.start)} - ${formatSeconds(item.end)}`,
        script: item.script || 'Not available',
        visual: story?.visual ?? item.visualAction ?? 'Not available',
        packaging: formatPackaging(item)
      }
    };
  });
}

function formatAssetEvidence(
  evidence: AssetMatchEvidence | undefined,
  asset: AssetCard | undefined
): MigrationEvidenceRow['assetEvidence'] {
  if (evidence) {
    return {
      assetId: evidence.assetId,
      qualityScore: evidence.qualityScore,
      topAffordanceRole: evidence.topAffordanceRole ?? 'Not available',
      topAffordanceScore: evidence.topAffordanceScore ?? null,
      productVisibilityScore: evidence.productVisibilityScore ?? null,
      keyframeIds: evidence.keyframeIds,
      keyframeCaptions: evidence.keyframeCaptions ?? [],
      reasons: evidence.reasons,
      warnings: evidence.warnings
    };
  }

  const topAffordance = asset?.analysis?.roleAffordance?.slice().sort((a, b) => b.score - a.score)[0];
  const keyframes = asset?.analysis?.media.keyframes ?? [];
  return {
    assetId: asset?.id ?? 'Not available',
    qualityScore: asset?.analysis?.quality.overallScore ?? asset?.qualityScore ?? null,
    topAffordanceRole: topAffordance?.role ?? 'Not available',
    topAffordanceScore: topAffordance?.score ?? null,
    productVisibilityScore: topAffordance?.components.productVisibilityFit
      ?? (asset?.analysis?.quality.productFocus !== undefined ? Math.round(asset.analysis.quality.productFocus * 100) : null),
    keyframeIds: keyframes.map((keyframe) => keyframe.id),
    keyframeCaptions: keyframes
      .map((keyframe) => keyframe.description)
      .filter((caption): caption is string => Boolean(caption)),
    reasons: topAffordance
      ? [`${topAffordance.role} affordance ${Math.round(topAffordance.score)}: ${topAffordance.rationale}`]
      : [],
    warnings: asset?.analysis?.warnings ?? []
  };
}

function formatWhyMatched(
  match: SlotMatch | undefined,
  assetEvidence: MigrationEvidenceRow['assetEvidence']
): string {
  const evidenceReason = assetEvidence.reasons[0];
  if (evidenceReason) return evidenceReason;
  return match?.reason ?? 'Not available';
}

function formatWhyWeakOrMissing(match: SlotMatch | undefined, gap: MaterialGap | undefined): string {
  if (gap) return `${gap.reason} ${gap.impact}`.trim();
  if (match && match.status !== 'matched') return match.reason;
  return 'No weak or missing coverage for this row.';
}

function formatSuggestedRepair(repair: GapRepair | undefined, gap: MaterialGap | undefined): string {
  if (repair?.explanation) return repair.explanation;
  if (repair?.gapSpec) return formatRepairSpec(repair);
  if (gap) return 'Use the listed fallback strategy or request additional user material.';
  return 'No repair required.';
}

function formatSourceInstance(source: ViralStructureGraph['shotSlots'][number]['sourceInstance']): string {
  if (!source) return 'Not available';
  return [source.productInSource, source.specificAction, source.colorSignature].filter(Boolean).join(' / ') || 'Not available';
}

function formatAcceptanceCriteria(criteria: ViralStructureGraph['shotSlots'][number]['acceptanceCriteria']): string {
  if (!criteria?.anyOf?.length) return 'Not available';
  return criteria.anyOf
    .flatMap((criterion) => [
      criterion.motionType,
      criterion.compositionType,
      ...(criterion.examples ?? [])
    ])
    .filter(Boolean)
    .slice(0, 4)
    .join(' / ');
}

function formatMappingSummary(brief: ContentBrief, role: string | undefined, index: number): string {
  if (role === 'cta') return `${brief.productName} -> ${brief.cta}`;
  if (role === 'selling_point') return `${brief.productName} -> ${pickSellingPoint(brief, index)}`;
  if (role === 'comparison') return `${brief.productName} -> ${brief.targetAudience} 的选择理由`;
  return `${brief.productName} -> ${brief.scenario}`;
}

function pickSellingPoint(brief: ContentBrief, index: number): string {
  if (!brief.sellingPoints.length) return 'Not available';
  return brief.sellingPoints[index % brief.sellingPoints.length];
}

function formatAssetLabel(asset: AssetCard | undefined): string {
  if (!asset) return 'Not available';
  return asset.visualContent?.primarySubject ?? asset.spatialDescription ?? asset.text ?? asset.url ?? asset.id;
}

function formatRepairSpec(repair: GapRepair | undefined): string {
  if (!repair?.gapSpec) return 'Not available';
  return repair.gapSpec.ideal ?? repair.gapSpec.minimalAcceptable ?? repair.gapSpec.alternativeIfNoShoot ?? 'Not available';
}

function formatPackaging(item: TimelineItem): string {
  return [
    item.packaging.cardType,
    item.packaging.transition,
    item.packaging.motion,
    item.packaging.captionStyle
  ]
    .filter(Boolean)
    .join(' / ') || 'Not available';
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}
