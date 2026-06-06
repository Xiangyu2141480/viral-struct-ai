'use client';

import type {
  AssetSupplyContext,
  ContextualAssetCoverageReport,
  ContextualSlotCoverage,
  MaterialCoverageObservation,
  NormalizedAssetCard,
} from '@viral-struct/shared';

type PanelVariant = 'full' | 'compact';

export interface AssetManagerEvidencePanelProps {
  context: AssetSupplyContext | null;
  loading?: boolean;
  warnings?: string[];
  error?: string | null;
  selectedSlotId?: string | null;
  variant?: PanelVariant;
}

const STATUS_LABEL: Record<ContextualSlotCoverage['coverageStatus'], string> = {
  covered: '已覆盖',
  weak: '弱覆盖',
  insufficient: '供给不足',
};

const STATUS_COLOR: Record<ContextualSlotCoverage['coverageStatus'], string> = {
  covered: 'var(--st-filled)',
  weak: 'var(--st-weakly)',
  insufficient: 'var(--st-missing)',
};

export function AssetManagerEvidencePanel({
  context,
  loading = false,
  warnings = [],
  error,
  selectedSlotId,
  variant = 'full',
}: AssetManagerEvidencePanelProps) {
  const coverage = context?.contextualCoverage;
  const slots = pickSlots(coverage, selectedSlotId, variant);
  const observations = pickObservations(coverage, selectedSlotId, variant);
  const assetById = new Map((context?.assets ?? []).map((asset) => [asset.id, asset]));
  const summary = coverage?.coverageSummary;

  return (
    <div className="panel" style={{ marginBottom: variant === 'compact' ? 12 : 16 }}>
      <div className="panel-head">
        <h4>Asset Manager · 素材供给证据</h4>
        <span className="eyebrow">
          {loading ? '分析中…' : context ? 'deterministic coverage' : '等待后端'}
        </span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          padding: '8px 10px',
          background: 'var(--bg-2)',
          border: '1px dashed var(--border-2)',
          borderRadius: 5,
          fontSize: 10.8,
          lineHeight: 1.5,
          color: 'var(--text-mute)',
        }}>
          素材供给证据只说明“当前素材能否支撑结构槽位”，最终缺口与补全策略仍由诊断/编译链路决定。
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: variant === 'compact' ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: 8,
        }}>
          <Metric label="覆盖分" value={summary ? `${summary.coverageScore}` : '—'} suffix="/100" />
          <Metric label="已覆盖" value={summary ? `${summary.coveredSlots}` : '—'} suffix={summary ? `/ ${summary.totalSlots}` : ''} />
          <Metric label="弱/不足" value={summary ? `${summary.weakSlots + summary.insufficientSlots}` : '—'} />
          <Metric label="平均质量" value={context ? `${Math.round(context.libraryProfile.avgQualityScore * 100)}` : '—'} suffix="/100" />
        </div>

        {(error || warnings.length > 0 || context?.warnings.length) && (
          <div style={{
            padding: '8px 10px',
            background: 'var(--st-weakly-bg)',
            border: '1px solid var(--st-weakly-line)',
            borderRadius: 5,
            fontSize: 10.8,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
          }}>
            <b style={{ color: 'var(--st-weakly)' }}>Warnings</b>
            <span> · </span>
            {[error, ...warnings, ...(context?.warnings ?? [])].filter(Boolean).slice(0, 3).join(' · ')}
          </div>
        )}

        {slots.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slots.map((slot) => (
              <SlotCoverageRow key={slot.slotId} slot={slot} assetById={assetById} />
            ))}
          </div>
        ) : (
          <div className="mono" style={{ color: 'var(--text-mute)', fontSize: 11 }}>
            暂无 Asset Manager coverage。启动 API 后会自动回填。
          </div>
        )}

        {observations.length > 0 && variant === 'full' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {observations.map((observation) => (
              <ObservationCard key={observation.id} observation={observation} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AssetAffordanceChips({ asset }: { asset?: NormalizedAssetCard }) {
  const roles = asset?.analysis.slotAffordance.primaryRoles.slice(0, 3) ?? [];
  if (roles.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
      {roles.map((role) => (
        <span key={role.role} className="tag" style={{ padding: '1px 5px', fontSize: 9.5 }}>
          {role.role.replace(/_/g, ' ')} · {Math.round(role.confidence * 100)}
        </span>
      ))}
    </div>
  );
}

function Metric({ label, value, suffix = '' }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="stat" style={{ background: 'var(--surface)', minHeight: 66 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>
        {value}<small>{suffix}</small>
      </div>
    </div>
  );
}

function SlotCoverageRow({
  slot,
  assetById,
}: {
  slot: ContextualSlotCoverage;
  assetById: Map<string, NormalizedAssetCard>;
}) {
  const best = slot.candidateAssets[0];
  const bestAsset = best ? assetById.get(best.assetId) : undefined;
  return (
    <div style={{
      padding: '9px 10px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${STATUS_COLOR[slot.coverageStatus]}`,
      borderRadius: 5,
      display: 'grid',
      gridTemplateColumns: '110px 1fr 120px',
      gap: 10,
      alignItems: 'start',
    }}>
      <div>
        <div className="mono" style={{ fontSize: 10.5, color: STATUS_COLOR[slot.coverageStatus], fontWeight: 700 }}>
          {slot.slotId.toUpperCase()}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{STATUS_LABEL[slot.coverageStatus]}</div>
        <div className="mono dim" style={{ fontSize: 9.5 }}>{slot.slotRole}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-dim)' }}>{slot.slotIntent}</div>
        <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {slot.missingIngredients.slice(0, 2).map((ingredient) => (
            <span key={ingredient.requiredIngredientId} className="need-chip miss">{ingredient.label}</span>
          ))}
          {slot.weakIngredients.slice(0, 2).map((ingredient) => (
            <span key={ingredient.requiredIngredientId} className="need-chip">{ingredient.label}</span>
          ))}
        </div>
      </div>
      <div>
        <div className="mono" style={{ fontSize: 10.5, color: best ? 'var(--accent)' : 'var(--text-mute)' }}>
          {best ? `${best.assetId.toUpperCase()} · ${best.score}` : '无候选'}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.35, marginTop: 3 }}>
          {bestAsset?.analysis.semantic.summary ?? best?.evidence.semanticSignals[0] ?? 'No asset evidence'}
        </div>
      </div>
    </div>
  );
}

function ObservationCard({ observation }: { observation: MaterialCoverageObservation }) {
  return (
    <div style={{
      padding: '9px 10px',
      background: observation.severityEstimate === 'high' ? 'var(--st-critical-bg)' : 'var(--bg-2)',
      border: `1px solid ${observation.severityEstimate === 'high' ? 'var(--st-critical-line)' : 'var(--border)'}`,
      borderRadius: 5,
      fontSize: 10.8,
      lineHeight: 1.45,
      color: 'var(--text-dim)',
    }}>
      <div className="mono" style={{
        color: observation.severityEstimate === 'high' ? 'var(--st-critical)' : 'var(--accent)',
        fontSize: 10,
        marginBottom: 4,
      }}>
        {observation.affectedSlotId.toUpperCase()} · {observation.observationType}
      </div>
      {observation.potentialImpact[0]?.description ?? 'Asset Manager observation only.'}
    </div>
  );
}

function pickSlots(
  coverage: ContextualAssetCoverageReport | undefined,
  selectedSlotId: string | null | undefined,
  variant: PanelVariant,
): ContextualSlotCoverage[] {
  if (!coverage) return [];
  if (selectedSlotId) {
    const selected = coverage.slotCoverages.find((slot) => slot.slotId === selectedSlotId || slot.affectedSegmentId === selectedSlotId);
    if (selected) return [selected];
  }
  const priority = coverage.slotCoverages.filter((slot) => slot.coverageStatus !== 'covered');
  return (priority.length ? priority : coverage.slotCoverages).slice(0, variant === 'compact' ? 2 : 5);
}

function pickObservations(
  coverage: ContextualAssetCoverageReport | undefined,
  selectedSlotId: string | null | undefined,
  variant: PanelVariant,
): MaterialCoverageObservation[] {
  if (!coverage || variant === 'compact') return [];
  const observations = selectedSlotId
    ? coverage.observations.filter((item) => item.affectedSlotId === selectedSlotId || item.affectedSegmentId === selectedSlotId)
    : coverage.observations;
  return observations.slice(0, 4);
}
