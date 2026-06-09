'use client';

// ConnectionStatus.tsx — surfaces the store's data-source mode and FAIL-FAST errors.
//
// The store no longer hides backend failures behind a silent mock fallback: when an
// `/api/struct/*` call fails it records a rich `lastError` and re-throws. These two
// components make that loud and unmissable:
//   • <ConnectionBadge/>  — a pill in the Spine top bar: live (green) / mock (amber)
//                            / ERROR (red) when the last call failed.
//   • <StatusBanner/>     — a prominent in-flow strip: red error (what failed, where,
//                            HTTP status) or amber backend warnings, with a dismiss.

import { useProjectStore } from './store/useProjectStore';
import { Icon } from './components';

/* ─── Inline pill: live / mock / error ───────────────────────
   Rendered inside the Spine top bar (see App.tsx) so it never overlaps screen
   content. Error takes priority over the data-source mode. */
export const ConnectionBadge = () => {
  const mode = useProjectStore((s) => s.mode);
  const hasError = useProjectStore((s) => Boolean(s.lastError));
  const state: 'error' | 'live' | 'mock' = hasError ? 'error' : mode;

  const cfg = {
    error: {
      color: 'var(--st-critical)', bg: 'var(--st-critical-bg)', line: 'var(--st-critical-line)',
      label: 'ERROR 后端失败', title: '最近一次后端调用失败（fail-fast）· 详见下方红色错误条',
    },
    live: {
      color: 'var(--st-filled)', bg: 'var(--st-filled-bg)', line: 'var(--st-filled-line)',
      label: 'LIVE 实时数据', title: '实时数据：已连接后端 /api/struct/*',
    },
    mock: {
      color: 'var(--st-weakly)', bg: 'var(--st-weakly-bg)', line: 'var(--st-weakly-line)',
      label: 'MOCK 本地示例', title: '本地示例数据：尚未成功调用后端 /api/struct/*',
    },
  }[state];

  return (
    <span
      title={cfg.title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 9px', borderRadius: 999,
        background: cfg.bg, border: `1px solid ${cfg.line}`,
        font: '600 10.5px/1 var(--ff-mono, monospace)', color: cfg.color,
        letterSpacing: '0.02em', whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: cfg.color,
        boxShadow: state === 'mock' ? 'none' : `0 0 6px ${cfg.color}`,
      }} />
      {cfg.label}
    </span>
  );
};

/* ─── In-flow strip: last error (prominent red) or warnings (amber) ───── */
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
    ? '后端调用失败 · 已停止（fail-fast，未使用降级示例数据）'
    : (warnings[0] ?? '');

  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        margin: '8px 24px 0',
        padding: isError ? '11px 14px' : '8px 12px',
        background: bg,
        border: `1px solid ${line}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.5,
        boxShadow: isError ? '0 2px 14px -6px var(--st-critical-line)' : 'none',
      }}
    >
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>
        <Icon name={isError ? 'alert' : 'info'} size={isError ? 16 : 14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color, fontWeight: 700, fontSize: isError ? 13 : 12.5 }}>{headline}</div>
        {isError && (
          <div
            className="mono"
            style={{ color: 'var(--text-2)', marginTop: 3, wordBreak: 'break-word', fontSize: 11.5 }}
          >
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
