'use client';

// screens-cd.tsx — Screens 3–4 (Diagnose + Compile, the heavy hitters)
// (Ported from the redesigned screens-cd.jsx; React/window globals replaced
//  with imports, and real-backend Zustand store wiring preserved.)

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  NL_PROMPTS,
  ROLES,
  type Diagnosis,
  type SourceSegment,
  type StateKey,
  type Transition,
} from './data';
import { useProjectStore } from './store/useProjectStore';
import { AssetManagerEvidencePanel } from './AssetManagerEvidence';
import { InsightsPanel } from './InsightsPanel';
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
import { TransitionGlyph, TransitionSeams } from './viz';

/* ============================================================
   屏 3 · 素材缺口诊断  ★ 重点屏 (the moat)
   ============================================================ */

const STATE_ORDER: StateKey[] = ['filled', 'weakly', 'missing', 'critical'];
const STATE_LABELS: Record<string, string> = { filled: '已满足', weakly: '弱满足', missing: '缺失', critical: '关键缺失' };

/* ── Gap-fill studio: 3 ways to 补素材 — 补拍 / HyperFrames / AIGC ── */
interface FillMethod {
  id: 'reshoot' | 'hyperframes' | 'aigc';
  label: string;
  icon: string;
  hint: string;
}

const FILL_METHODS: FillMethod[] = [
  { id: 'reshoot', label: '补拍建议', icon: 'image', hint: '去拍真素材 · 质感最高' },
  { id: 'hyperframes', label: 'HyperFrames 补全', icon: 'layers', hint: '复用现有素材 · 一键生成' },
  { id: 'aigc', label: 'AIGC 补全', icon: 'sparkle', hint: 'AI 生成后上传' },
];

type GenState = 'idle' | 'generating' | 'done';

const UploadedChip = ({ name, onRe }: { name: string; onRe: () => void }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 5,
    background: 'var(--st-filled-bg)', border: '1px solid var(--st-filled-line)',
    fontSize: 11.5, color: 'var(--st-filled)',
  }}>
    <Icon name="check" size={13} />
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>已上传 · {name}</span>
    <button className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={onRe}>重新上传</button>
  </div>
);

