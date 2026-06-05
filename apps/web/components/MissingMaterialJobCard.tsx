'use client';

import { useState } from 'react';
import type { MissingMaterialGenerationJob } from '@viral-struct/shared';
import { BrandSafetyBadge } from './BrandSafetyBadge';

export function MissingMaterialJobCard({ job }: { job: MissingMaterialGenerationJob }) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    const text = [
      `Provider: ${job.providerLabel}`,
      `Mode: ${job.mode}`,
      `Duration: ${job.durationSec}s`,
      `Aspect ratio: ${job.aspectRatio}`,
      `Shot spec: ${job.shotSpec}`,
      `Positive prompt: ${job.positivePrompt}`,
      `Negative prompt: ${job.negativePrompt}`
    ].join('\n');

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <article className="card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{job.gapType ?? job.gapId} · {job.repairStrategy ?? 'repair planned'}</strong>
          <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>
            External generation plan, not current core output.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge label={job.status} tone={job.status === 'blocked' ? 'danger' : 'ok'} />
          <Badge label={job.mode} tone="info" />
          <Badge label={job.providerLabel} tone="neutral" />
          <BrandSafetyBadge safetyStatus={job.safetyStatus} compact />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <Info label="Gap" value={`${job.gapId} · ${job.gapSeverity}`} />
        <Info label="Timeline" value={job.timelineItemId ?? 'Not available'} />
        <Info label="Storyboard" value={job.storyboardFrameId ?? 'No image reference'} />
        <Info label="Duration" value={`${job.durationSec}s · ${job.aspectRatio}`} />
      </div>

      <div>
        <strong>Shot spec</strong>
        <p style={{ margin: '4px 0', color: '#cbd5e1' }}>{job.shotSpec}</p>
      </div>

      <details>
        <summary>Prompt</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <Prompt label="Positive" value={job.positivePrompt} />
          <Prompt label="Negative" value={job.negativePrompt} />
        </div>
      </details>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <p style={{ margin: 0, color: job.status === 'blocked' ? '#fca5a5' : '#86efac' }}>
          Safety: {job.safetyStatus.status} · {job.blockedReason ?? job.safetyStatus.reasons.join(' / ')}
        </p>
        <button type="button" onClick={() => void copyPrompt()} disabled={job.status === 'blocked'}>
          {copied ? 'Copied' : 'Copy Prompt'}
        </button>
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong style={{ display: 'block', color: '#bfdbfe' }}>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function Prompt({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong style={{ display: 'block', marginBottom: 4 }}>{label}</strong>
      <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.5 }}>{value}</p>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'ok' | 'danger' | 'info' | 'neutral' }) {
  const colors = {
    ok: { color: '#86efac', bg: 'rgba(34,197,94,0.12)' },
    danger: { color: '#fca5a5', bg: 'rgba(239,68,68,0.14)' },
    info: { color: '#93c5fd', bg: 'rgba(59,130,246,0.14)' },
    neutral: { color: '#cbd5e1', bg: 'rgba(148,163,184,0.12)' }
  }[tone];
  return (
    <span style={{ borderRadius: 999, padding: '4px 8px', fontSize: 12, color: colors.color, background: colors.bg }}>
      {label}
    </span>
  );
}
