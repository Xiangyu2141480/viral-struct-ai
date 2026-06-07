'use client';

// components.tsx — Shared UI primitives
// (Ported from components.jsx; React/ReactDOM globals replaced with imports.)

import { Fragment, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ROLES,
  STEPS,
  LIBRARY_VIDEOS,
  HISTORY_RECORDS,
  type Material,
  type Seg,
  type StateKey,
} from './data';

/* ─── Icons (inline SVG, 18px line icons) ──────────────────── */

export const Icon = ({ name, size = 18 }: { name: string; size?: number }) => {
  const paths: Record<string, ReactElement> = {
    bolt:      <path d="M13 2L4.5 13h6L10 22l8.5-11h-6L13 2z" fill="currentColor" />,
    play:      <path d="M5 3v18l16-9L5 3z" fill="currentColor" />,
    film:      <g><rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M3 15h18M7 4v16M17 4v16" stroke="currentColor" strokeWidth="1.5" /></g>,
    layers:    <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5M3 17l9 5 9-5" /></g>,
    grid:      <g fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></g>,
    diagnose:  <g fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /><path d="M11 8v6M8 11h6" /></g>,
    compile:   <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h18v4H3zM3 10h18v4H3zM3 16h18v4H3z" /><circle cx="6" cy="6" r="0.8" fill="currentColor" /><circle cx="6" cy="12" r="0.8" fill="currentColor" /><circle cx="6" cy="18" r="0.8" fill="currentColor" /></g>,
    lab:       <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3v6L4 19a2 2 0 002 2h12a2 2 0 002-2L15 9V3" /><path d="M9 3h6M8 14h8" /></g>,
    home:      <path d="M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V11z" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    library:   <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l4 14-3.8 1L12 7l4-1z" /></g>,
    settings:  <g fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></g>,
    chevron:   <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    plus:      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" />,
    upload:    <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></g>,
    image:     <g fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-10 9" /></g>,
    text:      <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h10M4 18h16" /></g>,
    arrow:     <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.5" fill="none" />,
    check:     <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2" />,
    sparkle:   <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" />,
    waveform:  <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" /></g>,
    alert:     <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 3L1.5 21h21L12 3z" /><path d="M12 10v5" /><circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" /></g>,
    info:      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" /></g>,
    close:     <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">{paths[name] || null}</svg>
  );
};

/* ─── Spine: top compact progress (Sidebar drives main nav now) ──────── */

export const Spine = ({
  activeStep,
  setStep,
  labOpen,
  setLabOpen,
  projectId,
  statusSlot,
}: {
  activeStep: string;
  setStep: (s: string) => void;
  labOpen?: boolean;
  setLabOpen?: (b: boolean) => void;
  projectId?: string;
  statusSlot?: ReactNode;
}) => {
  const activeIdx = STEPS.findIndex(s => s.id === activeStep);
  const totalSteps = STEPS.length;
  const progressPct = labOpen ? 0 : Math.round(((activeIdx + 1) / totalSteps) * 100);
  const currentStep = STEPS[activeIdx];
  return (
    <div className="spine">
      <div className="spine-context">
        {labOpen ? (
          <>
            <span className="spine-context-label">当前</span>
          </>
        ) : (
          <>
            <span className="spine-step-pip done">已完成 {activeIdx}</span>
            <span className="spine-context-label">
              <b>{currentStep.num} · {currentStep.label}</b>
              <span className="mono spine-context-sub" style={{ marginLeft: 8 }}>{currentStep.tag}</span>
            </span>
            <span className="spine-step-pip future">待办 {totalSteps - activeIdx - 1}</span>
          </>
        )}
      </div>

      <div className="spine-track-compact">
        {STEPS.map((s, i) => {
          const done = !labOpen && i < activeIdx;
          const active = !labOpen && i === activeIdx;
          return (
            <Fragment key={s.id}>
              <button
                className={`spine-pip ${done ? 'done' : active ? 'active' : ''}`}
                onClick={() => { setStep(s.id); setLabOpen && setLabOpen(false); }}
                title={`${s.num} · ${s.label} · ${s.tag}`}
              >
                {done ? <Icon name="check" size={10} /> : s.num}
              </button>
              {i < STEPS.length - 1 && (
                <span className={`spine-pip-link ${done ? 'done' : ''}`} />
              )}
            </Fragment>
          );
        })}
      </div>

      <div className="spine-side">
        {statusSlot}
        <div className="spine-progress">
          <div className="spine-progress-bar">
            <div className="spine-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="mono spine-progress-text">{progressPct}%</span>
        </div>
      </div>
    </div>
  );
};