const GapFillStudio = ({
  seg,
  d,
  previewActive,
  onPreview,
  onToast,
  applied,
  onApply,
}: {
  seg: SourceSegment;
  d: Diagnosis;
  previewActive: boolean;
  onPreview: () => void;
  onToast: (msg: string) => void;
  applied: boolean;
  onApply: () => void;
}) => {
  const fill = d.fill;
  const recommended: FillMethod['id'] = d.strategy === 'aigc' ? 'aigc' : (d.strategy === 'hyperframes' ? 'hyperframes' : 'reshoot');
  const [method, setMethod] = useState<FillMethod['id']>(recommended);
  const [hfState, setHfState] = useState<GenState>('idle');
  const [reshootFile, setReshootFile] = useState<string | null>(null);
  const [aigcFile, setAigcFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const reshootInput = useRef<HTMLInputElement>(null);
  const aigcInput = useRef<HTMLInputElement>(null);

  const reshoot = fill?.reshoot;
  const hyperframes = fill?.hyperframes;
  const aigc = fill?.aigc;

  const copyPrompt = () => {
    try {
      if (navigator.clipboard) void navigator.clipboard.writeText(aigc?.prompt ?? '');
    } catch {
      /* clipboard not available */
    }
    setCopied(true);
    onToast('Prompt 已复制 · 粘贴到你的 AI 工具');
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div style={{ border: '1px solid var(--accent-line)', borderLeft: '3px solid var(--accent)', borderRadius: 5, background: 'var(--bg-2)', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <span className="eyebrow" style={{ color: 'var(--accent)' }}>补全工作台</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>选一种方式补素材</span>
        <span style={{ flex: 1 }} />
        <button className="btn" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onPreview}>
          <Icon name="play" size={11} /> {previewActive ? '关闭预览' : '预览补全'}
        </button>
        <button
          className="btn primary"
          style={{ padding: '4px 10px', fontSize: 11 }}
          disabled={applied}
          onClick={onApply}
        >
          <Icon name={applied ? 'check' : 'sparkle'} size={11} /> {applied ? '已应用' : '应用策略'}
        </button>
      </div>

      {/* method selector — three options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '10px 12px' }}>
        {FILL_METHODS.map(fm => {
          const active = method === fm.id;
          const isRec = recommended === fm.id;
          return (
            <button key={fm.id} onClick={() => setMethod(fm.id)} className="btn"
              style={{
                flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '8px 9px',
                background: active ? 'var(--accent-dim)' : 'var(--surface)',
                borderColor: active ? 'var(--accent-line)' : 'var(--border)',
                color: active ? 'var(--accent)' : 'var(--text-2)',
                position: 'relative', textAlign: 'left', height: '100%',
              }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600 }}>
                <Icon name={fm.icon} size={13} /> {fm.label}
              </span>
              <span className="mono" style={{ fontSize: 9, color: active ? 'var(--accent-2)' : 'var(--text-mute)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {isRec && (
                  <span style={{
                    fontSize: 8, fontFamily: 'var(--ff-mono)',
                    color: 'var(--bg)', background: 'var(--accent)', padding: '0 4px', borderRadius: 2, fontWeight: 700,
                  }}>推荐</span>
                )}
                {fm.hint}
              </span>
            </button>
          );
        })}
      </div>

      {/* method content */}
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 补拍建议 */}
        {method === 'reshoot' && (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{reshoot?.guide}</div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '8px 10px' }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>拍摄分镜清单</div>
              {(reshoot?.shots ?? []).map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--text-2)', padding: '3px 0', lineHeight: 1.4 }}>
                  <span className="mono" style={{ color: 'var(--text-mute)', flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
            <input ref={reshootInput} type="file" accept="video/*,image/*" style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { setReshootFile(f.name); onToast('补拍素材已上传 · 待编入时间线'); }
                e.target.value = '';
              }} />
            {reshootFile
              ? <UploadedChip name={reshootFile} onRe={() => setReshootFile(null)} />
              : <button className="btn primary" style={{ justifyContent: 'center', padding: '8px 12px' }} onClick={() => reshootInput.current?.click()}>
                  <Icon name="upload" size={12} /> 上传补拍素材
                </button>}
          </>
        )}

        {/* HyperFrames 补全 */}
        {method === 'hyperframes' && (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{hyperframes?.desc}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="eyebrow">将复用</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {(hyperframes?.uses ?? []).map(u => <span key={u} className="need-chip have">{u.toUpperCase()}</span>)}
              </div>
            </div>
            {hfState === 'done' ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5,
                background: 'var(--st-filled-bg)', border: '1px solid var(--st-filled-line)',
                fontSize: 11.5, color: 'var(--st-filled)',
              }}>
                <Icon name="check" size={13} />
                <span style={{ flex: 1 }}>已生成 · 已编入时间线</span>
                <button className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => setHfState('idle')}>重新生成</button>
              </div>
            ) : (
              <button className="btn primary" style={{ justifyContent: 'center', padding: '8px 12px' }}
                disabled={hfState === 'generating'}
                onClick={() => { setHfState('generating'); setTimeout(() => { setHfState('done'); onToast('HyperFrames 已生成补全片段'); }, 1500); }}>
                <Icon name={hfState === 'generating' ? 'layers' : 'sparkle'} size={12} />
                {hfState === 'generating' ? ' 生成中…' : ' 立即生成'}
              </button>
            )}
          </>
        )}

        {/* AIGC 补全 */}
        {method === 'aigc' && (
          <>
            <div className="eyebrow">给 AI 的 Prompt</div>
            <div style={{ position: 'relative' }}>
              <textarea readOnly value={aigc?.prompt ?? ''} rows={3}
                style={{
                  width: '100%', resize: 'none', boxSizing: 'border-box',
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5,
                  color: 'var(--text-2)', fontSize: 11.5, lineHeight: 1.5, padding: '8px 10px',
                  fontFamily: 'var(--ff-sans)', outline: 'none',
                }} />
              <button className="btn" style={{ position: 'absolute', top: 6, right: 6, padding: '2px 8px', fontSize: 10.5 }}
                onClick={copyPrompt}>
                <Icon name={copied ? 'check' : 'text'} size={11} /> {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-mute)', lineHeight: 1.4 }}>
              粘贴到即梦 / 可灵 / Sora 等工具生成后，回到这里上传 ↓
            </div>
            <input ref={aigcInput} type="file" accept="video/*" style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { setAigcFile(f.name); onToast('AI 生成视频已上传 · 待编入时间线'); }
                e.target.value = '';
              }} />
            {aigcFile
              ? <UploadedChip name={aigcFile} onRe={() => setAigcFile(null)} />
              : <button className="btn primary" style={{ justifyContent: 'center', padding: '8px 12px' }} onClick={() => aigcInput.current?.click()}>
                  <Icon name="upload" size={12} /> 上传 AI 生成的视频
                </button>}
          </>
        )}
      </div>

      {/* impact footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        <span className="mono" style={{ color: 'var(--accent-2)', fontSize: 10.5 }}>IMPACT</span>　·　{d.impact.note}
      </div>
    </div>
  );
};

/* ── Transition-fill studio: 硬切 / 过渡帧 / AIGC 补间 ── */
interface TransFillMethod {
  id: 'cut' | 'frame' | 'aigc';
  glyph: string;
  label: string;
  hint: string;
}

const TRANS_FILL_METHODS: TransFillMethod[] = [
  { id: 'cut', glyph: '硬切', label: '硬切', hint: '直接拼接 · 无需素材' },
  { id: 'frame', glyph: '叠化', label: '过渡帧', hint: '前后帧 + HyperFrames 剪辑' },
  { id: 'aigc', glyph: '推镜', label: 'AIGC 补间', hint: '相邻首尾帧 → AI 生成' },
];

const HF_EFFECT: Record<string, string> = { 叠化: '交叉叠化', 推镜: 'Ken Burns 推近', 卡点: '节奏闪切', 硬切: '短暂叠化柔化' };

const MiniFrame = ({ seg, ok, label }: { seg: SourceSegment | undefined; ok: boolean; label: string }) => (
  <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
    <div style={{
      aspectRatio: '1/1', borderRadius: 5, overflow: 'hidden', position: 'relative',
      border: ok ? '1px solid var(--border)' : '1px dashed var(--st-missing-line)',
      background: ok ? 'var(--surface-2)' : 'var(--bg-2)', display: 'grid', placeItems: 'center',
    }}>
      {ok && seg
        ? <div style={{ position: 'absolute', inset: 0, opacity: 0.75 }}><FramePlaceholder role={seg.role} label="" /></div>
        : <span className="mono" style={{ fontSize: 9, color: 'var(--st-missing)' }}>缺失</span>}
    </div>
    <div className="mono" style={{ fontSize: 9, color: ok ? 'var(--text-mute)' : 'var(--st-missing)', marginTop: 3 }}>{label}</div>
  </div>
);

const TransitionFillStudio = ({
  tr,
  segments,
  diagnosis,
  onToast,
}: {
  tr: Transition;
  segments: SourceSegment[];
  diagnosis: Record<string, Diagnosis>;
  onToast: (msg: string) => void;
}) => {
  const fromSeg = segments.find(s => s.id === tr.from);
  const toSeg = segments.find(s => s.id === tr.to);
  const fromD = diagnosis[tr.from];
  const toD = diagnosis[tr.to];
  const frameAvail = (st: StateKey | undefined) => st === 'filled' || st === 'weakly';
  const fromOK = frameAvail(fromD?.state);
  const toOK = frameAvail(toD?.state);
  const aigcReady = fromOK && toOK;
  const recommended: TransFillMethod['id'] = !tr.upgradable ? 'cut' : (aigcReady ? 'aigc' : 'frame');
  // HyperFrames effect the Agent will compose, inferred from the source transition intent.
  const hfEffect = HF_EFFECT[tr.type] ?? '交叉叠化';
  const [method, setMethod] = useState<TransFillMethod['id']>(recommended);
  const [gen, setGen] = useState<Partial<Record<TransFillMethod['id'], GenState>>>({});
  const st = gen[method] ?? 'idle';
  const runGen = (msg: string) => {
    setGen(prev => ({ ...prev, [method]: 'generating' }));
    setTimeout(() => { setGen(prev => ({ ...prev, [method]: 'done' })); onToast(msg); }, 1400);
  };

  return (
    <div style={{ border: '1px solid var(--accent-line)', borderLeft: '3px solid var(--accent)', borderRadius: 5, background: 'var(--bg-2)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <span className="eyebrow" style={{ color: 'var(--accent)' }}>转场补全工作台</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>选一种方式接上这条缝</span>
      </div>

      {/* three transition methods */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '10px 12px' }}>
        {TRANS_FILL_METHODS.map(fm => {
          const active = method === fm.id;
          const isRec = recommended === fm.id;
          return (
            <button key={fm.id} onClick={() => setMethod(fm.id)} className="btn"
              style={{
                flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '8px 9px', textAlign: 'left', height: '100%',
                background: active ? 'var(--accent-dim)' : 'var(--surface)',
                borderColor: active ? 'var(--accent-line)' : 'var(--border)',
                color: active ? 'var(--accent)' : 'var(--text-2)',
              }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600 }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 14, height: 14 }}>
                  <TransitionGlyph type={fm.glyph} color="currentColor" size={13} />
                </span>
                {fm.label}
              </span>
              <span className="mono" style={{ fontSize: 9, color: active ? 'var(--accent-2)' : 'var(--text-mute)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {isRec && (
                  <span style={{ fontSize: 8, fontFamily: 'var(--ff-mono)', color: 'var(--bg)', background: 'var(--accent)', padding: '0 4px', borderRadius: 2, fontWeight: 700 }}>推荐</span>
                )}
                {fm.hint}
              </span>
            </button>
          );
        })}
      </div>

      {/* method content */}
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {method === 'cut' && (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              两段直接拼接，无过渡素材、节奏顿挫。{!tr.upgradable ? '原结构此处本就是硬切，这是忠实复现。' : '最低配兜底，可改用右侧更柔的方式。'}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5,
              background: 'var(--st-weakly-bg)', border: '1px solid var(--st-weakly-line)',
              fontSize: 11.5, color: 'var(--st-weakly)',
            }}>
              <Icon name="check" size={13} /> 当前已应用：硬切（弱满足下限）
            </div>
          </>
        )}

        {method === 'frame' && (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              点「生成」后，Agent 读取前后帧做视觉理解，再结合原结构在此处的转场意图，用 HyperFrames 剪辑效果合成过渡帧 —— 不生成新像素。
            </div>
            {/* inputs: boundary frames the agent reads */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MiniFrame seg={fromSeg} ok={fromOK} label={`${tr.from.toUpperCase()} 末帧`} />
              <Icon name="arrow" size={12} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{
                  aspectRatio: '1/1', borderRadius: 5,
                  border: '1px dashed var(--accent-line)', background: 'var(--accent-dim)',
                  display: 'grid', placeItems: 'center',
                }}>
                  <Icon name="layers" size={14} />
                </div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--accent-2)', marginTop: 3 }}>HyperFrames</div>
              </div>
              <Icon name="arrow" size={12} />
              <MiniFrame seg={toSeg} ok={toOK} label={`${tr.to.toUpperCase()} 首帧`} />
            </div>
            {/* the intent the agent reads from the source structure */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '8px 10px', borderRadius: 5,
              background: 'var(--surface)', border: '1px solid var(--border)',
              fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5,
            }}>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)', flexShrink: 0, paddingTop: 1 }}>原意</span>
              <span>原结构此处为 <b style={{ color: 'var(--text-2)' }}>{tr.type}</b> · {tr.note}</span>
            </div>
            {st === 'done' ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5,
                background: 'var(--st-filled-bg)', border: '1px solid var(--st-filled-line)',
                fontSize: 11.5, color: 'var(--st-filled)',
              }}>
                <Icon name="check" size={13} />
                <span style={{ flex: 1 }}>Agent 已合成 · HyperFrames「{hfEffect}」</span>
                <button className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => setGen(p => ({ ...p, frame: 'idle' }))}>重做</button>
              </div>
            ) : (
              <button className="btn primary" style={{ justifyContent: 'center', padding: '8px 12px' }}
                disabled={st === 'generating'}
                onClick={() => runGen(`Agent 已用 HyperFrames「${hfEffect}」合成过渡帧`)}>
                <Icon name={st === 'generating' ? 'layers' : 'sparkle'} size={12} />
                {st === 'generating' ? ' Agent 分析前后帧…' : ' 生成过渡帧'}
              </button>
            )}
          </>
        )}

        {method === 'aigc' && (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              取相邻两段的边界帧，AIGC 生成中间补间帧 —— 比硬切自然、比图形过渡更贴素材。
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MiniFrame seg={fromSeg} ok={fromOK} label={`${tr.from.toUpperCase()} 末帧`} />
              <Icon name="arrow" size={12} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{
                  aspectRatio: '1/1', borderRadius: 5,
                  border: '1px dashed var(--accent-line)', background: 'var(--accent-dim)',
                  display: 'grid', placeItems: 'center',
                }}>
                  <Icon name="sparkle" size={14} />
                </div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--accent-2)', marginTop: 3 }}>AI 补间</div>
              </div>
              <Icon name="arrow" size={12} />
              <MiniFrame seg={toSeg} ok={toOK} label={`${tr.to.toUpperCase()} 首帧`} />
            </div>
            {!aigcReady && (
              <div style={{
                fontSize: 10.5, color: 'var(--st-missing)', fontFamily: 'var(--ff-mono)',
                padding: '6px 8px', background: 'var(--st-missing-bg)', border: '1px solid var(--st-missing-line)', borderRadius: 4,
              }}>
                需先补 {!fromOK ? tr.from.toUpperCase() : tr.to.toUpperCase()} 的边界帧，才能做首尾帧补间
              </div>
            )}
            {st === 'done'
              ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5,
                  background: 'var(--st-filled-bg)', border: '1px solid var(--st-filled-line)',
                  fontSize: 11.5, color: 'var(--st-filled)',
                }}>
                  <Icon name="check" size={13} />
                  <span style={{ flex: 1 }}>AIGC 补间帧已生成 · 已编入接缝</span>
                  <button className="btn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => setGen(p => ({ ...p, aigc: 'idle' }))}>重做</button>
                </div>
              )
              : <button className="btn primary" style={{ justifyContent: 'center', padding: '8px 12px' }}
                  disabled={st === 'generating' || !aigcReady}
                  onClick={() => runGen('AIGC 补间帧已生成')}>
                  <Icon name="sparkle" size={12} /> {st === 'generating' ? ' 生成中…' : ' 生成补间帧'}
                </button>}
          </>
        )}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        <span className="mono" style={{ color: 'var(--accent-2)', fontSize: 10.5 }}>IMPACT</span>　·　{tr.impact.note}
      </div>
    </div>
  );
};

