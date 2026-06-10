'use client';

// screen-lab.tsx — 屏 6 · 结构实验室 ★★ THE KEY SCREEN
// (Ported from ui-prototype/screen-lab.jsx; React/window globals replaced with imports.)
// 3 design directions (A/B/C) switchable via top tab.
// 同输入素材 → 套用 2-3 个源结构 → 并排生成肉眼可辨差异的成片

import { useState, type CSSProperties, type ReactElement } from 'react';
import { ROLES, TARGET_MATERIALS, LAB_STRUCTURES, LAB_DIFF_ROWS, type LabStructure } from './data';
import { Icon, SvgEmotionShape, SvgCompareShape, SvgProductShape } from './components';

/* ─── small lab atoms ─────────────────────────────────────── */

// Re-sequenced "applied" output band — same materials, different ordering
const ResequencedBand = ({ structure, height = 38 }: { structure: LabStructure; height?: number }) => {
  const T = structure.durations.reduce((a, b) => a + b, 0);
  return (
    <div className="sband" style={{ height }}>
      {structure.sequence.map((role, i) => {
        const dur = structure.durations[i] ?? 0;
        const w = T > 0 ? (dur / T) * 100 : 0;
        return (
          <div
            key={i}
            className={`sband-seg role-${role}`}
            style={{ width: `${w}%` }}
            title={`${ROLES[role]?.name} · ${dur.toFixed(1)}s`}
          >
            {w > 5 && (
              <span className="sband-seg-label">{ROLES[role]?.name}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

interface LabPreviewVariant {
  bg: string;
  title: string;
  sub: string;
  titleStyle: CSSProperties;
  subStyle: CSSProperties;
  hint: string;
  time: string;
}

// Mini preview: a 9:16 frame whose visual style differs by structure family
const LabPreview = ({ structure }: { structure: LabStructure }) => {
  const variants: Record<string, LabPreviewVariant> = {
    A: {
      bg: 'linear-gradient(180deg, #2a1f24 0%, #14101a 100%)',
      title: '她戴了二十年 · 也该有只新的',
      sub: '母亲节 · 限时礼盒',
      titleStyle: { color: '#fff', fontWeight: 500, fontStyle: 'italic' },
      subStyle: { color: 'oklch(0.70 0.08 350)' },
      hint: '情感锚 + 缓慢推镜',
      time: '00:11 / 00:28',
    },
    B: {
      bg: 'linear-gradient(180deg, oklch(0.55 0.08 75) 0%, oklch(0.38 0.06 75) 100%)',
      title: '工厂直发！同款 2999 · 现在 599',
      sub: '🔥 限时 12 小时',
      titleStyle: { color: '#1a1206', fontWeight: 800, fontSize: 14 },
      subStyle: { color: 'rgba(26,18,6,0.8)', fontWeight: 700 },
      hint: '黄底大字 + 急切配音',
      time: '00:04 / 00:21',
    },
    C: {
      bg: 'linear-gradient(180deg, #1c2331 0%, #0a0f17 100%)',
      title: '实测开箱 · 这只手镯到底值不值',
      sub: '证书+评分+对比 · 完整拆解',
      titleStyle: { color: '#e6ecf2', fontWeight: 500 },
      subStyle: { color: 'oklch(0.68 0.08 248)' },
      hint: '环境光 + 鉴定卡叠加',
      time: '00:14 / 00:24',
    },
  };
  const v = variants[structure.id];
  if (!v) return null;
  return (
    <div className="lab-preview">
      <div style={{ position: 'absolute', inset: 0, background: v.bg }} />
      <div style={{
        position: 'absolute', inset: 0,
        opacity: structure.id === 'B' ? 0.4 : 0.5,
      }}>
        {structure.id === 'A' && <SvgEmotionShape />}
        {structure.id === 'B' && <SvgCompareShape />}
        {structure.id === 'C' && <SvgProductShape />}
      </div>
      <div style={{
        position: 'absolute',
        top: 8, left: 8,
        fontFamily: 'var(--ff-mono)', fontSize: 9.5,
        color: 'rgba(255,255,255,0.7)',
        background: 'rgba(0,0,0,0.35)',
        padding: '1px 6px', borderRadius: 3,
      }}>{structure.code}</div>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{
          width: 46, height: 46, borderRadius: '50%',
          border: '1.4px solid rgba(255,255,255,0.85)',
          display: 'grid', placeItems: 'center',
          color: 'rgba(255,255,255,0.95)',
        }}><Icon name="play" size={16} /></div>
      </div>
      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.25, ...v.titleStyle }}>{v.title}</div>
        <div style={{ fontSize: 10.5, marginTop: 4, ...v.subStyle }}>{v.sub}</div>
        <div className="mono" style={{ fontSize: 9.5, marginTop: 6, opacity: 0.7, color: 'rgba(255,255,255,0.7)' }}>
          {v.time}
        </div>
      </div>
    </div>
  );
};

// Same-materials indicator — shows the user's 6 fixed materials being plugged in
const SameMatsBar = ({ compact }: { compact?: boolean }) => (
  <div style={{
    display: 'flex', gap: 4, alignItems: 'center',
    fontSize: 10.5, color: 'var(--text-mute)', flexWrap: 'wrap',
  }}>
    {!compact && <span className="eyebrow" style={{ marginRight: 4 }}>输入素材</span>}
    {TARGET_MATERIALS.map(m => (
      <span key={m.id} className="tag" style={{ padding: '1px 6px', fontSize: 10 }}>
        {m.id.toUpperCase()}
      </span>
    ))}
    {!compact && <span className="mono dim" style={{ fontSize: 10 }}>· 6 项相同</span>}
  </div>
);

// Lab metric rendered as horizontal bar
const LabMetric = ({ label, value, max = 50, color = 'var(--accent)' }: {
  label: string; value: number; max?: number; color?: string;
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
    <span style={{ width: 56, color: 'var(--text-dim)' }}>{label}</span>
    <div style={{ flex: 1, height: 5, background: 'var(--bg-2)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${max > 0 ? (Math.min(value, max) / max) * 100 : 0}%`, background: color, opacity: 0.85 }} />
    </div>
    <span className="mono" style={{ width: 38, textAlign: 'right', color: 'var(--text-2)' }}>{value}%</span>
  </div>
);

/* ─── Direction A: 3 columns side-by-side (the literal layout) ── */

const LabDirectionA = () => (
  <div className="lab-grid cols-3">
    {LAB_STRUCTURES.map(s => (
      <div key={s.id} className="lab-col">
        <div className="lab-col-head">
          <div className="lab-col-title">
            <h4>{s.name}</h4>
            <span className="mono dim" style={{ fontSize: 10.5 }}>{s.code}</span>
          </div>
          <div className="lab-col-sub">
            <span className="tag" style={{ padding: '1px 6px', fontSize: 10, color: s.color, borderColor: s.color + '55' }}>
              {s.family}
            </span>
            <span style={{ marginLeft: 8 }}>· {s.source_title}</span>
          </div>
        </div>
        <div className="lab-col-body">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>结构序列</div>
            <ResequencedBand structure={s} />
            <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>
              {s.sequence.map((r, i) => (
                <span key={i}>
                  <span style={{ color: `var(--r-${r})` }}>{r}</span>
                  {i < s.sequence.length - 1 ? ' · ' : ''}
                </span>
              ))}
            </div>
          </div>
          <LabPreview structure={s} />
          <SameMatsBar compact />
          <div className="col" style={{ gap: 4 }}>
            <LabMetric label="点击 CTR"  value={parseFloat(s.sig.预测点击)} max={12} color={s.color} />
            <LabMetric label="完播率"    value={parseFloat(s.sig.预测完播)} max={60} color={s.color} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

/* ─── Direction B: 3 stacked rows, structure on left, preview on right ── */

const LabDirectionB = () => (
  <div className="col">
    {/* shared timecode header */}
    <div className="panel">
      <div className="panel-head">
        <h4>同时间轴对位 · Shared Timeline</h4>
        <span className="eyebrow">3 STRUCTURES · SAME ASSETS</span>
      </div>
      <div className="panel-body">
        <SameMatsBar />
        <div className="mt-12">
          {LAB_STRUCTURES.map((s, i) => (
            <div key={s.id} style={{
              display: 'grid',
              gridTemplateColumns: '200px 1fr 200px',
              gap: 16,
              padding: '12px 0',
              borderBottom: i < LAB_STRUCTURES.length - 1 ? '1px solid var(--border)' : 'none',
              alignItems: 'center',
            }}>
              {/* L: meta */}
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
                <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4 }}>{s.code} · {s.family}</div>
                <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>{s.bgm}</div>
              </div>
              {/* M: band */}
              <div>
                <ResequencedBand structure={s} height={34} />
                <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>
                  {s.sequence.length} 段 · {s.durations.reduce((a, b) => a + b, 0).toFixed(1)}s
                </div>
              </div>
              {/* R: tiny preview + metrics */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                <div style={{ width: 64 }}><LabPreview structure={s} /></div>
                <div className="col" style={{ gap: 4, flex: 1, justifyContent: 'center' }}>
                  <LabMetric label="CTR"  value={parseFloat(s.sig.预测点击)} max={12} color={s.color} />
                  <LabMetric label="完播" value={parseFloat(s.sig.预测完播)} max={60} color={s.color} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* diff table */}
    <div className="panel">
      <div className="panel-head">
        <h4>差异透视</h4>
        <span className="eyebrow">维度 × 版本</span>
      </div>
      <div className="panel-body flush">
        <table className="diff-table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>维度</th>
              {LAB_STRUCTURES.map(s => (
                <th key={s.id} style={{ color: s.color }}>{s.code} · {s.family}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LAB_DIFF_ROWS.map(row => (
              <tr key={row}>
                <td className="mono" style={{ color: 'var(--text-mute)' }}>{row}</td>
                {LAB_STRUCTURES.map(s => (
                  <td key={s.id} style={{ color: 'var(--text-2)' }}>{s.sig[row] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

/* ─── Direction C: matrix grid (Variant × Dimension cells) ──────── */

interface LabDim {
  key: string;
  label: string;
  render: (s: LabStructure) => ReactElement;
}

const LabDirectionC = () => {
  const dims: LabDim[] = [
    { key: '段落顺序', label: '段落顺序', render: (s) => (
        <div>
          <ResequencedBand structure={s} height={28} />
          <div className="mono dim" style={{ fontSize: 9.5, marginTop: 6 }}>
            {s.sequence.join(' · ')}
          </div>
        </div>
      )
    },
    { key: '节奏', label: '节奏', render: (s) => (
      <div>
        <div style={{ fontSize: 12, color: 'var(--text)' }}>{s.sig.节奏}</div>
        <div className="bars" style={{ height: 18, marginTop: 6 }}>
          {(s.id === 'A' ? [2, 2, 3, 4, 3, 3, 2, 2, 2, 3, 4] :
            s.id === 'B' ? [6, 7, 8, 7, 6, 7, 8, 7, 8, 7, 6] :
                           [4, 4, 4, 5, 4, 5, 4, 4, 5, 4, 4]).map((v, i) => (
            <div key={i} className="bar" style={{ height: `${v * 10}%`, background: s.color }} />
          ))}
        </div>
        <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>{s.bgm}</div>
      </div>
    )},
    { key: '包装', label: '包装', render: (s) => (
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.4 }}>{s.sig.包装}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
          {s.id === 'A' && [<span key="1" className="tag" style={{ background: '#fff', color: '#000', padding: '1px 5px' }}>白底</span>,
                            <span key="2" className="tag" style={{ background: 'oklch(0.65 0.12 22)', color: '#fff', padding: '1px 5px' }}>红重</span>]}
          {s.id === 'B' && [<span key="1" className="tag" style={{ background: 'oklch(0.72 0.10 75)', color: '#000', padding: '1px 5px' }}>黄底</span>,
                            <span key="2" className="tag" style={{ background: '#000', color: 'oklch(0.72 0.10 75)', padding: '1px 5px', borderColor: 'oklch(0.72 0.10 75)' }}>大字</span>]}
          {s.id === 'C' && [<span key="1" className="tag" style={{ background: 'oklch(0.20 0.02 248)', color: 'oklch(0.68 0.08 248)', padding: '1px 5px', borderColor: 'oklch(0.40 0.04 248)' }}>深底</span>,
                            <span key="2" className="tag" style={{ background: '#0a0f17', color: '#e6ecf2', padding: '1px 5px' }}>印章</span>]}
        </div>
      </div>
    )},
    { key: '预测点击', label: '预测点击', render: (s) => (
      <div>
        <div className="stat-value" style={{ fontSize: 22, color: s.color }}>{s.sig.预测点击}</div>
        <div className="mono dim" style={{ fontSize: 10 }}>predicted CTR</div>
      </div>
    )},
    { key: '预测完播', label: '预测完播', render: (s) => (
      <div>
        <div className="stat-value" style={{ fontSize: 22, color: s.color }}>{s.sig.预测完播}</div>
        <div className="mono dim" style={{ fontSize: 10 }}>predicted finish</div>
      </div>
    )},
  ];

  return (
    <div className="col">
      {/* column headers with previews */}
      <div className="panel">
        <div className="panel-head">
          <h4>差异矩阵 · Variant × Dimension</h4>
          <span className="eyebrow">3 STRUCTURES · 5 DIMS</span>
        </div>
        <div className="panel-body flush">
          <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(3, 1fr)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: 14, background: 'var(--bg-2)' }}>
              <div className="eyebrow">维度 ↓</div>
              <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>版本 →</div>
            </div>
            {LAB_STRUCTURES.map(s => (
              <div key={s.id} style={{ padding: 14, background: 'var(--bg-2)', borderLeft: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: s.color }}>{s.code}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.family}</span>
                </div>
                <div className="dim" style={{ fontSize: 11 }}>{s.name}</div>
              </div>
            ))}
          </div>

          {/* row: tiny preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(3, 1fr)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: 14 }}>
              <div className="eyebrow">预览</div>
              <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>渲染结果</div>
            </div>
            {LAB_STRUCTURES.map(s => (
              <div key={s.id} style={{ padding: 12, borderLeft: '1px solid var(--border)' }}>
                <div style={{ maxWidth: 130, margin: '0 auto' }}>
                  <LabPreview structure={s} />
                </div>
              </div>
            ))}
          </div>

          {/* dimension rows */}
          {dims.map(d => (
            <div key={d.key} style={{
              display: 'grid', gridTemplateColumns: '160px repeat(3, 1fr)',
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ padding: 14, background: 'var(--bg-2)', display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{d.label}</span>
              </div>
              {LAB_STRUCTURES.map(s => (
                <div key={s.id} style={{ padding: 14, borderLeft: '1px solid var(--border)' }}>
                  {d.render(s)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* same-mats footer */}
      <div className="panel">
        <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <SameMatsBar />
        </div>
      </div>
    </div>
  );
};

/* ─── The screen shell with direction tabs ────────────────── */

export const ScreenLab = () => {
  const [dir, setDir] = useState('A');

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">LAB</div>
          <div>
            <h1>结构实验室 · Structure Lab</h1>
            <div className="screen-head-sub">
              同一份商品素材 → 套用 3 个源结构 → 并排生成肉眼可辨差异的成片
            </div>
          </div>
        </div>
        <div className="screen-head-r" style={{ gap: 8 }}>
          <span className="mono">3 structures · 6 fixed assets</span>
        </div>
      </div>

      {/* direction tab strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16,
        padding: '10px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="eyebrow" style={{ marginRight: 8 }}>LAYOUT DIRECTION</span>
          {[
            { id: 'A', name: '三栏并排', desc: 'side-by-side columns' },
            { id: 'B', name: '横向对位', desc: 'shared timeline · stacked' },
            { id: 'C', name: '差异矩阵', desc: 'variant × dimension grid' },
          ].map(d => (
            <button
              key={d.id}
              onClick={() => setDir(d.id)}
              className="btn"
              aria-pressed={dir === d.id}
              style={{
                padding: '6px 10px',
                fontSize: 11.5,
                background: dir === d.id ? 'var(--accent-dim)' : 'transparent',
                borderColor: dir === d.id ? 'var(--accent-line)' : 'var(--border-2)',
                color: dir === d.id ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              <span className="mono" style={{ fontSize: 10, opacity: 0.7, marginRight: 4 }}>· {d.id}</span>
              {d.name}
              <span className="mono dim" style={{ fontSize: 9.5, marginLeft: 6, opacity: 0.7 }}>{d.desc}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono dim" style={{ fontSize: 10.5 }}>差异强度</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{
                width: 6, height: 14,
                background: i <= 4 ? 'var(--accent)' : 'var(--border-2)',
                borderRadius: 1,
              }} />
            ))}
          </div>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)' }}>HIGH</span>
        </div>
      </div>

      {/* the direction content */}
      {dir === 'A' && <LabDirectionA />}
      {dir === 'B' && <LabDirectionB />}
      {dir === 'C' && <LabDirectionC />}

      {/* the verdict caption — the user explicitly asked for this */}
      <div className="lab-caption">
        <div>
          <b>输入相同 · 差异全部来自结构</b>
          <span style={{ marginLeft: 12, color: 'var(--text-dim)', fontSize: 12 }}>
            6 项相同素材 → 3 套源结构 → 3 种节奏/包装/排序 → 3 条肉眼可辨差异的成片
          </span>
        </div>
        <span className="mono">PROOF · NOT-A-TEMPLATE</span>
      </div>
    </div>
  );
};
