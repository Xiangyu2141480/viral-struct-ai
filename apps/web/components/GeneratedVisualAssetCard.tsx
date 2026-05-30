import type { StoryboardFrame } from '@viral-struct/shared';
import { mediaUrl } from '../lib/api';
import { BrandSafetyBadge } from './BrandSafetyBadge';

export function GeneratedVisualAssetCard({ frame }: { frame: StoryboardFrame }) {
  const visual = frame.generatedVisualAsset;

  return (
    <article className="card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div>
          {visual ? (
            <img
              src={mediaUrl(visual.url)}
              alt={`${frame.title} placeholder storyboard draft`}
              style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.35)' }}
            />
          ) : (
            <div style={{ aspectRatio: '9 / 16', border: '1px dashed rgba(148, 163, 184, 0.6)', borderRadius: 8, display: 'grid', placeItems: 'center' }}>
              Prompt-only draft
            </div>
          )}
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#94a3b8' }}>
            {visual?.label ?? 'Prompt-only storyboard draft'} · Not a real generated image
          </p>
        </div>

        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <strong>{frame.frameIndex + 1}. {frame.title}</strong>
            <BrandSafetyBadge safetyStatus={frame.safetyStatus} compact />
            <span style={pillStyle}>{frame.frameType}</span>
          </div>
          <p style={{ margin: '4px 0' }}>Timeline item: {frame.timelineItemId} · Slot: {frame.slotId ?? 'Not available'}</p>
          <p style={{ margin: '4px 0' }}>结构意图：{frame.structureIntent || 'Not available'}</p>
          <p style={{ margin: '4px 0' }}>源片抽象：{frame.sourceInstance || 'Not available'}</p>
          <p style={{ margin: '4px 0' }}>替代标准：{frame.acceptanceCriteria.length ? frame.acceptanceCriteria.join(' / ') : 'Not available'}</p>
          <p style={{ margin: '4px 0' }}>
            素材/补全：{frame.matchedAsset?.id ?? 'No matched asset'}{frame.repair ? ` · ${frame.repair.strategy}` : ''}
          </p>
          {frame.materialGap ? <p style={{ margin: '4px 0' }}>缺口：{frame.materialGap.type ?? frame.materialGap.role} · {frame.materialGap.reason}</p> : null}
          {frame.safetyStatus.reasons.length ? (
            <p style={{ margin: '8px 0', color: frame.safetyStatus.status === 'passed' ? '#86efac' : '#fbbf24' }}>
              Safety: {frame.safetyStatus.reasons.join(' / ')}
            </p>
          ) : null}
        </div>
      </div>

      <details>
        <summary>Prompt preview</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <PromptBlock label="Positive prompt" value={frame.imagePrompt.positivePrompt} />
          <PromptBlock label="Negative prompt" value={frame.imagePrompt.negativePrompt} />
        </div>
      </details>
    </article>
  );
}

function PromptBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong style={{ display: 'block', marginBottom: 4 }}>{label}</strong>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#cbd5e1' }}>{value}</p>
    </div>
  );
}

const pillStyle = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: 999,
  color: '#cbd5e1',
  fontSize: 12,
  padding: '4px 8px'
};
