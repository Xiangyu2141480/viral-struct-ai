'use client';

import type { GapSpecSource, ScriptSource, SlotAlignmentSource } from '@viral-struct/shared';

type PipelineKind = 'alignment' | 'gap' | 'script';
type PipelineSource = SlotAlignmentSource | GapSpecSource | ScriptSource | undefined;

const labels: Record<PipelineKind, Record<string, { text: string; tone: 'llm' | 'fallback' }>> = {
  alignment: {
    llm_judge: { text: 'LLM Judge', tone: 'llm' },
    rule_based: { text: 'Rule-based fallback', tone: 'fallback' }
  },
  gap: {
    llm_generated: { text: 'LLM Gap Spec', tone: 'llm' },
    rule_based: { text: 'Rule-based repair', tone: 'fallback' }
  },
  script: {
    llm_generated: { text: 'LLM Script Generation', tone: 'llm' },
    template: { text: 'Template fallback', tone: 'fallback' }
  }
};

export function PipelineSourceBadge({
  kind,
  source,
  label
}: {
  kind: PipelineKind;
  source: PipelineSource;
  label: string;
}) {
  const mapped = source ? labels[kind][source] : undefined;
  const tone = mapped?.tone ?? 'fallback';
  const color = tone === 'llm' ? '#86efac' : '#fde68a';
  const background = tone === 'llm' ? 'rgba(22,163,74,0.16)' : 'rgba(234,179,8,0.14)';
  const border = tone === 'llm' ? 'rgba(134,239,172,0.32)' : 'rgba(253,230,138,0.32)';

  return (
    <span
      title={source ? `${label}: ${source}` : `${label}: not available yet`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: `1px solid ${border}`,
        borderRadius: 999,
        padding: '5px 10px',
        color,
        background,
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{label}</span>
      {mapped?.text ?? 'Not run'}
    </span>
  );
}

export function PipelineWarningCallout({ warnings }: { warnings?: string[] }) {
  const visibleWarnings = (warnings ?? []).filter(Boolean);
  if (!visibleWarnings.length) {
    return null;
  }

  return (
    <div
      style={{
        border: '1px solid rgba(253,186,116,0.34)',
        borderRadius: 8,
        padding: 12,
        background: 'rgba(251,146,60,0.12)',
        color: '#fed7aa'
      }}
    >
      <strong>Warning</strong>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {visibleWarnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

export function GenerationTracePanel({
  alignmentSource,
  gapSpecSource,
  scriptSource,
  warnings,
  qualityContext
}: {
  alignmentSource?: SlotAlignmentSource;
  gapSpecSource?: GapSpecSource;
  scriptSource?: ScriptSource;
  warnings?: string[];
  qualityContext?: string;
}) {
  return (
    <section
      className="card"
      style={{
        marginBottom: 16,
        display: 'grid',
        gap: 12,
        background: 'rgba(15,23,42,0.42)'
      }}
    >
      <div>
        <h2 style={{ marginBottom: 8 }}>Generation Trace</h2>
        <p style={{ margin: 0 }}>
          标准流程当前使用的匹配、补全和生成来源。fallback 会被明确标出，保证无 key 时也能演示。
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <PipelineSourceBadge label="Slot matching" kind="alignment" source={alignmentSource} />
        <PipelineSourceBadge label="Gap repair" kind="gap" source={gapSpecSource} />
        <PipelineSourceBadge label="Timeline" kind="script" source={scriptSource} />
      </div>
      {qualityContext ? <p style={{ margin: 0, color: '#cbd5e1' }}>Quality context: {qualityContext}</p> : null}
      <PipelineWarningCallout warnings={warnings} />
    </section>
  );
}
