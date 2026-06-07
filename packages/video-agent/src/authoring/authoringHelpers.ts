import {
  AuthoredSegmentRoleSchema,
  THEME_REGISTRY,
  type AssetCard,
  type AuthoredRenderProfile,
  type AuthoredSegmentRole,
  type MediaSourceKind,
  type ThemeId
} from '@viral-struct/shared';

/** assetId -> AssetCard lookup for resolving authored layers to real files. */
export function buildAssetIndex(cards: AssetCard[]): Map<string, AssetCard> {
  return new Map(cards.map((card) => [card.id, card]));
}

/** AssetCard.type -> renderable media kind; 'text' assets carry no media layer. */
export function mediaKindForAsset(card: AssetCard): MediaSourceKind | null {
  if (card.type === 'image') return 'image';
  if (card.type === 'video') return 'video';
  return null;
}

export function renderProfileFor(aspectRatio: string | undefined): AuthoredRenderProfile {
  if (aspectRatio === '16:9') return { width: 1920, height: 1080, fps: 30, format: 'mp4' };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080, fps: 30, format: 'mp4' };
  return { width: 1080, height: 1920, fps: 30, format: 'mp4' };
}

/** Map the graph's loose style to a closed ThemeId (palette). */
export function paletteFor(style: string | undefined): ThemeId {
  if (style === 'high_conversion' || style === 'premium' || style === 'fast_pace') return style;
  return 'high_click';
}

/** Snap a possibly-unknown role to a valid AuthoredSegmentRole (closed-vocabulary safety). */
export function normalizeAuthoredRole(role: string): AuthoredSegmentRole {
  const parsed = AuthoredSegmentRoleSchema.safeParse(role);
  return parsed.success ? parsed.data : 'selling_point';
}

/** Role background from the theme palette, falling back to a neutral dark when the role isn't in the palette. */
export function backgroundForRole(palette: ThemeId, role: string): string {
  const bg = (THEME_REGISTRY[palette].roleBackground as Record<string, string>)[role];
  return bg ?? '0x14141c';
}
