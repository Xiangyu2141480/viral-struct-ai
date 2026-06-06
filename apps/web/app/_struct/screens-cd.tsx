'use client';

// screens-cd.tsx — Screens 3–4 (Diagnose + Compile, the heavy hitters)
// (Ported from screens-cd.jsx; React/window globals replaced with imports.)

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { NL_PROMPTS, ROLES, type StateKey } from './data';
import { useProjectStore } from './store/useProjectStore';
import {
  FramePlaceholder,
  Icon,
  Modal,
  SatisfactionRing,
  ScreenFooter,
  StateBadge,
  StrategyTag,
  StructureBand,
  SvgCompareShape,
  SvgCtaShape,
  SvgEmotionShape,
  SvgHookShape,
  SvgPainShape,
  SvgProductShape,
  SvgSocialShape,
  TimeRuler,
  Toast,
} from './components';

/* ============================================================
   屏 3 · 素材缺口诊断  ★ 重点屏 (the moat)
   ============================================================ */

const STATE_ORDER: StateKey[] = ['filled', 'weakly', 'missing', 'critical'];
const STATE_LABELS: Record<string, string> = { filled: '已满足', weakly: '弱满足', missing: '缺失', critical: '关键缺失' };

export const ScreenDiagnose = ({ onNext, onBack }: { onNext: () => void; onBack: () => void }) => {
  const v = useProjectStore((s) => s.sourceVideo);
  const diagnosis = useProjectStore((s) => s.diagnosis);
  const appliedSlots = useProjectStore((s) => s.appliedSlots);
  const applyStrategy = useProjectStore((s) => s.applyStrategy);
  const T = v.duration;
  const [selected, setSelected] = useState('s2');
  const [previewSlot, setPreviewSlot] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  };

  const summary = STATE_ORDER.reduce<Record<string, number>>((acc, st) => {
    acc[st] = Object.values(diagnosis).filter(d => d.state === st).length;
    return acc;
  }, {});

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">03 / 诊断</div>
          <div>
            <h1>素材缺口诊断</h1>
            <div className="screen-head-sub">
              结构槽位 × 用户素材 = 四态匹配；标出缺口、解释影响、给出补全路径
            </div>
          </div>
        </div>
        <div className="screen-head-r">
          <span className="mono">{summary.critical + summary.missing} 个待补</span>
          <span className="pill" style={{ color: 'var(--st-critical)', borderColor: 'var(--st-critical-line)', background: 'var(--st-critical-bg)' }}>
            <span className="dot" style={{ background: 'var(--st-critical)' }} /> 1 关键缺口
          </span>
        </div>
      </div>

      {/* OVERVIEW · 整体满足度 + 4 宫格状态分布 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h4>整体素材满足度</h4>
          <span className="eyebrow">概览 · 7 个槽位</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '180px 1px 1.1fr 1px 1fr', gap: 18, alignItems: 'center' }}>
          {(() => {
            const total = v.segments.length;
            const sat = Math.round(
              ((summary.filled * 1 + summary.weakly * 0.6 + summary.missing * 0.3 + summary.critical * 0.15) / total) * 100
            );
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <SatisfactionRing pct={sat} size={150} label="整体满足度" />
                </div>
                <div style={{ background: 'var(--border)' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { st: 'filled',   key: '已满足',     count: summary.filled,   color: 'var(--st-filled)',   bg: 'var(--st-filled-bg)',   line: 'var(--st-filled-line)' },
                    { st: 'weakly',   key: '弱满足',     count: summary.weakly,   color: 'var(--st-weakly)',   bg: 'var(--st-weakly-bg)',   line: 'var(--st-weakly-line)' },
                    { st: 'missing',  key: '缺失',       count: summary.missing,  color: 'var(--st-missing)',  bg: 'var(--st-missing-bg)',  line: 'var(--st-missing-line)' },
                    { st: 'critical', key: '关键缺失',   count: summary.critical, color: 'var(--st-critical)', bg: 'var(--st-critical-bg)', line: 'var(--st-critical-line)' },
                  ].map(s => (
                    <div key={s.st} style={{
                      padding: '10px 12px',
                      background: s.bg,
                      border: `1px solid ${s.line}`,
                      borderRadius: 5,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div>
                        <div className="mono" style={{ fontSize: 9.5, color: s.color, letterSpacing: '0.06em', fontWeight: 700 }}>
                          {s.st.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 2 }}>{s.key}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 22, fontWeight: 700, color: s.color }}>
                        {s.count}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--border)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="eyebrow">建议补全策略 · 混合方案</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <StrategyTag kind="aigc" />
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>2 槽位</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <StrategyTag kind="hyperframes" />
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>2 槽位</span>
                    </div>
                  </div>

                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Top: structure band — diagnostic overlay (gaps visible at a glance) */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h4>诊断俯视图 · 结构带 + 四态叠加</h4>
          <span className="eyebrow">诊断叠加 · 0 ~ {T}s</span>
        </div>
        <div className="panel-body">
          {/* role band */}
          <div style={{ marginBottom: 6 }}>
            <span className="eyebrow">▲ 角色序列</span>
          </div>
          <StructureBand segments={v.segments} total={T} />
          {/* state overlay band */}
          <div style={{ marginTop: 10, marginBottom: 6 }}>
            <span className="eyebrow">▼ 素材状态叠加</span>
          </div>
          <div className="sband" style={{ height: 38 }}>
            {v.segments.map(seg => {
              const d = diagnosis[seg.id];
              const dur = seg.end - seg.start;
              const w = (dur / T) * 100;
              const stateClass = d.state;
              const stateColor = {
                filled: 'var(--st-filled)',
                weakly: 'var(--st-weakly)',
                missing: 'var(--st-missing)',
                critical: 'var(--st-critical)',
              }[d.state];
              return (
                <div
                  key={seg.id}
                  className="sband-seg"
                  style={{
                    width: `${w}%`,
                    background: stateColor,
                    color: 'rgba(0,0,0,0.85)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelected(seg.id)}
                  title={STATE_LABELS[d.state]}
                >
                  <span className="sband-seg-label">
                    {STATE_LABELS[d.state]}
                  </span>
                </div>
              );
            })}
          </div>
          <TimeRuler duration={T} intervals={7} />
          <div className="hrule">图例 · 四态</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <StateBadge state="filled"   /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.filled} 槽位</span>
            <StateBadge state="weakly"   /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.weakly} 槽位</span>
            <StateBadge state="missing"  /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.missing} 槽位</span>
            <StateBadge state="critical" /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.critical} 槽位</span>
          </div>
        </div>
      </div>

      {/* Main body: left = 槽位明细, right = 槽位详情 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 16 }}>
        {/* LEFT: 槽位明细 (matrix) */}
        <div className="panel">
            <div className="panel-head">
              <h4>槽位明细</h4>
              <span className="eyebrow">需要 ↔ 已有 匹配</span>
            </div>
            <div className="panel-body flush">
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>槽位</th>
                    <th>需要</th>
                    <th>已有</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {v.segments.map(seg => {
                    const d = diagnosis[seg.id];
                    return (
                      <tr key={seg.id} onClick={() => setSelected(seg.id)} style={{ cursor: 'pointer', background: selected === seg.id ? 'var(--accent-dim)' : 'transparent' }}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className={`role-dot role-${seg.role}`} />
                            <span className="mono" style={{ fontSize: 11 }}>{seg.id}</span>
                            <span style={{ color: 'var(--text)' }}>{seg.label}</span>
                          </span>
                        </td>
                        <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>{d.need.join(' · ')}</td>
                        <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>{d.have.length ? d.have.join(' · ') : '—'}</td>
                        <td><StateBadge state={d.state} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        {/* RIGHT: 槽位详情 */}
        <div className="col">

          {/* ── SLOT DETAIL · master-detail bound to `selected` ── */}
          {(() => {
            const seg = v.segments.find(s => s.id === selected);
            if (!seg) return null;
            const d = diagnosis[selected];
            const role = ROLES[seg.role];
            const stratKind = d.strategy;
            return (
              <div className="panel slot-detail-panel">
                <div className="panel-head">
                  <h4>
                    <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 11, marginRight: 8 }}>
                      {seg.id.toUpperCase()}
                    </span>
                    槽位详情 · {seg.label}
                  </h4>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>
                    点击左侧 / 矩阵切换
                  </span>
                </div>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* head row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 12,
                    alignItems: 'center',
                  }}>
                    <div style={{
                      width: 46, height: 46,
                      background: `var(--r-${seg.role})`,
                      borderRadius: 6,
                      display: 'grid', placeItems: 'center',
                      color: 'rgba(0,0,0,0.85)',
                      padding: 4,
                      flexDirection: 'column',
                    }}>
                      <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em' }}>{(seg.end - seg.start).toFixed(1)}s</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{role.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2, lineHeight: 1.4 }}>
                        {role.desc}
                      </div>
                    </div>
                    <StateBadge state={d.state} />
                  </div>

                  {/* need / have chips */}
                  <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: '6px 12px', alignItems: 'center' }}>
                    <span className="eyebrow">需要</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {d.need.map((n, i) => {
                        const hasIt = d.have.some(h => h.includes(n) || n.includes(h.split(' ')[1] || ''));
                        return (
                          <span key={i} className={`need-chip ${hasIt ? 'have' : 'miss'}`}>{n}</span>
                        );
                      })}
                    </div>
                    <span className="eyebrow">已有</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {d.have.length > 0
                        ? d.have.map((h, i) => <span key={i} className="need-chip have">{h}</span>)
                        : <span className="mono" style={{ color: 'var(--st-missing)', fontSize: 11 }}>—  无来料 —</span>}
                    </div>
                  </div>

                  {/* gap reason */}
                  {d.state !== 'filled' && d.gap_reason !== '—' && (
                    <div style={{
                      padding: '10px 12px',
                      background: d.state === 'critical' ? 'var(--st-critical-bg)' : 'var(--surface)',
                      border: `1px solid ${d.state === 'critical' ? 'var(--st-critical-line)' : 'var(--border)'}`,
                      borderRadius: 5,
                      fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-dim)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Icon name="diagnose" size={12} />
                        <span className="eyebrow" style={{ color: d.state === 'critical' ? 'var(--st-critical)' : 'var(--text-mute)' }}>
                          GAP · 缺口原因
                        </span>
                      </div>
                      {d.gap_reason}
                    </div>
                  )}

                  {/* recommended strategy */}
                  {stratKind ? (
                    <div style={{
                      padding: '12px 14px',
                      background: 'var(--bg-2)',
                      border: '1px solid var(--accent-line)',
                      borderLeft: '3px solid var(--accent)',
                      borderRadius: 5,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span className="eyebrow" style={{ color: 'var(--accent)' }}>推荐补全策略</span>
                        <StrategyTag kind={stratKind} />
                        <span style={{ flex: 1 }} />
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>
                          AI 置信度 <b style={{ color: 'var(--st-filled)' }}>85%</b>
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                        <b style={{ color: 'var(--text-2)' }}>{d.fix?.kind}</b>
                        <span style={{ color: 'var(--text-dim)' }}>　·　{d.fix?.desc}</span>
                      </div>
                      <div style={{
                        marginTop: 10,
                        padding: '8px 10px',
                        background: 'var(--surface)',
                        borderRadius: 4,
                        fontSize: 11, color: 'var(--text-dim)',
                        lineHeight: 1.5,
                      }}>
                        <span className="mono" style={{ color: 'var(--accent-2)', fontSize: 10.5 }}>IMPACT</span>
                        　·　{d.impact.note}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                        <button className="btn" style={{ padding: '5px 12px', fontSize: 11.5 }}
                          onClick={() => { setPreviewSlot(previewSlot === selected ? null : selected); }}>
                          <Icon name="play" size={11} /> {previewSlot === selected ? '关闭预览' : '预览补全'}
                        </button>
                        <button className="btn primary" style={{ padding: '5px 12px', fontSize: 11.5 }}
                          disabled={appliedSlots[selected]}
                          onClick={() => { void applyStrategy(selected); showToast(`${seg.label} 补全策略已应用`); }}>
                          <Icon name={appliedSlots[selected] ? 'check' : 'sparkle'} size={11} /> {appliedSlots[selected] ? '已应用' : '应用策略'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: '10px 12px',
                      background: 'var(--st-filled-bg)',
                      border: '1px solid var(--st-filled-line)',
                      borderRadius: 5,
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 11.5, color: 'var(--st-filled)',
                    }}>
                      <Icon name="check" size={14} />
                      该槽位已被现有素材满足,无需补全
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      <ScreenFooter
        status="3 个核心缺口待补全 · 建议混合 AIGC + 包装策略"
        statusTone="critical"
        secondary={[{ label: '返回素材', onClick: onBack }]}
        primary={{ label: '应用补全策略并生成', onClick: onNext }}
      />

      {/* Preview overlay for slot preview */}
      <Modal open={previewSlot !== null} onClose={() => setPreviewSlot(null)} title={`预览补全 · ${previewSlot ? v.segments.find(s => s.id === previewSlot)?.label : ''}`} width={400}>
        {(() => {
          if (!previewSlot) return null;
          const seg = v.segments.find(s => s.id === previewSlot);
          if (!seg) return null;
          const d = diagnosis[previewSlot];
          const SVG_BY_ROLE: Record<string, ReactElement> = {
            hook: <SvgHookShape />, pain: <SvgPainShape />, emotion: <SvgEmotionShape />,
            product: <SvgProductShape />, compare: <SvgCompareShape />, social: <SvgSocialShape />, cta: <SvgCtaShape />,
          };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{
                aspectRatio: '16/9', borderRadius: 6, overflow: 'hidden',
                position: 'relative', background: 'var(--bg-2)',
              }}>
                <div style={{ position: 'absolute', inset: 0, opacity: 0.6 }}>
                  {SVG_BY_ROLE[seg.role]}
                </div>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'grid', placeItems: 'center',
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    border: '1.5px solid var(--accent)',
                    display: 'grid', placeItems: 'center', color: 'var(--accent)',
                  }}><Icon name="play" size={16} /></div>
                </div>
                <div style={{
                  position: 'absolute', bottom: 8, left: 10, right: 10,
                  fontSize: 11, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}>
                  &quot;{seg.caption}&quot;
                </div>
              </div>
              <dl className="kv">
                <dt>补全策略</dt><dd><StrategyTag kind={d.strategy} size="sm" /></dd>
                <dt>动作</dt><dd>{d.fix?.desc}</dd>
                <dt>影响</dt><dd>{d.impact.note}</dd>
              </dl>
            </div>
          );
        })()}
      </Modal>

      <Toast message={toastMsg} visible={toastVisible} />
    </div>
  );
};

/* ============================================================
   屏 4 · 缺口补全与成片编译
   ============================================================ */

export const ScreenCompile = ({ onBack }: { onBack: () => void }) => {
  const v = useProjectStore((s) => s.sourceVideo);
  const diagnosis = useProjectStore((s) => s.diagnosis);
  const versions = useProjectStore((s) => s.versions);
  const selectedVersionId = useProjectStore((s) => s.selectedVersionId);
  const selectVersion = useProjectStore((s) => s.selectVersion);
  const compile = useProjectStore((s) => s.compile);
  const applyNlEdit = useProjectStore((s) => s.applyNlEdit);
  const exportVideo = useProjectStore((s) => s.exportVideo);
  const compiling = useProjectStore((s) => s.compiling);
  const nlApplying = useProjectStore((s) => s.nlApplying);
  const exporting = useProjectStore((s) => s.exporting);
  const T = v.duration;
  const [nlText, setNlText] = useState('');
  const [playingSeg, setPlayingSeg] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  };

  // Auto-play all segments sequentially
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startAutoPlay = () => {
    setAutoPlaying(true);
    let idx = 0;
    const segs = v.segments;
    setPlayingSeg(segs[0].id);
    autoPlayRef.current = setInterval(() => {
      idx++;
      if (idx >= segs.length) {
        if (autoPlayRef.current) clearInterval(autoPlayRef.current);
        setAutoPlaying(false);
        setPlayingSeg(null);
        showToast('全篇预览完成');
        return;
      }
      setPlayingSeg(segs[idx].id);
    }, 1500);
  };

  useEffect(() => {
    return () => { if (autoPlayRef.current) clearInterval(autoPlayRef.current); };
  }, []);

  const fixSegs = v.segments.filter(s => diagnosis[s.id]?.fix);
  const currentVersion = versions.find(c => c.id === selectedVersionId)!;
  const playingSegData = playingSeg ? v.segments.find(s => s.id === playingSeg) : null;
  const playingRole = playingSegData ? ROLES[playingSegData.role] : null;

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">04 / 成片</div>
          <div>
            <h1>缺口补全与成片编译</h1>
            <div className="screen-head-sub">
              对每个缺口给出修复方案 → 编译为可播放时间线 → Remotion 渲染输出
            </div>
          </div>
        </div>
        <div className="screen-head-r">
          <button className="btn primary" disabled={compiling} onClick={() => {
            void compile().then(() => showToast('渲染完成 · 成片已生成'));
          }}>
            <Icon name="sparkle" size={12} /> {compiling ? '渲染中…' : '渲染成片'}
          </button>
        </div>
      </div>

      {/* VERSION SWITCHER · 3 preset compile variants */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h4>版本切换 · 3 个编译预设</h4>
          <span className="eyebrow">版本 · {currentVersion.name}</span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {versions.map(ver => {
              const active = ver.id === selectedVersionId;
              return (
                <button
                  key={ver.id}
                  onClick={() => selectVersion(ver.id)}
                  className={`version-card ${active ? 'active' : ''}`}
                  style={{
                    padding: 14,
                    background: active ? 'var(--accent-dim)' : 'var(--surface)',
                    border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border)'}`,
                    borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    display: 'flex', flexDirection: 'column', gap: 10,
                    transition: 'all 150ms',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text)' }}>
                        {ver.name}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '0.04em', marginTop: 2 }}>
                        v3 · {ver.id.toUpperCase()}
                      </div>
                    </div>
                    {active && (
                      <span className="mono" style={{
                        fontSize: 9.5, padding: '2px 6px',
                        background: 'var(--accent)', color: 'var(--bg)',
                        borderRadius: 3, fontWeight: 700,
                      }}>当前</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                    {ver.desc}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.4, fontStyle: 'italic' }}>
                    {ver.bias}
                  </div>


                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16 }}>
        {/* LEFT: preview */}
        <div className="col" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="panel-head">
              <h4>预览</h4>
              <span className="pill accent"><span className="dot" />{currentVersion.name} · 已编译</span>
            </div>
            <div className="panel-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {(() => {
                const SVG_BY_ROLE: Record<string, ReactElement> = {
                  hook: <SvgHookShape />, pain: <SvgPainShape />, emotion: <SvgEmotionShape />,
                  product: <SvgProductShape />, compare: <SvgCompareShape />, social: <SvgSocialShape />, cta: <SvgCtaShape />,
                };
                const seg = playingSegData;
                const caption = seg ? seg.caption : '她戴二十年了 · 也送她一只新的';
                const timeLabel = seg
                  ? `${seg.start.toFixed(1)}s → ${seg.end.toFixed(1)}s · ${(seg.end - seg.start).toFixed(1)}s`
                  : '00:08 / 00:28 · ratio 9:16';
                const bgSvg = seg ? SVG_BY_ROLE[seg.role] : <SvgEmotionShape />;
                return (
                  <>
                    <div style={{
                      flex: 1,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'grid',
                      placeItems: 'center',
                    }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #1e2a25, #0f1414)' }} />
                      <div style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
                        {bgSvg}
                      </div>
                      {seg && (
                        <div style={{
                          position: 'absolute', top: 12, left: 12,
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <span className={`role-dot role-${seg.role}`} />
                          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{seg.id.toUpperCase()} · {seg.label}</span>
                        </div>
                      )}
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexDirection: 'column', gap: 8,
                      }}>
                        <div style={{
                          width: 56, height: 56, borderRadius: '50%',
                          border: '1.5px solid var(--accent)',
                          display: 'grid', placeItems: 'center',
                          color: 'var(--accent)',
                        }}><Icon name="play" size={20} /></div>
                        {seg && (
                          <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', opacity: 0.8 }}>
                            {seg.shot}
                          </div>
                        )}
                      </div>
                      <div style={{
                        position: 'absolute', left: 12, bottom: 12, right: 12,
                        fontSize: 13, color: '#fff', lineHeight: 1.3,
                        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                      }}>
                        <div style={{ fontWeight: 600 }}>{caption}</div>
                        <div className="mono" style={{ fontSize: 9.5, opacity: 0.7, marginTop: 4 }}>{timeLabel}</div>
                      </div>
                    </div>
                    <div className="grid-2" style={{ gap: 8, marginTop: 12 }}>
                      <button className="btn" style={{ justifyContent: 'center', gridColumn: 'span 2' }}
                        disabled={autoPlaying}
                        onClick={startAutoPlay}>
                        <Icon name="play" size={12} /> {autoPlaying ? '播放中…' : '全篇预览'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* RIGHT: timeline + NL edit */}
        <div className="col">
          {/* timeline editor */}
          <div className="panel">
            <div className="panel-head">
              <h4>时间线编辑器</h4>
              <span className="eyebrow">重排序 · v3</span>
            </div>
            <div className="panel-body">
              <div className="eyebrow" style={{ marginBottom: 6 }}>▲ 结构带 (原序保留)</div>
              <StructureBand segments={v.segments} total={T} />
              <div className="sync-link" style={{ marginTop: 4 }}>
                {v.segments.map(seg => {
                  const dur = seg.end - seg.start;
                  return (
                    <div key={seg.id} className="sync-link-seg" style={{ width: `${(dur / T) * 100}%` }} />
                  );
                })}
              </div>
              <div className="eyebrow" style={{ marginBottom: 6, marginTop: 4 }}>▼ 编译后镜头层 + 补全标记</div>
              <div className="tline" style={{ height: 76 }}>
                {v.segments.map(seg => {
                  const d = diagnosis[seg.id];
                  const dur = seg.end - seg.start;
                  const w = (dur / T) * 100;
                  const hasFix = d.fix !== null;
                  const isPlaying = playingSeg === seg.id;
                  return (
                    <div
                      key={seg.id}
                      className="tline-frame"
                      onClick={() => setPlayingSeg(isPlaying ? null : seg.id)}
                      style={{
                        width: `${w}%`,
                        '--role-color': `var(--r-${seg.role})`,
                        position: 'relative',
                        cursor: 'pointer',
                        outline: isPlaying ? '2px solid var(--accent)' : 'none',
                        outlineOffset: -1,
                        zIndex: isPlaying ? 2 : 1,
                        borderRadius: 3,
                        overflow: 'hidden',
                      } as CSSProperties}
                    >
                      <FramePlaceholder role={seg.role} label={seg.shot} />
                      {/* play icon overlay */}
                      {isPlaying && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'grid', placeItems: 'center',
                          background: 'rgba(0,0,0,0.3)',
                          zIndex: 3,
                          pointerEvents: 'none',
                        }}>
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%',
                            background: 'var(--accent)',
                            display: 'grid', placeItems: 'center',
                          }}>
                            <Icon name="play" size={10} />
                          </div>
                        </div>
                      )}
                      {/* fix badge overlay */}
                      {hasFix && !isPlaying && (
                        <div style={{
                          position: 'absolute',
                          top: 6, right: 6,
                          padding: '2px 6px',
                          background: d.state === 'filled' ? 'var(--st-filled-bg)' :
                                       d.state === 'weakly' ? 'var(--st-weakly-bg)' :
                                       d.state === 'critical' ? 'var(--st-critical-bg)' : 'var(--st-missing-bg)',
                          border: `1px solid ${
                            d.state === 'filled' ? 'var(--st-filled-line)' :
                            d.state === 'weakly' ? 'var(--st-weakly-line)' :
                            d.state === 'critical' ? 'var(--st-critical-line)' : 'var(--st-missing-line)'
                          }`,
                          borderRadius: 3,
                          fontSize: 9,
                          fontFamily: 'var(--ff-mono)',
                          color:
                            d.state === 'filled' ? 'var(--st-filled)' :
                            d.state === 'weakly' ? 'var(--st-weakly)' :
                            d.state === 'critical' ? 'var(--st-critical)' : 'var(--st-missing)',
                        }}>
                          {d.fix?.kind}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <TimeRuler duration={T} intervals={7} />
            </div>
          </div>

          {/* NATURAL LANGUAGE prompt — beta */}
          <div className="panel">
            <div className="panel-head">
              <h4>自然语言改片</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="eyebrow">自然语言 · 对话改片</span>
              </div>
            </div>
            <div className="panel-body">
              <div style={{ position: 'relative' }}>
                <textarea
                  rows={3}
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  placeholder="说一句话改这条视频。例如:把商品信息提前 / 开头更抓人 / 减少字幕,节奏更快"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    paddingRight: 56,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                    resize: 'vertical',
                    outline: 'none',
                    lineHeight: 1.5,
                  }}
                />
                <button
                  className="btn-cta"
                  onClick={() => {
                    const instruction = nlText;
                    void applyNlEdit(instruction).then((summary) => {
                      setNlText('');
                      showToast(summary || 'NL 改片已应用 · 新草稿已生成');
                    });
                  }}
                  disabled={!nlText.trim() || nlApplying}
                  style={{
                    position: 'absolute',
                    bottom: 10, right: 10,
                    padding: '6px 14px',
                    fontSize: 11.5,
                    opacity: nlText.trim() ? 1 : 0.4,
                  }}
                >
                  <Icon name="sparkle" size={11} />
                  {nlApplying ? '生成中…' : '应用'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <span className="mono dim" style={{ fontSize: 10.5, padding: '3px 0' }}>常用 →</span>
                {NL_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setNlText(p)}
                    className="btn ghost"
                    style={{
                      padding: '3px 9px',
                      fontSize: 11,
                      borderRadius: 14,
                      background: 'transparent',
                      color: 'var(--text-2)',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div style={{
                marginTop: 12,
                padding: '8px 10px',
                background: 'var(--bg-2)',
                border: '1px dashed var(--border-2)',
                borderRadius: 4,
                fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.5,
              }}>
                <Icon name="diagnose" size={10} />
                &nbsp;NL 改片会基于当前选中的 <b style={{ color: 'var(--accent-2)' }}>{currentVersion.name}</b> 版本生成新草稿,
                不影响原结构和原素材
              </div>
            </div>
          </div>
        </div>
      </div>
      <ScreenFooter
        status="v3 已编译 · CTR 4.7% / 完播 19%"
        statusTone="ok"
        secondary={[{ label: '返回诊断', onClick: onBack }, { label: '重新生成', onClick: () => {
          void compile().then(() => showToast('已重新编译 · 新版本已生成'));
        } }]}
        primary={{ label: '导出视频 MP4', onClick: () => setExportOpen(true) }}
      />

      {/* Export Modal */}
      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="导出视频" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            当前版本: <b style={{ color: 'var(--text)' }}>{currentVersion.name}</b> · v3
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { format: 'MP4 · 1080×1920', desc: '9:16 竖版 · H.264 · 适合抖音/快手' },
              { format: 'MP4 · 720×1280', desc: '9:16 竖版 · H.264 · 快速导出' },
              { format: 'MOV · ProRes', desc: '9:16 竖版 · 后期可编辑' },
            ].map((opt, i) => (
              <div key={i} style={{
                padding: '12px 14px', background: 'var(--bg-2)',
                border: '1px solid var(--border)', borderRadius: 6,
                cursor: 'pointer', transition: 'all 150ms',
              }}
              onClick={() => {
                setExportOpen(false);
                showToast(`正在导出 ${opt.format}…`);
                void exportVideo(opt.format).then((r) => showToast(r.downloadUrl ? '导出完成 · 可下载' : '导出完成'));
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{opt.format}</div>
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 3 }}>{opt.desc}</div>
              </div>
            ))}
          </div>
          {exporting && (
            <div className="mono dim" style={{ fontSize: 10.5, textAlign: 'center' }}>导出中…</div>
          )}
        </div>
      </Modal>

      <Toast message={toastMsg} visible={toastVisible} />
    </div>
  );
};
