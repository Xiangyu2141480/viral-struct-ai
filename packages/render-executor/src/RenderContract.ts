// Layer-2 render contract. Renderer-NEUTRAL by design: the decision agent emits a RenderInput and any
// executor (ffmpeg today, HyperFrames/Remotion later) consumes it behind the same RenderExecutor interface.
// The agent never imports this; it produces TimelineItem[] which compileTimelineToRenderInput turns into RenderInput.

export interface RenderProfile {
  width: number;
  height: number;
  fps: number;
  format: 'mp4';
}

export type RenderSegmentSource = 'asset' | 'card' | 'substitute';

export interface RenderSegment {
  id: string;
  slotId: string;
  startMs: number;
  endMs: number;
  source: RenderSegmentSource;
  assetId?: string;
  /** Closed CardTypeId (or unknown string); the renderer snaps it via isKnownCardType before styling. */
  cardType?: string;
  /** Closed CaptionStyleId (or unknown string); the renderer snaps it via isKnownCaptionStyle. */
  captionStyle?: string;
  /** Structural role (hook/cta/...) — used as a styling fallback when cardType is absent. */
  segmentRole?: string;
  captionLines: string[];
  /** Deterministic background colour token ('0xRRGGBB'). */
  background: string;
  transition?: string;
  /** Honest flag: this segment is an attributed substitute for evidence that could not be provided. */
  unresolvedEvidence: boolean;
  label: string;
}

export interface RenderInput {
  profile: RenderProfile;
  segments: RenderSegment[];
  totalDurationMs: number;
}

export interface RenderSegmentManifestEntry {
  id: string;
  slotId: string;
  startMs: number;
  endMs: number;
  frames: number;
  source: RenderSegmentSource;
  unresolvedEvidence: boolean;
  label: string;
}

export interface RenderResult {
  ok: boolean;
  /** false for a plan/manifest-only render: makes the absence of real pixels explicit (Honesty invariant). */
  rendered: boolean;
  executor: string;
  format: string;
  outputPath?: string;
  durationMs: number;
  frameCount: number;
  segmentCount: number;
  /** Honest accounting surfaced upward to QualityReport: segments that are attributed substitutes. */
  unresolvedSegmentIds: string[];
  manifest: RenderSegmentManifestEntry[];
  /** Hash-stable plan id over the RenderInput (determinism). */
  contentHash: string;
  warnings: string[];
}

export interface RenderExecutor {
  readonly name: string;
  render(input: RenderInput): Promise<RenderResult>;
}

export const DEFAULT_PROFILE: RenderProfile = { width: 1080, height: 1920, fps: 30, format: 'mp4' };
