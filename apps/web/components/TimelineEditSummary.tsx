'use client';

import type { TimelineEditSummaryState } from '../lib/workflowStore';

const editTypeLabels: Record<string, string> = {
  hook_stronger: '开头更抓人',
  product_info_earlier: '商品信息提前',
  reduce_subtitles: '减少字幕',
  increase_rhythm: '增强节奏感',
  stronger_cta: 'CTA 更强',
  combined: '组合修改',
  unsupported: '未识别指令'
};

export function TimelineEditSummary({ summary }: { summary: TimelineEditSummaryState | null }) {
  if (!summary) return null;

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Edit Summary</h2>
      <p>
        <strong>{editTypeLabels[summary.editType] ?? summary.editType}</strong> · {summary.patchSummary}
      </p>
      <p>{summary.rationale}</p>
      {summary.warnings.length ? (
        <div style={{ border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <strong>Warnings</strong>
          {summary.warnings.map((warning) => (
            <p key={warning} style={{ margin: '4px 0' }}>
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      {summary.changedItems.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <strong>Changed items</strong>
          {summary.changedItems.map((item) => (
            <article
              key={item.itemId}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: 10,
                background: 'rgba(15,23,42,0.36)'
              }}
            >
              <strong>{item.itemId}</strong>
              <p style={{ margin: '6px 0' }}>Changes: {item.changes.join(' / ') || 'Not available'}</p>
              <p style={{ margin: '6px 0' }}>Before: {formatItem(item.before)}</p>
              <p style={{ margin: '6px 0' }}>After: {formatItem(item.after)}</p>
            </article>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <strong>Supported edits</strong>
          {summary.supportedEditSuggestions.map((suggestion) => (
            <span key={suggestion}>{suggestion}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function formatItem(item: TimelineEditSummaryState['changedItems'][number]['before']): string {
  return `${formatSeconds(item.start)}-${formatSeconds(item.end)} · ${item.script} · ${item.packaging.transition ?? 'no transition'} · ${item.packaging.cardType ?? 'no card'}`;
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}