export const ScreenDiagnose = ({ onNext, onBack }: { onNext: () => void; onBack: () => void }) => {
  const v = useProjectStore((s) => s.sourceVideo);
  const diagnosis = useProjectStore((s) => s.diagnosis);
  const appliedSlots = useProjectStore((s) => s.appliedSlots);
  const assetSupplyContext = useProjectStore((s) => s.assetSupplyContext);
  const assetManagerLoading = useProjectStore((s) => s.assetManagerLoading);
  const assetManagerWarnings = useProjectStore((s) => s.assetManagerWarnings);
  const assetManagerLastError = useProjectStore((s) => s.assetManagerLastError);
  const applyStrategy = useProjectStore((s) => s.applyStrategy);
  const T = v.duration;
  // `selected` may hold a SEGMENT id (s1..s7) OR a TRANSITION id (t1..t6).
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

  const transFilled = v.transitions.filter(t => t.state === 'filled').length;
  const transWeakly = v.transitions.filter(t => t.state === 'weakly').length;

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

          {/* transition slots — special slots, floor = 硬切 = 弱满足 */}
          <div style={{ marginTop: 12, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="eyebrow">◇ 转场槽 · Slot 之间(硬切=弱满足下限)</span>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)' }}>
              {transFilled} 已满足 · {transWeakly} 弱满足 · 0 缺失
            </span>
          </div>
          <TransitionSeams segments={v.segments} transitions={v.transitions} total={T} selected={selected} onSelect={setSelected} />

          <div className="hrule">图例 · 四态(转场槽永不触及缺失/关键缺失)</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <StateBadge state="filled"   /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.filled} 内容 · {transFilled} 转场</span>
            <StateBadge state="weakly"   /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.weakly} 内容 · {transWeakly} 转场</span>
            <StateBadge state="missing"  /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.missing} 内容 · <span style={{ color: 'var(--text-faint)' }}>转场 N/A</span></span>
            <StateBadge state="critical" /> <span className="mono dim" style={{ fontSize: 11 }}>{summary.critical} 内容 · <span style={{ color: 'var(--text-faint)' }}>转场 N/A</span></span>
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
                  {/* transition slots — a special slot group; floor = 硬切 = 弱满足 */}
                  <tr>
                    <td colSpan={4} style={{ background: 'var(--bg-2)', padding: '6px 12px' }}>
                      <span className="eyebrow">◇ 转场槽 · 硬切=弱满足下限，永不缺失</span>
                    </td>
                  </tr>
                  {v.transitions.map(tr => {
                    const degraded = tr.applied !== tr.type;
                    return (
                      <tr key={tr.id} onClick={() => setSelected(tr.id)} style={{ cursor: 'pointer', background: selected === tr.id ? 'var(--accent-dim)' : 'transparent' }}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ display: 'grid', placeItems: 'center', width: 14, height: 14 }}>
                              <TransitionGlyph type={tr.applied} color={tr.state === 'filled' ? 'var(--st-filled)' : 'var(--st-weakly)'} size={13} />
                            </span>
                            <span className="mono" style={{ fontSize: 11 }}>{tr.id}</span>
                            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{tr.from}→{tr.to}</span>
                          </span>
                        </td>
                        <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                          {tr.type}{degraded ? <span style={{ color: 'var(--st-weakly)' }}> → {tr.applied}</span> : ''}
                        </td>
                        <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>{tr.have.join(' · ')}</td>
                        <td><StateBadge state={tr.state} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        {/* RIGHT: 槽位详情 / 转场槽详情 */}
        <div className="col">

          {/* ── TRANSITION DETAIL · when a transition slot is selected ── */}
          {(() => {
            const tr = v.transitions.find(t => t.id === selected);
            if (!tr) return null;
            const color = tr.state === 'filled' ? 'var(--st-filled)' : 'var(--st-weakly)';
            const degraded = tr.applied !== tr.type;
            return (
              <div className="panel slot-detail-panel">
                <div className="panel-head">
                  <h4>
                    <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 11, marginRight: 8 }}>
                      {tr.id.toUpperCase()}
                    </span>
                    转场槽详情 · {tr.from.toUpperCase()} → {tr.to.toUpperCase()}
                  </h4>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>
                    特殊 Slot · 硬切兜底
                  </span>
                </div>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* head row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center' }}>
                    <div style={{
                      width: 46, height: 46, background: 'var(--bg-2)',
                      border: `1px solid ${color}`, borderRadius: 6,
                      display: 'grid', placeItems: 'center',
                    }}>
                      <TransitionGlyph type={tr.applied} color={color} size={22} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                        {degraded
                          ? <span>原 {tr.type} <span style={{ color: 'var(--text-mute)' }}>→</span> 现 <span style={{ color }}>{tr.applied}</span></span>
                          : <span>{tr.applied}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2 }}>
                        {tr.note}
                      </div>
                    </div>
                    <StateBadge state={tr.state} />
                  </div>

                  {/* the floor rule, stated explicitly */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 5,
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    fontSize: 11, color: 'var(--text-dim)',
                  }}>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)', letterSpacing: '0.04em' }}>FLOOR</span>
                    转场槽永不缺失 —— 硬切是免费兜底，最差也是<b style={{ color: 'var(--st-weakly)' }}> 弱满足</b>
                  </div>

                  {/* need / have */}
                  <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: '6px 12px', alignItems: 'center' }}>
                    <span className="eyebrow">需要</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {tr.need.map((n, i) => {
                        const hasIt = tr.have.some(h => h.includes(n) || n.includes(h));
                        return <span key={i} className={`need-chip ${hasIt ? 'have' : 'miss'}`}>{n}</span>;
                      })}
                    </div>
                    <span className="eyebrow">已有</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {tr.have.map((h, i) => <span key={i} className="need-chip have">{h}</span>)}
                    </div>
                  </div>

                  {/* gap reason (only when degraded / weakly) */}
                  {tr.state === 'weakly' && tr.gap_reason !== '—' && (
                    <div style={{
                      padding: '10px 12px', background: 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: 5,
                      fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-dim)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Icon name="diagnose" size={12} />
                        <span className="eyebrow" style={{ color: 'var(--st-weakly)' }}>降级原因</span>
                      </div>
                      {tr.gap_reason}
                    </div>
                  )}

                  {/* fix ladder OR satisfied note */}
                  {/* transition fill — 硬切 / 过渡帧 / AIGC 首尾帧补间 */}
                  {tr.state === 'filled' ? (
                    <div style={{
                      padding: '10px 12px', background: 'var(--st-filled-bg)',
                      border: '1px solid var(--st-filled-line)', borderRadius: 5,
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 11.5, color: 'var(--st-filled)',
                    }}>
                      <Icon name="check" size={14} />
                      富转场已成立 · {tr.impact.note}
                    </div>
                  ) : (
                    <TransitionFillStudio key={tr.id} tr={tr} segments={v.segments} diagnosis={diagnosis} onToast={showToast} />
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── SLOT DETAIL · master-detail bound to `selected` ── */}
          {(() => {
            const seg = v.segments.find(s => s.id === selected);
            if (!seg) return null;
            const d = diagnosis[selected];
            const role = ROLES[seg.role];
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

                  {/* gap-fill studio (redesigned) — 3 methods: 补拍 / HyperFrames / AIGC */}
                  {d.state !== 'filled' ? (
                    <GapFillStudio
                      key={seg.id}
                      seg={seg}
                      d={d}
                      previewActive={previewSlot === selected}
                      onPreview={() => setPreviewSlot(previewSlot === selected ? null : selected)}
                      onToast={showToast}
                      applied={!!appliedSlots[selected]}
                      onApply={() => { void applyStrategy(selected); showToast(`${seg.label} 补全策略已应用`); }}
                    />
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

      <AssetManagerEvidencePanel
        context={assetSupplyContext}
        loading={assetManagerLoading}
        warnings={assetManagerWarnings}
        error={assetManagerLastError}
        selectedSlotId={selected}
        variant="full"
      />
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
  const assetSupplyContext = useProjectStore((s) => s.assetSupplyContext);
  const assetManagerLoading = useProjectStore((s) => s.assetManagerLoading);
  const assetManagerWarnings = useProjectStore((s) => s.assetManagerWarnings);
  const assetManagerLastError = useProjectStore((s) => s.assetManagerLastError);
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

  const currentVersion = versions.find(c => c.id === selectedVersionId)!;
  const playingSegData = playingSeg ? v.segments.find(s => s.id === playingSeg) : null;

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
              <div className="eyebrow" style={{ marginBottom: 2, marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>◇ 转场层 · 特殊 Slot</span>
                <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 9.5, textTransform: 'none', letterSpacing: 0 }}>
                  富转场=已满足(绿) · 硬切=弱满足下限(琥珀) · 永不缺失
                </span>
              </div>
              <TransitionSeams segments={v.segments} transitions={v.transitions} total={T} />
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
      <AssetManagerEvidencePanel
        context={assetSupplyContext}
        loading={assetManagerLoading}
        warnings={assetManagerWarnings}
        error={assetManagerLastError}
        selectedSlotId={playingSeg}
        variant="compact"
      />
      <InsightsPanel />
      <ScreenFooter
        status="v3 已编译 · 离线点击潜力 4.7 / 完播潜力 19"
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