/* ─── Sidebar: main navigation (5 main steps + tools) ────── */

export const Sidebar = ({
  activeStep,
  setStep,
  labOpen,
  setLabOpen,
  toolView,
  setToolView,
}: {
  activeStep: string;
  setStep: (s: string) => void;
  labOpen?: boolean;
  setLabOpen?: (b: boolean) => void;
  toolView?: string | null;
  setToolView?: (v: string | null) => void;
}) => {
  const activeIdx = STEPS.findIndex(s => s.id === activeStep);
  const isToolActive = (name: string) => toolView === name;
  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="side-logo">SM</div>
        <div>
          <div className="side-brand-name">结构迁移引擎</div>
          <div className="side-brand-sub">StructMigrate · v2.3.1</div>
        </div>
      </div>

      <div className="side-section-eyebrow">主流程 · MIGRATION</div>
      <nav className="side-nav">
        {STEPS.map((s, i) => {
          const noTool = !toolView;
          const done = noTool && !labOpen && i < activeIdx;
          const active = noTool && !labOpen && i === activeIdx;
          const future = toolView || labOpen || i > activeIdx;
          return (
            <button
              key={s.id}
              className={`side-step ${done ? 'done' : ''} ${active ? 'active' : ''} ${future ? 'future' : ''}`}
              onClick={() => { setStep(s.id); setLabOpen && setLabOpen(false); setToolView && setToolView(null); }}
            >
              <span className="side-step-num">
                {done ? <Icon name="check" size={12} /> : s.num}
              </span>
              <span className="side-step-body">
                <span className="side-step-label">{s.label}</span>
                <span className="side-step-tag">{s.tag}</span>
              </span>
              {active && <span className="side-step-cursor" />}
            </button>
          );
        })}
      </nav>

      <div className="side-sep" />

      <div className="side-section-eyebrow">工具 · TOOLS</div>
      <button className={`side-tool ${isToolActive('library') ? 'active' : ''}`}
        onClick={() => setToolView && setToolView(isToolActive('library') ? null : 'library')}>
        <Icon name="film" size={14} />
        <span>结构样例库</span>
        <span className="side-tool-tag">{LIBRARY_VIDEOS.length}</span>
      </button>
      <button className={`side-tool ${isToolActive('history') ? 'active' : ''}`}
        onClick={() => setToolView && setToolView(isToolActive('history') ? null : 'history')}>
        <Icon name="layers" size={14} />
        <span>历史版本</span>
        <span className="side-tool-tag">{HISTORY_RECORDS.length}</span>
      </button>

      <div style={{ flex: 1 }} />

      <div className="side-user">
        <div className="side-user-avatar">CD</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="side-user-name">广告创意总监</div>
          <div className="side-user-meta mono">PRJ · JADE-MOM-2026</div>
        </div>
        <button className="side-icon-btn" title="设置"><Icon name="settings" size={14} /></button>
      </div>
    </aside>
  );
};

/* ─── Structure Band (the abstract structure band) ─────────── */

