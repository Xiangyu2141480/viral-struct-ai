'use client';

// viz.tsx — Heavy visualizations for the 3 P0 concept upgrades
// (Ported from viz.jsx; React/window globals replaced with imports.)

import { Fragment, useState, type CSSProperties } from 'react';
import {
  ROLES,
  TRANSITION_TYPES,
  type Seg,
  type StateKey,
  type Transition,
  type TransitionTypeKey,
} from './data';
import { useProjectStore } from './store/useProjectStore';

/* ============================================================
   ISSUE 2 · Abstract structure band ↔ Concrete film strip
   两条带子视觉分离:抽象=高对比色块+协议感,具体=灰阶+film perforation
   ============================================================ */

export const AbstractStructureBand = ({
  segments,
  total,
  onSegHover,
  onSegClick,
  selectedId,
  scannedIds,
  scanningIds,
  height = 64,
}: {
  segments: Seg[];
  total: number;
  onSegHover?: (seg: Seg) => void;
  onSegClick?: (seg: Seg) => void;
  selectedId?: string;
  scannedIds?: Set<string>;
  scanningIds?: Set<string>;
  height?: number;
}) =>
<div className="sband abstract" style={{ height }}>
    {segments.map((seg, i) => {
    const dur = seg.end !== undefined ? seg.end - (seg.start ?? 0) : (seg.dur ?? 0);
    const w = dur / total * 100;
    const isSel = selectedId !== undefined && seg.id === selectedId;
    const isScanned = seg.id !== undefined && (scannedIds?.has(seg.id) ?? false);
    const isScanning = seg.id !== undefined && (scanningIds?.has(seg.id) ?? false);
    return (
      <div
        key={seg.id || i}
        className={`sband-seg role-${seg.role}${isSel ? ' selected' : ''}`}
        style={{
          width: `${w}%`,
          cursor: onSegClick ? 'pointer' : undefined,
          outline: isSel ? '2px solid var(--accent)' : undefined,
          outlineOffset: isSel ? '-2px' : undefined,
          zIndex: isSel ? 2 : undefined,
          position: 'relative',
        }}
        onMouseEnter={() => onSegHover && onSegHover(seg)}
        onClick={() => onSegClick && onSegClick(seg)}
        title={`${ROLES[seg.role]?.code} · ${ROLES[seg.role]?.name} · ${dur.toFixed(1)}s${isScanned ? ' · 已精扫描' : isScanning ? ' · 精扫描中…' : ''}（点击查看明细）`}>

          {(isScanned || isScanning) &&
        <span
          title={isScanning ? '精扫描中…' : '已精扫描（点击查看明细）'}
          style={{
            position: 'absolute', top: 2, right: 2, zIndex: 3,
            fontSize: 9, lineHeight: 1, fontWeight: 800,
            padding: '1px 3px', borderRadius: 3,
            background: isScanning ? 'var(--accent)' : '#2ecc71', color: '#06231a',
          }}>{isScanning ? '⟳' : '✓'}</span>
        }
          <span className="sband-abs-meta top">
            {String(i + 1).padStart(2, '0')} · {ROLES[seg.role]?.code || seg.role.toUpperCase()}
          </span>
          {w > 5 &&
        <span className="sband-abs-name">{ROLES[seg.role]?.name || seg.label}</span>
        }
          <span className="sband-abs-meta bot">{dur.toFixed(1)}s</span>
        </div>);

  })}
  </div>;


export const ConcreteFilmStrip = ({
  segments,
  total,
  height = 64,
}: {
  segments: Seg[];
  total: number;
  height?: number;
}) =>
<div className="tline concrete" style={{ height }}>
    <div className="film-perf top" />
    <div className="film-perf bot" />
    {segments.map((seg, i) => {
    const dur = seg.end !== undefined ? seg.end - (seg.start ?? 0) : (seg.dur ?? 0);
    const w = dur / total * 100;
    return (
      <div
        key={seg.id || i}
        className="tline-frame concrete-frame"
        style={{ width: `${w}%`, '--role-color': `var(--r-${seg.role})` } as CSSProperties}>

          <div className="concrete-frame-bg" />
          <div className="concrete-frame-label">{seg.shot}</div>
        </div>);

  })}
  </div>;


