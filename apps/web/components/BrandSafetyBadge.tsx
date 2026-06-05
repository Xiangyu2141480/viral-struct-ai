import type { SafetyStatus } from '@viral-struct/shared';

const statusPalette: Record<SafetyStatus['status'], { bg: string; color: string; label: string }> = {
  passed: { bg: 'rgba(34, 197, 94, 0.14)', color: '#86efac', label: 'Safety passed' },
  needs_review: { bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', label: 'Needs review' },
  blocked: { bg: 'rgba(239, 68, 68, 0.18)', color: '#fca5a5', label: 'Blocked' }
};

export function BrandSafetyBadge({
  safetyStatus,
  compact = false
}: {
  safetyStatus: SafetyStatus;
  compact?: boolean;
}) {
  const palette = statusPalette[safetyStatus.status];
  const title = [
    `IP risk: ${safetyStatus.ipRisk}`,
    `Brand risk: ${safetyStatus.brandRisk}`,
    `Claim risk: ${safetyStatus.claimRisk}`,
    ...safetyStatus.reasons
  ].join('\n');

  return (
    <span
      title={title}
      style={{
        border: '1px solid rgba(148, 163, 184, 0.28)',
        borderRadius: 999,
        color: palette.color,
        background: palette.bg,
        fontSize: 12,
        padding: compact ? '3px 7px' : '4px 8px',
        whiteSpace: 'nowrap'
      }}
    >
      {palette.label} · IP {safetyStatus.ipRisk} / Brand {safetyStatus.brandRisk} / Claim {safetyStatus.claimRisk}
    </span>
  );
}
