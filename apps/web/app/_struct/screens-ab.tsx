'use client';

// screens-ab.tsx — Screens 1–2 (Source + Materials)
// (Ported from screens-ab.jsx; React/window globals replaced with imports.)

import { useEffect, useState } from 'react';
import type { NormalizedAssetCard } from '@viral-struct/shared';
import { ROLES, type Material, type Seg, type SourceSegment, type TargetProduct } from './data';
import { useProjectStore } from './store/useProjectStore';
import { AssetAffordanceChips, AssetManagerEvidencePanel } from './AssetManagerEvidence';
import {
  DropZone,
  EmptyState,
  Icon,
  MatThumb,
  Modal,
  RoleLegend,
  ScreenFooter,
  SvgHookShape,
  TimeRuler,
  Toast,
} from './components';
import { AbstractStructureBand, ConcreteFilmStrip, MigrationFlow, SyncRails } from './viz';
import type { FineBlockDetail } from './api/scan';

/* ─── Fine-scan deep detail for one segment ───────────────────────────── */
const FineDetailView = ({ fine }: { fine: FineBlockDetail }) => {
  const rc = fine.roleConfirmation;
  const overlays = fine.textOverlayBehavior?.textElements ?? [];
  const beats = fine.actionBeats ?? [];
  const motifs = fine.transferableMotifs ?? [];
  const assets = fine.requiredAssetType ?? [];
  const peaks = fine.peakDetectionStats;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>精扫描明细 · FINE SCAN</div>
      <dl className="kv">
        {rc?.role && (
          <><dt>确认角色</dt><dd>{rc.role}{rc.confidence != null && ` · 置信度 ${Math.round(rc.confidence * 100)}%`}{rc.correctionFromCoarse && rc.coarseRoleWas ? `（由粗扫 ${rc.coarseRoleWas} 修正）` : ''}</dd></>
        )}
        {fine.dominantTone && <><dt>主导情绪</dt><dd>{fine.dominantTone}</dd></>}
        {fine.transitionOut?.type && (
          <><dt>转场出</dt><dd>{fine.transitionOut.type}{fine.transitionOut.incomingHintForNextBlock ? ` → ${fine.transitionOut.incomingHintForNextBlock}` : ''}</dd></>
        )}
      </dl>
      {overlays.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>字幕 / 文字行为</div>
          {overlays.map((t, i) => (
            <div key={i} className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)', marginBottom: 3 }}>
              「{t.content}」 <span className="dim">· {t.type}{t.animationIn ? ` · ${t.animationIn}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {beats.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>动作节拍 · {beats.length}</div>
          {beats.map((b, i) => (
            <div key={b.beatId || i} style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.55 }}>
              <span style={{ color: 'var(--accent)' }}>▸</span> {b.semanticAction}
              {(b.beforeState || b.afterState) && (
                <div className="mono dim" style={{ fontSize: 10.5, marginLeft: 14 }}>{b.beforeState} → {b.afterState}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {motifs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>可迁移母题</div>
          {motifs.map((m, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 5, lineHeight: 1.55 }}>
              <span className="tag" style={{ fontSize: 10, marginRight: 6 }}>{m.motifType}</span>{m.description}
            </div>
          ))}
        </div>
      )}
      {assets.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>所需素材</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {assets.map((a, i) => (
              <span key={i} className="tag" style={{ fontSize: 10.5 }}>{a.assetType}{a.criticality ? ` · ${a.criticality}` : ''}</span>
            ))}
          </div>
        </div>
      )}
      {peaks && (
        <div className="mono dim" style={{ fontSize: 10.5, marginTop: 10 }}>
          视觉峰值：候选 {peaks.candidatePeakCount ?? '—'} · 采用 {peaks.selectedPeakCount ?? '—'} · 硬切 {peaks.hardCutCount ?? '—'}
        </div>
      )}
    </div>
  );
};

/* ============================================================
   屏 1 · 样例结构拆解 (Source)
   核心：上下对位 — StructureBand ↔ TimelineTrack 共享时间坐标
   ============================================================ */

export const ScreenSource = ({ onNext }: { onNext: () => void }) => {
  const v = useProjectStore((s) => s.sourceVideo);
  const analyzing = useProjectStore((s) => s.analyzing);
  const scanning = useProjectStore((s) => s.scanning);
  const scanStage = useProjectStore((s) => s.scanStage);
  const scanSample = useProjectStore((s) => s.scanSample);
  const fineScanStages = useProjectStore((s) => s.fineScanStages);
  const segmentDetails = useProjectStore((s) => s.segmentDetails);
  const fineScanSegment = useProjectStore((s) => s.fineScanSegment);
  const runDemo = useProjectStore((s) => s.runDemo);
  const loadingDemo = useProjectStore((s) => s.loadingDemo);
  const saveCurrentStructure = useProjectStore((s) => s.saveCurrentStructure);
  const T = v.duration;
  const hasStructure = v.segments.length > 0;

  const handleSaveStructure = () => {
    void saveCurrentStructure()
      .then(() => showToast('已保存到结构样例库'))
      .catch(() => showToast(useProjectStore.getState().lastError ?? '保存失败'));
  };
  const [hoveredSeg, setHoveredSeg] = useState<Seg | undefined>(v.segments[0]);
  const [selectedSegId, setSelectedSegId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  };

  const uploadModal = (
    <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="上传样例视频" width={520}>
      <DropZone
        accept="video/*"
        multiple={false}
        onFiles={(files) => {
          setUploadOpen(false);
          showToast(`样例视频已上传: ${files[0].name} · 开始粗扫描…`);
          void scanSample(files[0]).catch(() => {});
        }}
        label="拖拽视频到此处，或点击选择"
      />
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', marginTop: 12, textAlign: 'center' }}>
        上传后将自动解析结构 · 支持 MP4 / MOV / AVI
      </div>
    </Modal>
  );

  // Rough scan running → live progress (real VLM shot-by-shot analysis).
  if (scanning) {
    return (
      <>
        <EmptyState
          icon="diagnose"
          eyebrow="01 · 样例解析 / SOURCE"
          title="正在粗扫描 · Rough Scan"
          hint={scanStage || 'VLM 正在逐镜头解析视频结构，通常 30–90 秒'}
        />
        {uploadModal}
        <Toast message={toastMsg} visible={toastVisible} />
      </>
    );
  }

  // No real sample yet → no mock data; prompt the user to upload or run the real demo.
  if (v.segments.length === 0) {
    return (
      <>
        <EmptyState
          icon="upload"
          eyebrow="01 · 样例解析 / SOURCE"
          title="上传一个爆款样例视频以开始"
          hint="拖入或选择一个抖音/短视频样例 — 系统会解析其镜头·节奏·包装并抽取可迁移的结构协议 (StructureIR)。还没有素材？点「一键演示」直接载入真实后端的完整案例。"
        >
          <button className="btn primary" disabled={analyzing} onClick={() => setUploadOpen(true)}>
            <Icon name="upload" size={13} /> {analyzing ? '解析中…' : '上传样例视频'}
          </button>
          <button
            className="btn"
            disabled={loadingDemo}
            onClick={() => { void runDemo().then(() => showToast('一键演示已载入 · 真实后端全流程数据')).catch(() => {}); }}
          >
            <Icon name="sparkle" size={13} /> {loadingDemo ? '运行中…' : '一键演示'}
          </button>
        </EmptyState>
        {uploadModal}
        <Toast message={toastMsg} visible={toastVisible} />
      </>
    );
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">01 / 样例</div>
          <div>
            <h1>样例解析</h1>
            <div className="screen-head-sub">
              抖音爆款短视频 → 解析镜头·节奏·包装 → 抽取可迁移的结构协议 (StructureIR)
            </div>
          </div>
        </div>
        <div className="screen-head-r">
          <button className="btn" style={{ padding: '5px 12px', fontSize: 11.5 }}
            disabled={!hasStructure}
            title={hasStructure ? '把当前已解析的结构保存到结构样例库' : '先扫描一个视频再保存'}
            onClick={handleSaveStructure}>
            <Icon name="library" size={12} /> 保存到结构样例库
          </button>
          <button className="btn primary" style={{ padding: '5px 12px', fontSize: 11.5 }}
            disabled={loadingDemo}
            onClick={() => { void runDemo().then(() => showToast('一键演示已载入 · 真实后端全流程数据')).catch(() => {}); }}>
            <Icon name="sparkle" size={12} /> {loadingDemo ? '运行中…' : '一键演示'}
          </button>
          <span className="pill"><span className="dot" style={{ background: 'var(--accent)' }} /> {analyzing ? '解析中…' : '已解析'}</span>
          <span>{v.protocol_version}</span>
        </div>
      </div>

      {/* row 1: source video meta + stats */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <div className="panel-head">
            <h4>样例视频</h4>
            <button className="btn" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={() => setUploadOpen(true)}>
              <Icon name="upload" size={11} /> 上传样例
            </button>
          </div>
          <div className="panel-body" style={{ display: 'flex', gap: 14 }}>
            <div style={{
              width: 88, aspectRatio: '9/16', flexShrink: 0,
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 4, position: 'relative', overflow: 'hidden',
              display: 'grid', placeItems: 'center',
            }}>
              <SvgHookShape />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.6))' }} />
              <div style={{ position: 'absolute', bottom: 6, left: 6, right: 6, fontSize: 9, color: '#fff', fontFamily: 'var(--ff-mono)' }}>
                {v.duration}s · 9:16
              </div>
              <Icon name="play" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{v.title}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', marginBottom: 10 }}>
                {v.platform || '—'} · {v.id}
              </div>
              <dl className="kv">
                <dt>时长</dt><dd><b>{v.duration}s</b> · {v.segments.length} 段落</dd>
                <dt>播放</dt><dd><b>{v.views || '—'}</b> 播放</dd>
                <dt>平均镜头</dt><dd><b>{v.rhythm.avg_shot}s</b></dd>
                <dt>BGM</dt><dd>{v.rhythm.bgm_bpm ? `${v.rhythm.bgm_bpm} BPM` : '节拍未检测'}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <div className="panel-head">
            <h4>整体特征</h4>
            <span className="eyebrow">结构 · 包装</span>
          </div>
          <div className="panel-body">
            <dl className="kv">
              <dt>段落数</dt><dd><b>{v.segments.length}</b> <span className="dim">· 角色 {new Set(v.segments.map(s => s.role)).size} 类</span></dd>
              <dt>平均镜头</dt><dd><b>{v.rhythm.avg_shot}s</b> <span className="dim">· {v.rhythm.cuts} 个剪切点</span></dd>
              <dt>字幕风格</dt><dd>{v.packaging.captions}</dd>
              <dt>BGM</dt><dd>{v.packaging.bgm}</dd>
              <dt>封面</dt><dd>{v.packaging.cover}</dd>
              <dt>标题模板</dt><dd className="mono" style={{ fontSize: 11 }}>{v.packaging.title_template}</dd>
            </dl>
          </div>
        </div>
      </div>

      {/* row 2: THE up-down alignment — StructureBand on top, TimelineTrack below, sharing time */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <h4>上下对位 · 抽象结构 ↔ 真实时间线</h4>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            sequence = <span style={{ color: 'var(--accent)' }}>[{v.segments.map(s => s.role.toUpperCase()).join(' → ')}]</span>
            <span style={{ marginLeft: 10, color: 'var(--text-faint)' }}>· {v.protocol_version}</span>
          </span>
        </div>
        <div className="panel-body">
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--ff-mono)', fontSize: 10,
                padding: '2px 7px', background: 'var(--accent)', color: 'var(--bg)',
                fontWeight: 700, letterSpacing: 0.06, borderRadius: 3,
              }}>▲ 抽象层</span>
              <span className="eyebrow">抽象结构带 · 角色 × 时长</span>
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>
              共享时间轴 0 ~ {v.duration}s
            </span>
          </div>
          <AbstractStructureBand segments={v.segments} total={T} onSegHover={setHoveredSeg} onSegClick={(seg) => setSelectedSegId(seg.id ?? null)} selectedId={selectedSegId ?? undefined} scannedIds={new Set(Object.keys(segmentDetails))} scanningIds={new Set(Object.keys(fineScanStages))} />

          {/* prominent dashed sync rails connecting the two layers */}
          <SyncRails segments={v.segments} total={T} height={32} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontFamily: 'var(--ff-mono)', fontSize: 10,
              padding: '2px 7px', background: 'var(--surface-3)', color: 'var(--text-mute)',
              border: '1px dashed var(--border-2)',
              fontWeight: 500, letterSpacing: 0.06, borderRadius: 3,
            }}>▼ 镜头层</span>
            <span className="eyebrow">真实镜头时间线 · 灰阶</span>
          </div>
          <ConcreteFilmStrip segments={v.segments} total={T} />
          <TimeRuler duration={T} intervals={7} />

          {/* per-segment caption row, time-aligned */}
          <div style={{ display: 'flex', marginTop: 8, gap: 0 }}>
            {v.segments.map((seg) => {
              const dur = seg.end - seg.start;
              const w = (dur / T) * 100;
              return (
                <div key={seg.id} style={{
                  width: `${w}%`,
                  padding: '0 6px',
                  fontSize: 10.5,
                  color: 'var(--text-dim)',
                  borderRight: '1px solid var(--border)',
                  fontFamily: 'var(--ff-sans)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontStyle: 'italic',
                }} title={seg.caption}>
                  &quot;{seg.caption}&quot;
                </div>
              );
            })}
          </div>

          <div className="hrule">LEGEND · 角色色彩编码</div>
          <RoleLegend roles={['hook', 'pain', 'emotion', 'product', 'compare', 'social', 'cta']} />
        </div>
      </div>

      {/* row 3: per-segment detail — click a segment in the timeline above */}
      {(() => {
        const seg = (selectedSegId ? v.segments.find((s) => s.id === selectedSegId) : undefined)
          ?? (hoveredSeg ? v.segments.find((s) => s.id === hoveredSeg.id) : undefined)
          ?? v.segments[0];
        const idx = v.segments.indexOf(seg);
        const dur = (seg.end ?? 0) - (seg.start ?? 0);
        const fine = seg.id ? segmentDetails[seg.id] : undefined;
        const stageLabel = seg.id ? fineScanStages[seg.id] : undefined;
        const isFineScanning = stageLabel !== undefined;
        return (
          <div className="panel">
            <div className="panel-head">
              <h4>段落明细 · {String(idx + 1).padStart(2, '0')} {ROLES[seg.role]?.name ?? seg.label}</h4>
              <span className="mono dim" style={{ fontSize: 10.5 }}>
                {Object.keys(segmentDetails).length > 0
                  ? `已精扫描 ${Object.keys(segmentDetails).length}/${v.segments.length} 段 · 结果均保留，点上方任一段查看`
                  : '点击上方时间轴的任一段落查看明细'}
              </span>
            </div>
            <div className="panel-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <span className="tag" style={{ color: `var(--r-${seg.role})`, borderColor: `var(--r-${seg.role})55` }}>
                  <span className={`role-dot role-${seg.role}`} /> {ROLES[seg.role]?.name ?? seg.role}
                </span>
                <span className="mono dim" style={{ fontSize: 11 }}>{seg.start?.toFixed(1)} → {seg.end?.toFixed(1)}s · {dur.toFixed(1)}s</span>
                <span className="mono dim" style={{ fontSize: 11 }}>{seg.id}</span>
              </div>
              <dl className="kv">
                <dt>角色定位</dt><dd>{ROLES[seg.role]?.name ?? seg.role} <span className="dim">— {ROLES[seg.role]?.desc ?? ''}</span></dd>
                <dt>镜头内容</dt><dd style={{ lineHeight: 1.65 }}>{seg.shot || seg.caption || '—'}</dd>
                <dt>迁移规则</dt><dd style={{ lineHeight: 1.65 }}>{seg.transferRule || '—'}</dd>
              </dl>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    className="btn primary"
                    disabled={isFineScanning}
                    onClick={() => { if (seg.id) void fineScanSegment(idx, seg.id).catch(() => {}); }}
                  >
                    <Icon name="sparkle" size={12} /> {isFineScanning ? (stageLabel || '精扫描中…') : fine ? '重新精扫描此段' : '深度分析 · 精扫描此段'}
                  </button>
                  {!fine && !isFineScanning && (
                    <span className="mono dim" style={{ fontSize: 10.5 }}>视觉峰值 + 逐峰 VLM · 字幕行为 / 动作节拍 / 转场 / 可迁移母题（约 30–60 秒）</span>
                  )}
                </div>
                {fine && <FineDetailView fine={fine} />}
              </div>
            </div>
          </div>
        );
      })()}
      <ScreenFooter
        status={`样例已解析 · ${v.segments.length} 段角色 + 节奏 + 包装`}
        statusTone="ok"
        primary={{ label: '进入素材输入', onClick: onNext }}
      />

      {uploadModal}

      <Toast message={toastMsg} visible={toastVisible} />
    </div>
  );
};


/* ============================================================
   屏 2 · 新商品 + 素材输入与适配
   ============================================================ */

/** Format a clip time range like "3.0–7.5s" from start/end seconds. */
const fmtClipRange = (start?: number, end?: number): string | null => {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  return `${start.toFixed(1)}–${end.toFixed(1)}s`;
};

/** Kind label for the meta line. */
const kindLabel = (kind: Material['kind']): string =>
  kind === 'photo' ? '图像' : kind === 'video' ? '视频片段' : '文本';

interface ClipCardProps {
  clip: Material;
  segments: SourceSegment[];
  isProductAnchor: boolean;
  onAssign: (slot: string | null) => void;
  onSetProductImage?: () => void;
  affordanceAsset?: NormalizedAssetCard;
}

/** One clip sub-card inside an asset's clip strip. Carries its own slot control. */
const ClipCard = ({ clip, segments, isProductAnchor, onAssign, onSetProductImage, affordanceAsset }: ClipCardProps) => {
  const targetSeg = clip.slot ? segments.find((s) => s.id === clip.slot) : null;
  const range = fmtClipRange(clip.startSec, clip.endSec);
  const dur = typeof clip.durationSec === 'number' ? `${clip.durationSec.toFixed(1)}s` : null;
  const hints = (clip.roleHints ?? []).slice(0, 3);
  const canBeProduct = clip.kind === 'photo' && typeof clip.url === 'string' && clip.url.length > 0;
  return (
    <div
      className="mat-card"
      style={{
        minWidth: 150,
        flex: '0 0 150px',
        outline: isProductAnchor ? '1.5px solid var(--accent)' : 'none',
        outlineOffset: -1,
      }}
    >
      <MatThumb mat={clip} />
      <div className="mat-body">
        <div className="mat-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {clip.label || clip.subject}
        </div>
        <div className="mat-sub">
          {clip.id.toUpperCase()} · {kindLabel(clip.kind)} · q={clip.quality.toFixed(1)}
        </div>
        {(range || dur) && (
          <div className="mono dim" style={{ fontSize: 10 }}>
            {[range && `⏱ ${range}`, dur && `时长 ${dur}`].filter(Boolean).join(' · ')}
          </div>
        )}
        {hints.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            {hints.map((h) => (
              <span key={h} className="tag" style={{ padding: '1px 5px', fontSize: 9.5 }}>
                {ROLES[h]?.name ?? h}
              </span>
            ))}
          </div>
        )}
        <label className="row gap-6 mt-8" style={{ minHeight: 22 }}>
          {targetSeg ? (
            <span className={`role-dot role-${targetSeg.role}`} />
          ) : (
            <span className="role-dot" style={{ background: 'var(--text-faint)' }} />
          )}
          <select
            className="mono"
            value={clip.slot ?? ''}
            onChange={(e) => onAssign(e.target.value || null)}
            style={{
              flex: 1, minWidth: 0, fontSize: 10, padding: '2px 4px',
              background: 'var(--surface-3)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 3,
            }}
          >
            <option value="">未分配</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.toUpperCase()} · {ROLES[s.role]?.name ?? s.role}
              </option>
            ))}
          </select>
        </label>
        {canBeProduct && (
          <button
            className={isProductAnchor ? 'btn primary' : 'btn ghost'}
            style={{ padding: '2px 6px', fontSize: 9.5, justifyContent: 'center', marginTop: 2 }}
            onClick={onSetProductImage}
            title="将此图设为 AIGC 生成的产品主图锚点"
          >
            {isProductAnchor ? '★ 产品主图' : '设为产品主图'}
          </button>
        )}
        <AssetAffordanceChips asset={affordanceAsset} />
      </div>
    </div>
  );
};

interface AssetGroupTileProps {
  parentKey: string;
  clips: Material[];
  segments: SourceSegment[];
  productImageUrl: string | null;
  onAssign: (clipId: string, slot: string | null) => void;
  onSetProductImage: (clip: Material) => void;
  findAffordance: (id: string) => NormalizedAssetCard | undefined;
}

/** One parent asset tile: header + horizontal clip strip (1+ clips). */
const AssetGroupTile = ({
  parentKey,
  clips,
  segments,
  productImageUrl,
  onAssign,
  onSetProductImage,
  findAffordance,
}: AssetGroupTileProps) => {
  const isMultiClip = clips.length > 1;
  const head = clips[0];
  const assigned = clips.filter((c) => c.slot).length;
  const totalDur = clips.reduce((acc, c) => acc + (typeof c.durationSec === 'number' ? c.durationSec : 0), 0);
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface)',
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isMultiClip ? (head.subject || '上传素材') : (head.label || head.subject)}
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>
            {parentKey.toUpperCase()} · {isMultiClip ? `${clips.length} 个片段` : kindLabel(head.kind)}
            {totalDur > 0 ? ` · 总时长 ${totalDur.toFixed(1)}s` : ''}
          </div>
        </div>
        <span className="tag mono" style={{ padding: '1px 6px', fontSize: 10, flexShrink: 0 }}>
          {assigned}/{clips.length} 已分配
        </span>
      </div>
      <div
        style={{
          display: 'flex', gap: 10,
          overflowX: isMultiClip ? 'auto' : 'visible',
          paddingBottom: isMultiClip ? 4 : 0,
        }}
      >
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            segments={segments}
            isProductAnchor={!!productImageUrl && clip.url === productImageUrl}
            onAssign={(slot) => onAssign(clip.id, slot)}
            onSetProductImage={() => onSetProductImage(clip)}
            affordanceAsset={findAffordance(clip.id)}
          />
        ))}
      </div>
    </div>
  );
};

export const ScreenMaterials = ({ onNext, onBack }: { onNext: () => void; onBack: () => void }) => {
  const v = useProjectStore((s) => s.sourceVideo);
  const materials = useProjectStore((s) => s.materials);
  const product = useProjectStore((s) => s.product);
  const matching = useProjectStore((s) => s.matching);
  const assetSupplyContext = useProjectStore((s) => s.assetSupplyContext);
  const assetManagerLoading = useProjectStore((s) => s.assetManagerLoading);
  const assetManagerWarnings = useProjectStore((s) => s.assetManagerWarnings);
  const assetManagerLastError = useProjectStore((s) => s.assetManagerLastError);
  const addMaterials = useProjectStore((s) => s.addMaterials);
  const loadLibrary = useProjectStore((s) => s.loadLibrary);
  const uploading = useProjectStore((s) => s.uploading);
  const applyAssignments = useProjectStore((s) => s.applyAssignments);
  const setSlot = useProjectStore((s) => s.setSlot);
  const productImageUrl = useProjectStore((s) => s.productImageUrl);
  const setProductImageUrl = useProjectStore((s) => s.setProductImageUrl);
  const updateProduct = useProjectStore((s) => s.updateProduct);
  const runDiagnosis = useProjectStore((s) => s.runDiagnosis);
  const refreshAssetManagerCoverage = useProjectStore((s) => s.refreshAssetManagerCoverage);
  const T = v.duration;

  // Interactive states
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [productInfo, setProductInfo] = useState<TargetProduct>({ ...product });
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  };

  const handleFiles = (files: File[]) => {
    const names = files.map(f => f.name).join(', ');
    setUploadedFiles(prev => [...prev, ...files.map(f => f.name)]);
    setUploadOpen(false);
    void addMaterials(files).catch(() => {});
    showToast(`已上传 ${files.length} 个文件: ${names}`);
  };

  const handleProductSave = () => {
    updateProduct(productInfo);
    setEditOpen(false);
    showToast('商品信息已更新');
  };

  const openBatch = () => {
    setAssignDraft(Object.fromEntries(materials.map(m => [m.id, m.slot ?? ''])));
    setBatchOpen(true);
  };

  const handleBatchConfirm = () => {
    const assignments: Record<string, string | null> = {};
    for (const [id, slot] of Object.entries(assignDraft)) assignments[id] = slot || null;
    void applyAssignments(assignments).then(() => showToast('槽位分配已更新')).catch(() => {});
    setBatchOpen(false);
  };

  const handleNext = () => {
    void runDiagnosis().catch(() => {});
    onNext();
  };

  // Assign a single clip to a structure slot. setSlot keeps the UI snappy; the
  // single-entry applyAssignments persists + refreshes coverage/affordance, matching
  // the batch flow so each clip can be slotted individually.
  const handleClipAssign = (clipId: string, slot: string | null) => {
    setSlot(clipId, slot);
    void applyAssignments({ [clipId]: slot }).catch(() => {});
  };

  // Designate one uploaded IMAGE clip as the AIGC product hero (产品主图) anchor.
  const handleSetProductImage = (clip: Material) => {
    if (typeof clip.url !== 'string' || clip.url.length === 0) return;
    setProductImageUrl(clip.url);
    showToast('已设为产品主图 · 将锚定 AIGC 生成');
  };

  // GROUP materials by parent asset (parentAssetId ?? id). Each group = one uploaded
  // asset; multi-clip groups (a long video sliced into clips) render a clip strip.
  const assetGroups = (() => {
    const order: string[] = [];
    const byParent = new Map<string, Material[]>();
    for (const m of materials) {
      const key = m.parentAssetId ?? m.id;
      const bucket = byParent.get(key);
      if (bucket) {
        bucket.push(m);
      } else {
        byParent.set(key, [m]);
        order.push(key);
      }
    }
    // Keep clips inside a group ordered by their segment index when present.
    for (const key of order) {
      const clips = byParent.get(key)!;
      if (clips.length > 1) {
        clips.sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
      }
    }
    return order.map((key) => ({ key, clips: byParent.get(key)! }));
  })();

  const findAffordance = (id: string): NormalizedAssetCard | undefined =>
    assetSupplyContext?.assets.find((asset) => asset.id === id);

  // The current product-anchor image material (if any), for the header summary.
  const productAnchorMaterial = productImageUrl
    ? materials.find((m) => m.url === productImageUrl) ?? null
    : null;

  // Footer status — derived from real materials + structure slots (no hardcoded numbers).
  const totalSlots = v.segments.length;
  const assignedSlots = v.segments.filter((s) => materials.some((m) => m.slot === s.id)).length;
  const footerStatus = `${materials.length} 项素材 · ${assignedSlots}/${totalSlots} 槽位已分配`;
  const footerTone: 'ok' | 'warn' =
    totalSlots > 0 && assignedSlots >= totalSlots ? 'ok' : 'warn';

  useEffect(() => {
    void refreshAssetManagerCoverage();
  }, [refreshAssetManagerCoverage]);

  const editFields: { key: 'name' | 'price' | 'category' | 'industry'; label: string }[] = [
    { key: 'name', label: '商品名称' },
    { key: 'price', label: '售价' },
    { key: 'category', label: '品类' },
    { key: 'industry', label: '定位' },
  ];

  // No source structure yet → materials can't be matched; send the user back to 01.
  if (v.segments.length === 0) {
    return (
      <EmptyState
        icon="film"
        eyebrow="02 · 素材输入 / ASSETS"
        title="先解析一个样例视频"
        hint="素材适配需要先有可迁移的结构。请回到「样例解析」上传样例或运行一键演示，再回来输入新商品与素材。"
      >
        <button className="btn primary" onClick={onBack}>← 返回样例解析</button>
      </EmptyState>
    );
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">02 / 素材</div>
          <div>
            <h1>新商品 · 素材输入与适配</h1>
            <div className="screen-head-sub">
              上传商品 + 素材 → 自动分类 · 主体识别 · 槽位推荐
            </div>
          </div>
        </div>
        <div className="screen-head-r">
          <button className="btn" style={{ padding: '5px 12px', fontSize: 11.5 }}
            disabled={uploading}
            onClick={() => { void loadLibrary('kangshifu_demo').then(() => showToast('已加载示例素材库 · 康师傅 demo')).catch(() => {}); }}>
            <Icon name="upload" size={11} /> {uploading ? '加载中…' : '加载示例素材库'}
          </button>
          <span className="mono">{materials.length} 个素材</span>
          <span className="pill"><span className="dot" style={{ background: 'var(--accent)' }} /> 已适配</span>
        </div>
      </div>

      {/* TOP combined block — 新商品 + 素材入库 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h4>新商品 · 素材入库</h4>
          <span className="eyebrow">商品 · {materials.length} 个素材</span>
        </div>
        <div className="panel-body" style={{
          display: 'grid',
          gridTemplateColumns: '260px 1px 1fr',
          gap: 20,
        }}>
          {/* LEFT: product card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              width: '100%', aspectRatio: '1 / 1', borderRadius: 6,
              background: 'linear-gradient(135deg, #3d4a3a, #2a342a)',
              border: '1px solid var(--border)',
              display: 'grid', placeItems: 'center',
              position: 'relative', overflow: 'hidden',
            }}>
              <svg viewBox="0 0 60 50" style={{ width: '55%', height: 'auto', opacity: 0.55 }}>
                <ellipse cx="30" cy="25" rx="20" ry="10" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.4" />
                <ellipse cx="30" cy="25" rx="12" ry="6"  fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
              </svg>
              <span className="mono" style={{
                position: 'absolute', top: 8, left: 8,
                fontSize: 9.5, padding: '1px 6px', borderRadius: 3,
                background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.85)',
                letterSpacing: '0.04em',
              }}>新品</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{product.name}</div>
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4, letterSpacing: '0.02em' }}>
                {product.category}
              </div>
            </div>
            <dl className="kv" style={{ gridTemplateColumns: '60px 1fr' }}>
              <dt>售价</dt><dd><b>{product.price}</b></dd>
              <dt>库存</dt><dd>{product.stock.toLocaleString()}</dd>
              <dt>定位</dt><dd>{product.industry}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = (ev) => { const t = ev.target as HTMLInputElement; if (t.files && t.files.length) showToast('商品图已替换: ' + t.files[0].name); }; input.click(); }}>
                <Icon name="upload" size={12} /> 替换图
              </button>
              <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setProductInfo({ ...product }); setEditOpen(true); }}>编辑</button>
            </div>
          </div>

          {/* divider */}
          <div style={{ background: 'var(--border)' }} />

          {/* RIGHT: materials grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div>
                <span className="eyebrow" style={{ marginRight: 8 }}>素材入库</span>
                <span className="mono dim" style={{ fontSize: 10.5 }}>auto-classified · 已识别主体并推荐槽位</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={() => setUploadOpen(true)}>
                  <Icon name="upload" size={11} /> 上传
                </button>
                <button className="btn ghost" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={openBatch}>批量分配</button>
              </div>
            </div>

            {/* Product hero (产品主图) anchor banner — drives AIGC generation */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 6,
              border: `1px solid ${productAnchorMaterial ? 'var(--accent)' : 'var(--border)'}`,
              background: 'var(--surface)',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 4, flexShrink: 0,
                background: productAnchorMaterial?.url
                  ? `center / cover no-repeat url("${productAnchorMaterial.url}")`
                  : 'var(--surface-3)',
                border: '1px solid var(--border)',
                display: 'grid', placeItems: 'center',
              }}>
                {!productAnchorMaterial?.url && <Icon name="sparkle" size={14} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>
                  产品主图 · AIGC 锚点
                </div>
                <div className="mono dim" style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {productAnchorMaterial
                    ? `已锚定 ${productAnchorMaterial.id.toUpperCase()} · ${productAnchorMaterial.subject} — 将用于锚定 AIGC 生成`
                    : '在下方图片素材上点「设为产品主图」，AIGC 生成将以它为锚'}
                </div>
              </div>
              {productAnchorMaterial && (
                <button
                  className="btn ghost"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                  onClick={() => { setProductImageUrl(null); showToast('已清除产品主图锚点'); }}
                >
                  清除
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {assetGroups.map(({ key, clips }) => (
                <AssetGroupTile
                  key={key}
                  parentKey={key}
                  clips={clips}
                  segments={v.segments}
                  productImageUrl={productImageUrl}
                  onAssign={handleClipAssign}
                  onSetProductImage={handleSetProductImage}
                  findAffordance={findAffordance}
                />
              ))}
              <button className="mat-card" onClick={() => setUploadOpen(true)} style={{
                border: '1px dashed var(--border-2)',
                background: 'transparent',
                display: 'flex', flexDirection: 'row',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-mute)',
                fontSize: 11,
                gap: 8,
                aspectRatio: 'auto',
                minHeight: 56,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
                <Icon name="plus" size={18} />
                <span>添加素材</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>JPG · PNG · MP4 · TXT</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* THE MIGRATION VIEW — materials pouring into source structure slots */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h4>结构迁移 · 素材灌入源结构</h4>
          <span className="eyebrow">迁移流向 · 素材 → 槽位</span>
        </div>
        <div className="panel-body" style={{ paddingTop: 32 }}>
          <MigrationFlow />
          <div style={{
            marginTop: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 11.5, color: 'var(--text-dim)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="dot" style={{ background: 'var(--accent)' }} /> 流入连线
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="dot" style={{ background: 'var(--st-critical)' }} /> 关键缺口(无来料)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 14, height: 6, background: 'var(--st-filled)', opacity: 0.5, borderRadius: 1 }} /> 槽位 fill 等级
              </span>
            </div>
            <span className="mono dim" style={{ fontSize: 10.5 }}>
              线宽 ∝ 素材质量 · 颜色 = 目标槽位角色
            </span>
          </div>
        </div>
      </div>

      {/* coverage stats — full width below */}
      <div className="panel">
        <div className="panel-head">
          <h4>覆盖率</h4>
          <span className="eyebrow">预览统计</span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div className="stat" style={{ background: 'var(--surface)' }}>
              <div className="stat-label">已覆盖槽位</div>
              <div className="stat-value">{v.segments.filter(s => materials.some(m => m.slot === s.id)).length}<small>/ {v.segments.length}</small></div>
            </div>
            <div className="stat" style={{ background: 'var(--surface)' }}>
              <div className="stat-label">素材利用率</div>
              <div className="stat-value">{materials.length ? Math.round(materials.filter(m => m.slot).length / materials.length * 100) : 0}<small>%</small></div>
            </div>
            <div className="stat" style={{ background: 'var(--surface)' }}>
              <div className="stat-label">下一步</div>
              <div className="stat-value" style={{ fontSize: 14, color: 'var(--accent)' }}>诊断 →</div>
            </div>
          </div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>逐槽位匹配概览</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 24px' }}>
            {v.segments.map(s => {
              const matched = materials.filter(m => m.slot === s.id);
              return (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11.5,
                }}>
                  <span className={`role-dot role-${s.role}`} />
                  <span style={{ width: 64, color: 'var(--text)' }}>{s.label}</span>
                  <span className="mono dim" style={{ width: 34, fontSize: 10.5 }}>{s.id}</span>
                  <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {matched.length > 0 ? matched.map(m => (
                      <span key={m.id} className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                        {m.id.toUpperCase()}
                      </span>
                    )) : <span className="mono" style={{ color: 'var(--st-missing)', fontSize: 10.5 }}>— 无来料 —</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AssetManagerEvidencePanel
        context={assetSupplyContext}
        loading={assetManagerLoading}
        warnings={assetManagerWarnings}
        error={assetManagerLastError}
        variant="full"
      />
      <ScreenFooter
        status={footerStatus}
        statusTone={footerTone}
        secondary={[{ label: '返回结构', onClick: onBack }]}
        primary={{ label: matching ? '匹配中…' : '识别并诊断缺口', onClick: handleNext }}
      />

      {/* ── Upload Modal ── */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="上传素材" width={520}>
        <DropZone
          accept="image/*,video/mp4,.txt"
          onFiles={handleFiles}
          label="拖拽文件到此处，或点击选择"
          multiple={true}
        />
        {uploadedFiles.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>已上传文件</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {uploadedFiles.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', background: 'var(--bg-2)',
                  border: '1px solid var(--border)', borderRadius: 4, fontSize: 12,
                }}>
                  <Icon name="check" size={12} />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit Product Modal ── */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="编辑商品信息" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {editFields.map(field => (
            <div key={field.key}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>{field.label}</div>
              <input
                type="text"
                value={productInfo[field.key] || ''}
                onChange={e => setProductInfo(prev => ({ ...prev, [field.key]: e.target.value }))}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'var(--bg-2)', border: '1px solid var(--border)',
                  borderRadius: 5, color: 'var(--text)', fontSize: 13,
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>
          ))}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>库存</div>
            <input
              type="number"
              value={productInfo.stock || 0}
              onChange={e => setProductInfo(prev => ({ ...prev, stock: parseInt(e.target.value) || 0 }))}
              style={{
                width: '100%', padding: '8px 12px',
                background: 'var(--bg-2)', border: '1px solid var(--border)',
                borderRadius: 5, color: 'var(--text)', fontSize: 13,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>产品描述 · 一段话(系统自动解析卖点/人群/场景/CTA)</div>
            <textarea
              value={productInfo.description || ''}
              onChange={e => setProductInfo(prev => ({ ...prev, description: e.target.value }))}
              rows={7}
              placeholder={'用一段话介绍产品：①是什么(名字+品类) ②卖给谁 ③什么场景/时候用 ④最想突出的 3–5 个卖点 ⑤希望观众看完做什么 ⑥(可选)风格偏好。少写绝对化用语(最/第一)、医疗功效和未证实数字。'}
              style={{
                width: '100%', padding: '8px 12px',
                background: 'var(--bg-2)', border: '1px solid var(--border)',
                borderRadius: 5, color: 'var(--text)', fontSize: 13,
                fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.6,
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.5 }}>
              这段描述会驱动下游补拍/HyperFrames/AIGC 的 prompt 生成 —— 越具体，建议越精准、越不雷同。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn" onClick={() => setEditOpen(false)}>取消</button>
            <button className="btn primary" onClick={handleProductSave}>保存</button>
          </div>
        </div>
      </Modal>

      {/* ── Batch Assign Modal ── */}
      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title="批量分配槽位" width={560}>
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-dim)' }}>
          为每个素材分配目标槽位。选择后点击「确认分配」。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {materials.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 12px', background: 'var(--bg-2)',
              border: '1px solid var(--border)', borderRadius: 5,
            }}>
              <span className="mono" style={{ fontSize: 11, width: 36, color: 'var(--text-mute)' }}>{m.id.toUpperCase()}</span>
              <span style={{ flex: 1, fontSize: 12 }}>{m.subject}</span>
              <select
                value={assignDraft[m.id] ?? ''}
                onChange={(e) => setAssignDraft(prev => ({ ...prev, [m.id]: e.target.value }))}
                style={{
                  padding: '4px 8px', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  color: 'var(--text)', fontSize: 11, fontFamily: 'var(--ff-mono)',
                }}
              >
                <option value="">未分配</option>
                {v.segments.map(s => (
                  <option key={s.id} value={s.id}>{s.id.toUpperCase()} · {s.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={() => setBatchOpen(false)}>取消</button>
          <button className="btn primary" onClick={handleBatchConfirm}>确认分配</button>
        </div>
      </Modal>

      <Toast message={toastMsg} visible={toastVisible} />
    </div>
  );
};