export const SyncRails = ({
  segments,
  total,
  height = 36,
}: {
  segments: Seg[];
  total: number;
  height?: number;
}) => {
  return (
    <div className="sync-rails" style={{ height }}>
      <svg width="100%" height={height} style={{ display: 'block', overflow: 'visible' }} preserveAspectRatio="none">
        {segments.map((seg, i) => {
          const start = seg.start ?? 0;
          const end = seg.end ?? 0;
          const dur = end - start;
          const x0 = start / total * 100;
          const x1 = end / total * 100;
          const cx = (start + dur / 2) / total * 100;
          return (
            <g key={seg.id || i}>
              <line x1={`${x0}%`} y1="0" x2={`${x0}%`} y2={height}
              stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3 3" />
              <line x1={`${cx}%`} y1="4" x2={`${cx}%`} y2={height - 4}
              stroke={`var(--r-${seg.role})`} strokeWidth="1" opacity="0.5" />
              <circle cx={`${cx}%`} cy={height / 2} r="3"
              fill={`var(--r-${seg.role})`} opacity="0.85" />
            </g>);

        })}
        <line x1="100%" y1="0" x2="100%" y2={height}
        stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    </div>);

};

/* ============================================================
   ISSUE 1 · MigrationFlow — "灌入"可视化
   左:6 个素材 / 中:贝塞尔曲线流向 / 右:7 个源结构槽位(带 fill level)
   ============================================================ */

interface FlowLink {
  mi: number;
  si: number;
  y1: number;
  y2: number;
  role: string;
  quality: number;
  matId: string;
  slotId: string | null;
}

