import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  QualityReport,
  SlotMatch,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';

export interface EditConstraints {
  aspectRatio: '9:16' | '16:9' | '1:1';
  maxDurationMs?: number;
  allowAigc: boolean;
  allowHumanGeneration: boolean;
  allowedClaimSources: string[];
  forbiddenClaims: string[];
}

export interface VideoEditContext {
  projectId: string;
  structureGraph: ViralStructureGraph;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  /**
   * Slots the user has explicitly confirmed they cannot provide real footage for.
   * Used to route real-proof gaps to an honest degraded substitute when AIGC is also unavailable.
   */
  userUnprovidableSlotIds?: string[];
  gapRepairs?: GapRepair[];
  timeline?: TimelineItem[];
  qualityReport?: QualityReport;
  constraints: EditConstraints;
}