export const StructureBand = ({
  segments,
  total,
  height = 38,
  thin = false,
  showLabels = true,
  onSegHover,
}: {
  segments: Seg[];
  total: number;
  height?: number;
  thin?: boolean;
  showLabels?: boolean;
  onSegHover?: (seg: Seg) => void;
}) => {
  return (
    <div className={`sband${thin ? ' thin' : ''}`} style={{ height }}>
      {segments.map((seg, i) => {
        const dur = (seg.end !== undefined) ? (seg.end - (seg.start ?? 0)) : (seg.dur ?? 0);
        const w = (dur / total) * 100;
        return (
          <div
            key={seg.id || i}
            className={`sband-seg role-${seg.role}`}
            style={{ width: `${w}%` }}
            onMouseEnter={() => onSegHover && onSegHover(seg)}
            title={`${ROLES[seg.role]?.name || seg.role} · ${dur.toFixed(1)}s`}
          >
            {showLabels && w > 5 && (
              <span className="sband-seg-label">{seg.label || ROLES[seg.role]?.name}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ─── Timeline ruler (time axis) ──────────────────────────── */

export const TimeRuler = ({ duration, intervals = 6 }: { duration: number; intervals?: number }) => {
  const ticks: { pct: number; t: number }[] = [];
  for (let i = 0; i <= intervals; i++) {
    const t = (duration * i) / intervals;
    ticks.push({ pct: (i / intervals) * 100, t });
  }
  return (
    <div className="ruler" style={{ height: 16 }}>
      {ticks.map((tk, i) => (
        <div key={i} className="ruler-tick" style={{ left: `${tk.pct}%` }}>
          <span>{tk.t.toFixed(1)}s</span>
        </div>
      ))}
    </div>
  );
};

/* ─── Timeline Track (real video; aligned to StructureBand) ──── */

export const TimelineTrack = ({
  segments,
  total,
  frames = true,
  height = 72,
}: {
  segments: Seg[];
  total: number;
  frames?: boolean;
  height?: number;
}) => {
  return (
    <div className="tline" style={{ height }}>
      {segments.map((seg, i) => {
        const dur = (seg.end !== undefined) ? (seg.end - (seg.start ?? 0)) : (seg.dur ?? 0);
        const w = (dur / total) * 100;
        const role = seg.role;
        return (
          <div
            key={seg.id || i}
            className="tline-frame"
            style={{
              width: `${w}%`,
              '--role-color': `var(--r-${role})`,
            } as CSSProperties}
          >
            <FramePlaceholder role={role} label={seg.shot || seg.label} />
          </div>
        );
      })}
    </div>
  );
};

/* SVG placeholder for a frame thumbnail — abstract, no fake photo */
export const FramePlaceholder = ({ role, label }: { role: string; label?: string }) => {
  const drawByRole: Record<string, ReactElement> = {
    hook:    <SvgHookShape />,
    pain:    <SvgPainShape />,
    emotion: <SvgEmotionShape />,
    product: <SvgProductShape />,
    compare: <SvgCompareShape />,
    social:  <SvgSocialShape />,
    cta:     <SvgCtaShape />,
  };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, background: 'var(--surface-3)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.7 }}>
          {drawByRole[role] || null}
        </div>
      </div>
      <div style={{
        padding: '3px 6px',
        fontSize: 9.5,
        color: 'var(--text-mute)',
        fontFamily: 'var(--ff-mono)',
        background: 'var(--bg-2)',
        borderTop: '1px solid var(--border)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
    </div>
  );
};

/* Abstract SVG glyphs for frame placeholders (per role) */
const stroke = 'rgba(230,236,242,0.4)';
export const SvgHookShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(110,145,180,0.15)" />
    <circle cx="40" cy="25" r="9" fill="none" stroke={stroke} strokeWidth="1.2" />
    <path d="M28 25 Q40 12 52 25" fill="none" stroke="rgba(110,145,180,0.7)" strokeWidth="1.2" />
  </svg>
);
export const SvgPainShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(150,115,175,0.12)" />
    <path d="M10 35 L25 18 L40 32 L55 14 L70 28" fill="none" stroke={stroke} strokeWidth="1.2" />
  </svg>
);
export const SvgEmotionShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(165,130,145,0.12)" />
    <rect x="14" y="14" width="20" height="22" fill="none" stroke={stroke} strokeWidth="1" />
    <rect x="40" y="22" width="26" height="14" fill="none" stroke={stroke} strokeWidth="1" />
  </svg>
);
export const SvgProductShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(100,180,175,0.13)" />
    <ellipse cx="40" cy="26" rx="18" ry="10" fill="none" stroke="rgba(100,180,175,0.7)" strokeWidth="1.4" />
    <ellipse cx="40" cy="26" rx="11" ry="6"  fill="none" stroke={stroke} strokeWidth="1" />
  </svg>
);
export const SvgCompareShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(170,145,90,0.12)" />
    <rect x="12" y="14" width="22" height="22" fill="none" stroke={stroke} strokeWidth="1" />
    <rect x="46" y="14" width="22" height="22" fill="none" stroke="rgba(170,145,90,0.65)" strokeWidth="1.4" />
    <path d="M36 25 L44 25" stroke="rgba(170,145,90,0.65)" strokeWidth="1.4" />
  </svg>
);
export const SvgSocialShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(100,155,115,0.10)" />
    {[10, 24, 38, 52, 66].map((x, i) => (
      <polygon key={i} points={`${x},32 ${x+3},25 ${x+10},25 ${x+5},20 ${x+7},14 ${x},18 ${x-7},14 ${x-5},20 ${x-10},25 ${x-3},25`}
                fill="rgba(100,155,115,0.45)" />
    ))}
  </svg>
);
export const SvgCtaShape = () => (
  <svg viewBox="0 0 80 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
    <rect x="0" y="0" width="80" height="50" fill="rgba(175,115,95,0.12)" />
    <rect x="20" y="20" width="40" height="14" rx="2" fill="rgba(175,115,95,0.7)" />
    <path d="M30 26h20M44 22l6 4-6 4" stroke="#0a0d10" strokeWidth="1.4" fill="none" />
  </svg>
);

/* ─── Material placeholder shape (no real photos) ───────── */

export const MatThumb = ({ mat }: { mat: Material }) => {
  if (mat.kind === 'text') {
    return (
      <div className="mat-thumb" style={{ background: 'var(--surface-3)' }}>
        <span className="mat-thumb-tag">TXT</span>
        <svg viewBox="0 0 24 24" width="32" height="32" style={{ opacity: 0.35 }}>
          <path d="M4 6h16M4 11h16M4 16h12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    );
  }
  return (
    <div className="mat-thumb" style={{
      background: mat.color || 'var(--surface-3)',
      backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.18) 100%)',
    }}>
      <span className="mat-thumb-tag">IMG · {mat.id.toUpperCase()}</span>
      <svg viewBox="0 0 60 50" style={{ width: '70%', height: '70%', opacity: 0.35 }}>
        <circle cx="20" cy="20" r="6" fill="rgba(255,255,255,0.5)" />
        <path d="M5 42L20 26 30 34 45 18 58 42z" fill="rgba(255,255,255,0.5)" />
      </svg>
    </div>
  );
};

/* ─── State badge (four-state pill) ─────────────────────── */

export const StateBadge = ({ state }: { state: StateKey | string }) => {
  const labels: Record<string, string> = {
    filled:   '已满足',
    weakly:   '弱满足',
    missing:  '缺失',
    critical: '关键缺失',
  };
  return (
    <span className={`state ${state}`}>
      <span className="dot" />
      {labels[state]}
    </span>
  );
};

/* ─── Role legend (used in several screens) ─────────────── */

export const RoleLegend = ({ roles }: { roles?: string[] }) => (
  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
    {(roles || Object.keys(ROLES)).map(r => (
      <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`role-dot role-${r}`} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{ROLES[r]?.name || r}</span>
      </div>
    ))}
  </div>
);

/* ─── Strategy token (2 fixed gap-fill strategies) ────────── */
export const STRATEGIES: Record<string, { code: string; label: string; icon: string; cls: string }> = {
  aigc:        { code: 'AIGC',        label: 'AIGC 生成 Prompt', icon: 'sparkle',  cls: 'strat-ai' },
  hyperframes: { code: 'HYPER',       label: 'HyperFrames',      icon: 'layers',   cls: 'strat-reuse' },
};
export const StrategyTag = ({
  kind,
  withIcon = true,
  size = 'md',
}: {
  kind: string | null | undefined;
  withIcon?: boolean;
  size?: string;
}) => {
  const s = kind ? STRATEGIES[kind] : undefined;
  if (!s) return null;
  return (
    <span className={`strat ${s.cls} ${size === 'sm' ? 'sm' : ''}`}>
      {withIcon && <Icon name={s.icon} size={11} />}
      <span>{s.label}</span>
    </span>
  );
};

/* ─── ScreenFooter: unified bottom CTA bar ────────────────── */

export interface FooterAction {
  label: string;
  onClick: () => void;
}

export const ScreenFooter = ({
  primary,                    // { label, onClick, hint? }
  secondary,                  // [{ label, onClick }]
  status,                     // string — left status text
  statusTone = 'neutral',     // 'ok' | 'warn' | 'critical' | 'neutral'
}: {
  primary?: FooterAction & { hint?: string };
  secondary?: FooterAction[];
  status?: string;
  statusTone?: 'ok' | 'warn' | 'critical' | 'neutral';
}) => (
  <div className="screen-footer">
    <div className="screen-footer-status">
      {status && (
        <span className={`screen-footer-pip ${statusTone}`}>
          {statusTone === 'ok'       && <Icon name="check" size={12} />}
          {statusTone === 'warn'     && <Icon name="diagnose" size={12} />}
          {statusTone === 'critical' && <Icon name="diagnose" size={12} />}
          <span>{status}</span>
        </span>
      )}
    </div>
    <div className="screen-footer-actions">
      {(secondary || []).map((b, i) => (
        <button key={i} className="btn ghost" style={{ padding: '8px 14px' }} onClick={b.onClick}>
          {b.label}
        </button>
      ))}
      {primary && (
        <button className="btn-cta" onClick={primary.onClick}>
          <span>{primary.label}</span>
          <Icon name="arrow" size={14} />
        </button>
      )}
    </div>
  </div>
);

/* ─── SatisfactionRing: conic gradient ring for the diagnose overview ── */

export const SatisfactionRing = ({
  pct = 0,
  size = 140,
  label = '整体满足度',
}: {
  pct?: number;
  size?: number;
  label?: string;
}) => {
  const stroke = pct < 30 ? 'var(--st-critical)' : pct < 60 ? 'var(--st-missing)' : pct < 80 ? 'var(--accent-2)' : 'var(--accent)';
  return (
    <div className="sat-ring" style={{ width: size, height: size }}>
      <div
        className="sat-ring-conic"
        style={{
          background: `conic-gradient(${stroke} ${pct}%, var(--surface-2) 0)`,
        }}
      />
      <div className="sat-ring-inner">
        <div className="sat-ring-pct">
          {pct}<small>%</small>
        </div>
        <div className="sat-ring-label">{label}</div>
      </div>
    </div>
  );
};

/* ─── Modal overlay ────────────────────────────────────────── */
export const Modal = ({
  open,
  onClose,
  title,
  width = 480,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children?: ReactNode;
}) => {
  if (!open) return null;
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'grid', placeItems: 'center',
      background: 'rgba(0,0,0,0.55)',
    }} onClick={onClose}>
      <div style={{
        width, maxWidth: '90vw', maxHeight: '80vh',
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h4>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-mute)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
          }}>×</button>
        </div>
        <div style={{ padding: '18px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ─── Toast notification ───────────────────────────────────── */
export const Toast = ({ message, visible }: { message: string; visible: boolean }) => {
  if (!visible) return null;
  return createPortal(
    <div style={{
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000,
      padding: '10px 22px',
      background: 'var(--accent)', color: 'var(--bg)',
      borderRadius: 8, fontSize: 13, fontWeight: 600,
      boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
      animation: 'toast-in 300ms ease',
    }}>
      {message}
    </div>,
    document.body
  );
};

/* ─── DropZone for file upload ─────────────────────────────── */
export const DropZone = ({
  accept = '*',
  onFiles,
  label = '拖拽文件到此处，或点击选择',
  multiple = true,
}: {
  accept?: string;
  onFiles?: (files: File[]) => void;
  label?: string;
  multiple?: boolean;
}) => {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files.length && onFiles) onFiles([...e.dataTransfer.files]);
      }}
      style={{
        border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-2)'}`,
        borderRadius: 8, padding: '36px 20px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, cursor: 'pointer',
        background: dragOver ? 'var(--accent-dim)' : 'var(--bg-2)',
        transition: 'all 150ms',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files && e.target.files.length && onFiles) onFiles([...e.target.files]); e.target.value = ''; }}
      />
      <Icon name="upload" size={28} />
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>
        支持 JPG · PNG · MP4 · TXT
      </div>
    </div>
  );
};