export const MigrationFlow = () => {
  const segs = useProjectStore((s) => s.sourceVideo.segments);
  const mats = useProjectStore((s) => s.materials);
  const diagnosis = useProjectStore((s) => s.diagnosis);
  const stateOf = (id: string): StateKey => diagnosis[id]?.state ?? 'missing';

  const MAT_H = 54,MAT_GAP = 8;
  const SLOT_H = 46,SLOT_GAP = 10;
  const CONTAINER_H = Math.max(
    mats.length * MAT_H + (mats.length - 1) * MAT_GAP,
    segs.length * SLOT_H + (segs.length - 1) * SLOT_GAP
  ) + 20;

  const matTotal = mats.length * MAT_H + (mats.length - 1) * MAT_GAP;
  const slotTotal = segs.length * SLOT_H + (segs.length - 1) * SLOT_GAP;
  const matStart = (CONTAINER_H - matTotal) / 2;
  const slotStart = (CONTAINER_H - slotTotal) / 2;

  const matCy = (i: number) => matStart + i * (MAT_H + MAT_GAP) + MAT_H / 2;
  const slotCy = (i: number) => slotStart + i * (SLOT_H + SLOT_GAP) + SLOT_H / 2;

  // build links
  const links: FlowLink[] = [];
  mats.forEach((m, mi) => {
    if (!m.slot) return;
    const si = segs.findIndex((s) => s.id === m.slot);
    if (si < 0) return;
    links.push({
      mi, si,
      y1: matCy(mi),
      y2: slotCy(si),
      role: segs[si].role,
      quality: m.quality,
      matId: m.id,
      slotId: m.slot
    });
  });

  const fillByState: Record<string, number> = { filled: 100, weakly: 60, missing: 30, critical: 15 };

  return (
    <div className="migrate" style={{ height: CONTAINER_H }}>
      {/* LEFT: materials */}
      <div className="migrate-col mats">
        <div className="migrate-col-head">
          <span className="eyebrow">来源 · 新素材</span>
          <span className="mono dim" style={{ fontSize: 10 }}>{mats.length} 项</span>
        </div>
        {mats.map((m, i) => {
          const y = matCy(i) - MAT_H / 2;
          return (
            <div key={m.id} className="mat-vessel" style={{ top: y, height: MAT_H }}>
              <div className="mat-vessel-thumb" style={{ background: m.color || 'var(--surface-3)' }}>
                {m.kind === 'text' ?
                <span className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>TXT</span> :

                <svg viewBox="0 0 24 24" width="14" height="14">
                    <rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
                    <circle cx="9" cy="10" r="1.5" fill="rgba(255,255,255,0.55)" />
                    <path d="M21 16l-5-5-10 9" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
                  </svg>
                }
              </div>
              <div className="mat-vessel-body">
                <div className="mat-vessel-name">{m.subject}</div>
                <div className="mat-vessel-meta mono">{m.id.toUpperCase()} · q={m.quality.toFixed(1)}</div>
              </div>
            </div>);

        })}
      </div>

      {/* CENTER: SVG flow */}
      <div className="migrate-col flow">
        <div className="migrate-col-head" style={{ justifyContent: 'center' }}>
          <span className="eyebrow" style={{ color: 'var(--accent)' }}>结构迁移</span>
        </div>
        <svg
          width="100%"
          height={CONTAINER_H}
          viewBox={`0 0 100 ${CONTAINER_H}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>

          {/* WIRES — clean bezier patch cables */}
          {links.map((l, i) => {
            const x1 = 0,x2 = 100;
            const cx1 = 32,cx2 = 68;
            const sw = 1.2 + l.quality * 1.2;
            const path = `M ${x1} ${l.y1} C ${cx1} ${l.y1}, ${cx2} ${l.y2}, ${x2} ${l.y2}`;
            return (
              <path
                key={i}
                d={path}
                stroke={`var(--r-${l.role})`}
                strokeWidth={sw}
                fill="none"
                opacity="0.78"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />);


          })}
        </svg>

        {/* Pixel-fixed terminal jacks — outside the stretched SVG so they stay round */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {links.map((l, i) =>
          <Fragment key={`jacks-${i}`}>
              <span className="patch-jack" style={{
              top: l.y1 - 4, left: -4,
              background: `var(--r-${l.role})`,
              borderColor: `var(--r-${l.role})`
            }} />
              <span className="patch-jack" style={{
              top: l.y2 - 4, right: -4,
              background: `var(--r-${l.role})`,
              borderColor: `var(--r-${l.role})`
            }} />
            </Fragment>
          )}
          {segs.map((s, i) => {
            const incoming = links.filter((l) => l.slotId === s.id).length;
            if (incoming > 0) return null;
            const color = stateOf(s.id) === 'critical' ? 'var(--st-critical)' : 'var(--st-missing)';
            return (
              <span key={`open-${s.id}`} className="patch-jack open" style={{
                top: slotCy(i) - 5, right: -5,
                borderColor: color
              }} />);

          })}
        </div>

        {/* HTML overlay for empty-slot gap labels — kept out of the stretched SVG */}
        {segs.map((s, i) => {
          const incoming = links.filter((l) => l.slotId === s.id).length;
          if (incoming > 0) return null;
          const state = stateOf(s.id);
          const color = state === 'critical' ? 'var(--st-critical)' : 'var(--st-missing)';
          return (
            <span key={s.id} className="migrate-gap-label" style={{
              position: 'absolute',
              right: 6,
              top: slotCy(i) - 16,
              fontFamily: 'var(--ff-mono)',
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color,
              background: 'var(--bg-2)',
              border: `1px solid ${color}`,
              padding: '1px 5px',
              borderRadius: 3,
              pointerEvents: 'none'
            }}>
              {state === 'critical' ? 'KEY GAP' : 'MISS'}
            </span>);

        })}
      </div>

      {/* RIGHT: source structure slots as vessels */}
      <div className="migrate-col slots">
        <div className="migrate-col-head">
          <span className="eyebrow">目标 · 源结构槽位</span>
          <span className="mono dim" style={{ fontSize: 10 }}>{segs.length} 槽位</span>
        </div>
        {segs.map((s, i) => {
          const y = slotCy(i) - SLOT_H / 2;
          const state = stateOf(s.id);
          const fillPct = fillByState[state];
          const incoming = links.filter((l) => l.slotId === s.id);
          const stateColor = {
            filled: 'var(--st-filled)',
            weakly: 'var(--st-weakly)',
            missing: 'var(--st-missing)',
            critical: 'var(--st-critical)'
          }[state];
          return (
            <div key={s.id} className={`slot-vessel ${state}`} style={{ top: y, height: SLOT_H }}>
              <div
                className="slot-vessel-fill"
                style={{
                  width: `${fillPct}%`,
                  background: `var(--r-${s.role})`
                }} />

              <div className="slot-vessel-body">
                <div className="slot-vessel-row">
                  <span className={`role-dot role-${s.role}`} />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>{s.id.toUpperCase()}</span>
                  <span className="slot-vessel-name">{s.label}</span>
                </div>
                <div className="slot-vessel-row" style={{ marginTop: 2 }}>
                  <span className="mono" style={{ fontSize: 9.5, color: stateColor }}>
                    {{ filled: 'FILLED', weakly: 'WEAK', missing: 'MISS', critical: 'KEY GAP' }[state]}
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)' }}>
                    {fillPct}% · {(s.end - s.start).toFixed(1)}s
                  </span>
                  {incoming.length > 0 &&
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
                      ← {incoming.map((l) => l.matId.toUpperCase()).join(',')}
                    </span>
                  }
                </div>
              </div>
            </div>);

        })}
      </div>
    </div>);

};

/* ============================================================
   ISSUE 3 · DiagnosticRadar — 7 角色 × 满足度 雷达图
   外环 = 要求满分;内多边形 = 当前实际覆盖;四色顶点
   ============================================================ */

export const DiagnosticRadar = ({
  size = 360,
  selected,
  onSelect,
}: {
  size?: number;
  selected?: string;
  onSelect?: (id: string) => void;
}) => {
  const segs = useProjectStore((s) => s.sourceVideo.segments);
  const diagnosis = useProjectStore((s) => s.diagnosis);
  const stateOf = (id: string): StateKey => diagnosis[id]?.state ?? 'missing';
  const cx = size / 2,cy = size / 2;
  const pad = 52;
  const rMax = size / 2 - pad;
  const n = segs.length;

  const angleFor = (i: number) => -Math.PI / 2 + Math.PI * 2 * i / n;
  const pointAt = (i: number, r: number): [number, number] => [cx + Math.cos(angleFor(i)) * r, cy + Math.sin(angleFor(i)) * r];

  const fillByState: Record<string, number> = { filled: 1.0, weakly: 0.6, missing: 0.3, critical: 0.15 };
  const stateColor: Record<string, string> = {
    filled: 'var(--st-filled)',
    weakly: 'var(--st-weakly)',
    missing: 'var(--st-missing)',
    critical: 'var(--st-critical)'
  };

  const innerPoints = segs.map((s, i) => {
    const r = rMax * fillByState[stateOf(s.id)];
    return pointAt(i, r).join(',');
  }).join(' ');

  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', maxWidth: size }}>

      {/* grid rings */}
      {rings.map((p, ri) =>
      <polygon
        key={ri}
        points={segs.map((s, j) => pointAt(j, rMax * p).join(',')).join(' ')}
        fill="none"
        stroke="var(--border-2)"
        strokeWidth="1"
        opacity={ri === 3 ? 0.7 : 0.35}
        strokeDasharray={ri === 3 ? '0' : '2 3'} />

      )}
      {/* ring labels */}
      {rings.map((p, ri) => {
        const [x, y] = pointAt(0, rMax * p);
        return (
          <text
            key={ri}
            x={x + 4}
            y={y + 2}
            fontSize="8.5"
            fill="var(--text-faint)"
            fontFamily="var(--ff-mono)">

            {Math.round(p * 100)}
          </text>);

      })}
      {/* axes */}
      {segs.map((s, i) => {
        const [x, y] = pointAt(i, rMax);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y}
          stroke="var(--border-2)" strokeWidth="1" opacity="0.5" />);

      })}
      {/* required outer ring (highlighted as ceiling) */}
      <polygon
        points={segs.map((s, j) => pointAt(j, rMax).join(',')).join(' ')}
        fill="none"
        stroke="var(--text-mute)"
        strokeWidth="1.4"
        opacity="0.5" />

      {/* gap fill — between outer and actual (shaded danger zone) */}
      {segs.map((s, i) => {
        const next = (i + 1) % n;
        const r1 = rMax * fillByState[stateOf(s.id)];
        const r2 = rMax * fillByState[stateOf(segs[next].id)];
        const [x1i, y1i] = pointAt(i, r1);
        const [x2i, y2i] = pointAt(next, r2);
        const [x1o, y1o] = pointAt(i, rMax);
        const [x2o, y2o] = pointAt(next, rMax);
        const state = stateOf(s.id);
        if (state === 'filled') return null;
        const opacity = state === 'critical' ? 0.16 : state === 'missing' ? 0.10 : 0.06;
        const color = state === 'critical' ? 'var(--st-critical)' : state === 'missing' ? 'var(--st-missing)' : 'var(--st-weakly)';
        return (
          <polygon
            key={`gap-${s.id}`}
            points={`${x1i},${y1i} ${x1o},${y1o} ${x2o},${y2o} ${x2i},${y2i}`}
            fill={color}
            opacity={opacity} />);


      })}
      {/* actual polygon */}
      <polygon
        points={innerPoints}
        fill="var(--accent)"
        fillOpacity="0.18"
        stroke="var(--accent)"
        strokeWidth="2" />

      {/* vertices */}
      {segs.map((s, i) => {
        const state = stateOf(s.id);
        const r = rMax * fillByState[state];
        const [x, y] = pointAt(i, r);
        const sel = selected === s.id;
        return (
          <g key={s.id} style={{ cursor: 'pointer' }} onClick={() => onSelect && onSelect(s.id)}>
            {sel && <circle cx={x} cy={y} r="10" fill={stateColor[state]} opacity="0.15" />}
            <circle cx={x} cy={y} r={sel ? 6.5 : 5} fill={stateColor[state]} />
            <circle cx={x} cy={y} r={sel ? 6.5 : 5} fill="none" stroke="var(--bg)" strokeWidth="1.5" />
          </g>);

      })}
      {/* labels */}
      {segs.map((s, i) => {
        const [lx, ly] = pointAt(i, rMax + 28);
        const role = ROLES[s.role];
        const angle = angleFor(i);
        const anchor =
        Math.abs(Math.cos(angle)) < 0.3 ? 'middle' :
        Math.cos(angle) > 0 ? 'start' : 'end';
        const sel = selected === s.id;
        return (
          <g key={s.id} textAnchor={anchor} style={{ cursor: 'pointer' }} onClick={() => onSelect && onSelect(s.id)}>
            <text x={lx} y={ly - 3} fontSize="12.5" fontWeight={sel ? 700 : 600}
            fill={sel ? 'var(--accent)' : 'var(--text)'} fontFamily="var(--ff-sans)">
              {role.name}
            </text>
            <text x={lx} y={ly + 10} fontSize="9.5"
            fill="var(--text-mute)" fontFamily="var(--ff-mono)">
              {s.id.toUpperCase()} · {Math.round(fillByState[stateOf(s.id)] * 100)}%
            </text>
          </g>);

      })}
    </svg>);

};

/* ============================================================
   TRANSITION SEAMS · Slot 之间的转场层
   不是独立 Slot —— 坐在共享时间轴的接缝上，按真实时长 straddle 边界。
   硬切=细虚线节点（无过渡素材）；叠化/推镜/卡点=实节点 + 时长带。
   复用四态色把"转场撑不撑得起"接回诊断。
   ============================================================ */

export const TransitionGlyph = ({
  type,
  color = 'var(--text-2)',
  size = 16,
}: {
  type: TransitionTypeKey | string;
  color?: string;
  size?: number;
}) => {
  switch (type) {
    case '硬切':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16">
          <line x1="8" y1="2.5" x2="8" y2="13.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>);
    case '叠化':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16">
          <circle cx="6" cy="8" r="3.6" fill="none" stroke={color} strokeWidth="1.3" />
          <circle cx="10" cy="8" r="3.6" fill="none" stroke={color} strokeWidth="1.3" />
        </svg>);
    case '推镜':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke={color} strokeWidth="1.2" />
          <path d="M6 5.5l4 2.5-4 2.5z" fill={color} />
        </svg>);
    case '卡点':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16">
          <path d="M8 2l3.2 6L8 14 4.8 8z" fill={color} />
        </svg>);
    default:
      return null;
  }
};

export const TransitionSeams = ({
  transitions,
  total,
  height = 46,
  showHardCuts = true,
  selected,
  onSelect,
}: {
  segments?: Seg[];
  transitions: Transition[];
  total: number;
  height?: number;
  showHardCuts?: boolean;
  selected?: string;
  onSelect?: (id: string) => void;
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const stateColor: Record<string, string> = {
    filled: 'var(--st-filled)',
    weakly: 'var(--st-weakly)',
  };
  if (!transitions || !transitions.length) return null;

  return (
    <div className="tseam-track" style={{ height }}>
      <div className="tseam-baseline" />

      {/* duration bands (straddle the boundary) — only when a rich transition is APPLIED */}
      {transitions.map((tr, i) => {
        if (tr.applied === '硬切' || tr.dur <= 0) return null;
        const left = ((tr.at - tr.dur / 2) / total) * 100;
        const w = (tr.dur / total) * 100;
        const c = stateColor[tr.state] || 'var(--accent)';
        return (
          <div
            key={`band-${i}`}
            className="tseam-band"
            style={{
              left: `${left}%`, width: `${w}%`,
              opacity: hover === i ? 1 : 0.7,
              background: `color-mix(in oklab, ${c} 14%, transparent)`,
              borderColor: `color-mix(in oklab, ${c} 40%, transparent)`,
            }}
          />);
      })}

      {/* seam nodes + labels */}
      {transitions.map((tr, i) => {
        const isCut = tr.applied === '硬切';
        if (isCut && !showHardCuts) return null;
        const xPct = (tr.at / total) * 100;
        const color = stateColor[tr.state] || 'var(--text-2)';
        const degraded = tr.applied !== tr.type;
        const isSel = selected === tr.id;
        return (
          <div
            key={`seam-${i}`}
            className={`tseam ${isCut ? 'is-cut' : ''} ${isSel ? 'sel' : ''}`}
            style={{ left: `${xPct}%`, cursor: onSelect ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect && onSelect(tr.id)}
          >
            {hover === i &&
            <div className="tseam-tip">
                <div className="tseam-tip-head">
                  <span className="mono">{tr.id.toUpperCase()}</span>
                  <span>{tr.from.toUpperCase()} → {tr.to.toUpperCase()}</span>
                  <span className="mono dim">{tr.state === 'filled' ? '已满足' : '弱满足'}</span>
                </div>
                <div className="tseam-tip-body">
                  {degraded ?
                <span>原 <b style={{ color: 'var(--text-2)' }}>{tr.type}</b> → 现 <b style={{ color }}>{tr.applied}</b>　{tr.note}</span> :
                <span><b style={{ color: 'var(--text-2)' }}>{tr.applied}</b>　{tr.note}</span>}
                </div>
                {tr.state === 'weakly' &&
              <div className="tseam-tip-risk" style={{ color: tr.upgradable ? 'var(--st-weakly)' : 'var(--text-mute)' }}>
                    {tr.upgradable ?
                `⤓ 可升级：${tr.fix?.kind || '补素材'} → 已满足` :
                '硬切兜底 · 已是原结构天花板，无需升级'}
                  </div>
              }
              </div>
            }
            <div
              className="tseam-node"
              style={{ borderColor: color, boxShadow: isSel ? `0 0 0 3px color-mix(in oklab, ${color} 22%, transparent)` : 'none' }}>

              <TransitionGlyph type={tr.applied} color={color} size={14} />
            </div>
            <div className="tseam-label">
              <b>{tr.applied}</b>
              {tr.dur > 0 && <span className="mono">{tr.dur}s</span>}
              {degraded && <span className="mono" style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{tr.type}</span>}
            </div>
          </div>);
      })}
    </div>);
};
