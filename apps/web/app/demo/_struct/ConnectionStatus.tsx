'use client';

// ConnectionStatus.tsx — surfaces the store's live/mock mode and warnings/errors.
//
// During backend integration the store silently falls back to local fixtures when
// an `/api/struct/*` call fails (see useProjectStore). That makes the demo robust
// but hides whether you are actually talking to the backend. These two components
// make that state visible:
//   • <ConnectionBadge/>  — a fixed corner pill: live (green) vs mock (amber).
//   • <StatusBanner/>     — an in-flow strip showing the last error / warnings,
//                            with a dismiss button.

import { useProjectStore } from './store/useProjectStore';
import { Icon } from './components';

/* ─── Inline pill: is the frontend talking to the backend? ────
   Rendered inside the Spine top bar (see App.tsx) so it never overlaps screen
   content. Inline-flex, no fixed positioning. */
export const ConnectionBadge = () => {
  const mode = useProjectStore((s) => s.mode);
  const live = mode === 'live';
  const color = live ? 'var(--st-filled)' : 'var(--st-weakly)';
  const bg = live ? 'var(--st-filled-bg)' : 'var(--st-weakly-bg)';
  const line = live ? 'var(--st-filled-line)' : 'var(--st-weakly-line)';
  return (
    <span
      title={live ? '实时数据：已连接后端 /api/struct/*' : '本地示例数据：后端未连接，使用 mock fixtures'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 9px', borderRadius: 999,
        background: bg, border: `1px solid ${line}`,
        font: '600 10.5px/1 var(--ff-mono, monospace)', color,
        letterSpacing: '0.02em', whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        boxShadow: live ? `0 0 6px ${color}` : 'none',
      }} />
      {live ? 'LIVE 实时数据' : 'MOCK 本地示例'}
    </span>
  );
};

/* ─── In-flow strip: last error (red) or warnings (amber) ───── */
export const StatusBanner = () => {
  const warnings = useProjectStore((s) => s.warnings);
  const lastError = useProjectStore((s) => s.lastError);
  const dismiss = useProjectStore((s) => s.dismissWarnings);

  if (!lastError && warnings.length === 0) return null;

  const isError = Boolean(lastError);
  const color = isError ? 'var(--st-critical)' : 'var(--st-weakly)';
  const bg = isError ? 'var(--st-critical-bg)' : 'var(--st-weakly-bg)';
  const line = isError ? 'var(--st-critical-line)' : 'var(--st-weakly-line)';
  const headline = isError
    ? '接口调用失败，已回退本地示例数据'
    : (warnings[0] ?? '');

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        margin: '8px 24px 0', padding: '8px 12px',
        background: bg, border: `1px solid ${line}`, borderRadius: 8,
        color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.5,
      }}
    >
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>
        <Icon name={isError ? 'alert' : 'info'} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color, fontWeight: 600 }}>{headline}</div>
        {isError && (
          <div style={{ color: 'var(--text-dim)', marginTop: 2, wordBreak: 'break-word' }}>
            {lastError}
          </div>
        )}
        {!isError && warnings.length > 1 && (
          <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>
            {warnings.slice(1).join(' · ')}
          </div>
        )}
      </div>
      <button
        onClick={dismiss}
        title="关闭"
        style={{
          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', padding: 2, lineHeight: 0,
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
};
