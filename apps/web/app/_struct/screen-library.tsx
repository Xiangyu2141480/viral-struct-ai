'use client';

// screen-library.tsx — 结构样例库 (merged Structure + Example library)
// (Ported from screen-library.jsx; React/window globals replaced with imports.)

import { createElement, useEffect, useState, type CSSProperties, type FC } from 'react';
import { LIBRARY_VIDEOS, ROLES, type LibSegment, type LibraryVideo } from './data';
import { useProjectStore } from './store/useProjectStore';
import {
  Icon,
  RoleLegend,
  ScreenFooter,
  SvgCompareShape,
  SvgCtaShape,
  SvgEmotionShape,
  SvgHookShape,
  SvgPainShape,
  SvgProductShape,
  SvgSocialShape,
  Toast,
} from './components';
import { SyncRails } from './viz';

type RailSegment = LibSegment & { start: number; end: number; id: string };

interface ScreenLibraryProps {
  onBack?: () => void;
  /** Called after a saved structure is loaded into the store, so the shell can
   *  navigate back to the migration flow (01 样例) with the loaded structure. */
  onOpenStructure?: () => void;
}

export const ScreenLibrary = ({ onBack, onOpenStructure }: ScreenLibraryProps) => {
  const [selectedVideo, setSelectedVideo] = useState<LibraryVideo | null>(null);
  const [filterFamily, setFilterFamily] = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // ── 我的结构库 · real saved structures (backed by /api/struct/structures) ──
  const savedStructures = useProjectStore((s) => s.savedStructures);
  const loadSavedStructures = useProjectStore((s) => s.loadSavedStructures);
  const openSavedStructure = useProjectStore((s) => s.openSavedStructure);
  const deleteSavedStructure = useProjectStore((s) => s.deleteSavedStructure);

  useEffect(() => {
    void loadSavedStructures();
  }, [loadSavedStructures]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  };

  const handleOpenStructure = (id: string) => {
    void openSavedStructure(id)
      .then(() => {
        showToast('已载入结构 · 进入迁移流程');
        onOpenStructure?.();
      })
      .catch(() => showToast(useProjectStore.getState().lastError ?? '载入失败'));
  };

  const handleDeleteStructure = (id: string) => {
    void deleteSavedStructure(id)
      .then(() => showToast('已删除'))
      .catch(() => showToast(useProjectStore.getState().lastError ?? '删除失败'));
  };

  const fmtSavedAt = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  const families = [...new Set(LIBRARY_VIDEOS.map(v => v.family))];
  const platforms = [...new Set(LIBRARY_VIDEOS.map(v => v.platform))];

  const filtered = LIBRARY_VIDEOS.filter(v => {
    if (filterFamily !== 'all' && v.family !== filterFamily) return false;
    if (filterPlatform !== 'all' && v.platform !== filterPlatform) return false;
    if (searchText && !v.title.includes(searchText) && !v.tags.some(t => t.includes(searchText))) return false;
    return true;
  });

  const SVG_BY_ROLE: Record<string, FC> = {
    hook: SvgHookShape, pain: SvgPainShape, emotion: SvgEmotionShape,
    product: SvgProductShape, compare: SvgCompareShape, social: SvgSocialShape, cta: SvgCtaShape,
  };

  // Detail view for selected video
  if (selectedVideo) {
    const v = selectedVideo;
    const T = v.segments.reduce((a, s) => a + s.dur, 0);
    return (
      <div className="screen">
        <div className="screen-head">
          <div className="screen-head-l">
            <button className="btn" style={{ padding: '6px 10px', flexShrink: 0 }}
              onClick={() => setSelectedVideo(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
              返回列表
            </button>
            <div>
              <h1 style={{ fontSize: 20 }}>{v.title}</h1>
              <div className="screen-head-sub">
                {v.platform} · {v.category} · {v.family}
              </div>
            </div>
          </div>
          <div className="screen-head-r">
            <span className="pill" style={{ color: v.color, borderColor: v.color + '55' }}>
              <span className="dot" style={{ background: v.color }} />
              {v.family}
            </span>
            <button className="btn primary" style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={() => showToast('已选用此结构作为迁移源')}>
              <Icon name="bolt" size={12} /> 选用此结构
            </button>
          </div>
        </div>

        {/* Honesty banner — reference case, not live measurement */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', marginBottom: 14,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-line)',
          borderRadius: 8, color: 'var(--text-dim)', fontSize: 11.5,
        }}>
          <Icon name="diagnose" size={13} />
          <span>
            <b style={{ color: 'var(--accent)' }}>示例库 · 参考案例（非实时数据）</b>
            <span style={{ marginLeft: 8 }}>以下播放 / 点赞 / 点击 / 完播为参考示例，非实时测量。</span>
          </span>
        </div>

        {/* Top: meta + stats */}
        <div className="grid-2" style={{ marginBottom: 16, gridTemplateColumns: '1fr 1fr' }}>
          <div className="panel">
            <div className="panel-head">
              <h4>样例信息</h4>
              <span className="eyebrow">{v.platform}</span>
            </div>
            <div className="panel-body" style={{ display: 'flex', gap: 16 }}>
              {/* Fake video thumbnail */}
              <div style={{
                width: 96, aspectRatio: '9/16', flexShrink: 0,
                background: `linear-gradient(135deg, ${v.color}33, ${v.color}11)`,
                border: '1px solid var(--border)', borderRadius: 6,
                position: 'relative', overflow: 'hidden',
                display: 'grid', placeItems: 'center',
              }}>
                <div style={{ position: 'absolute', inset: 0, opacity: 0.4 }}>
                  {createElement(SVG_BY_ROLE[v.segments[0].role] || SvgHookShape)}
                </div>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  border: `1.5px solid ${v.color}`,
                  display: 'grid', placeItems: 'center', color: v.color,
                  position: 'relative', zIndex: 1,
                }}><Icon name="play" size={14} /></div>
                <div style={{
                  position: 'absolute', bottom: 6, left: 6, right: 6,
                  fontSize: 9, color: '#fff', fontFamily: 'var(--ff-mono)',
                }}>{v.duration}s · 9:16</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{v.title}</div>
                <dl className="kv" style={{ gridTemplateColumns: '80px 1fr' }}>
                  <dt>时长</dt><dd><b>{v.duration}s</b> · {v.segments.length} 段落</dd>
                  <dt>播放</dt><dd><b>{v.views}</b></dd>
                  <dt>点赞</dt><dd><b>{v.likes}</b></dd>
                  <dt>离线点击潜力</dt><dd><b>{v.ctr}</b></dd>
                  <dt>完播率</dt><dd><b>{v.finish_rate}</b></dd>
                  <dt>BGM</dt><dd>{v.bgm}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h4>结构特征</h4>
              <span className="eyebrow">STRUCTURE · {v.segments.length} 段</span>
            </div>
            <div className="panel-body">
              <dl className="kv" style={{ gridTemplateColumns: '80px 1fr' }}>
                <dt>结构家族</dt><dd><b>{v.family}</b></dd>
                <dt>品类</dt><dd>{v.category}</dd>
                <dt>字幕风格</dt><dd>{v.packaging.captions}</dd>
                <dt>封面</dt><dd>{v.packaging.cover}</dd>
                <dt>标签</dt>
                <dd style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {v.tags.map(t => (
                    <span key={t} className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>{t}</span>
                  ))}
                </dd>
              </dl>
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <div className="stat" style={{ padding: '8px 10px' }}>
                  <div className="stat-label">离线点击潜力</div>
                  <div className="stat-value" style={{ fontSize: 18, color: v.color }}>{v.ctr}</div>
                </div>
                <div className="stat" style={{ padding: '8px 10px' }}>
                  <div className="stat-label">完播率</div>
                  <div className="stat-value" style={{ fontSize: 18, color: v.color }}>{v.finish_rate}</div>
                </div>
                <div className="stat" style={{ padding: '8px 10px' }}>
                  <div className="stat-label">离线转化潜力</div>
                  <div className="stat-value" style={{ fontSize: 18, color: v.color }}>{v.cvr}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Structure band */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h4>结构序列 · 角色 × 时长</h4>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              sequence = [{v.segments.map(s => ROLES[s.role]?.code || s.role.toUpperCase()).join(' → ')}]
            </span>
          </div>
          <div className="panel-body">
            {/* Abstract band */}
            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--ff-mono)', fontSize: 10,
                padding: '2px 7px', background: v.color, color: 'var(--bg)',
                fontWeight: 700, letterSpacing: '0.06em', borderRadius: 3,
              }}>▲ 抽象层</span>
              <span className="eyebrow">结构带 · 角色 × 时长</span>
            </div>
            <div className="sband abstract" style={{ height: 58 }}>
              {v.segments.map((seg, i) => {
                const w = (seg.dur / T) * 100;
                return (
                  <div key={i} className={`sband-seg role-${seg.role}`} style={{ width: `${w}%` }}
                    title={`${ROLES[seg.role]?.name} · ${seg.dur}s`}>
                    <span className="sband-abs-meta top">
                      {String(i + 1).padStart(2, '0')} · {ROLES[seg.role]?.code || seg.role.toUpperCase()}
                    </span>
                    {w > 6 && <span className="sband-abs-name">{ROLES[seg.role]?.name}</span>}
                    <span className="sband-abs-meta bot">{seg.dur}s</span>
                  </div>
                );
              })}
            </div>

            {/* Film strip */}
            <SyncRails segments={v.segments.reduce<RailSegment[]>((acc, s, i) => {
              const start = i === 0 ? 0 : acc[i-1].end;
              acc.push({ ...s, start, end: start + s.dur, id: `seg_${i}` });
              return acc;
            }, [])} total={T} height={28} />
            <div className="tline concrete" style={{ height: 56 }}>
              <div className="film-perf top" />
              <div className="film-perf bot" />
              {v.segments.map((seg, i) => {
                const w = (seg.dur / T) * 100;
                return (
                  <div key={i} className="tline-frame concrete-frame"
                    style={{ width: `${w}%`, '--role-color': `var(--r-${seg.role})` } as CSSProperties}>
                    <div className="concrete-frame-bg" />
                    <div className="concrete-frame-label">{seg.shot}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', marginTop: 2, height: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', borderTop: 0, borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
              {v.segments.map((seg, i) => {
                const w = (seg.dur / T) * 100;
                const cumulative = v.segments.slice(0, i).reduce((a, s) => a + s.dur, 0);
                return (
                  <div key={i} style={{ width: `${w}%`, borderRight: '1px solid var(--border-2)', position: 'relative' }}>
                    <span className="mono" style={{ fontSize: 8.5, color: 'var(--text-mute)', position: 'absolute', top: 2, left: 4 }}>
                      {cumulative.toFixed(1)}s
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="hrule">LEGEND · 角色色彩编码</div>
            <RoleLegend roles={[...new Set(v.segments.map(s => s.role))]} />
          </div>
        </div>

        {/* Segment details table */}
        <div className="panel">
          <div className="panel-head">
            <h4>段落明细</h4>
            <span className="eyebrow">{v.segments.length} 个段落 · {T.toFixed(1)}s</span>
          </div>
          <div className="panel-body flush">
            <table className="diff-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>序号</th>
                  <th>角色</th>
                  <th>名称</th>
                  <th>镜头描述</th>
                  <th style={{ width: 70 }}>时长</th>
                  <th style={{ width: 70 }}>占比</th>
                </tr>
              </thead>
              <tbody>
                {v.segments.map((seg, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: 'var(--text-mute)' }}>{String(i+1).padStart(2, '0')}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className={`role-dot role-${seg.role}`} />
                        <span className="mono" style={{ fontSize: 11 }}>{ROLES[seg.role]?.code}</span>
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{seg.label}</td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>{seg.shot}</td>
                    <td className="mono" style={{ color: 'var(--text-2)' }}>{seg.dur}s</td>
                    <td className="mono" style={{ color: 'var(--text-mute)' }}>{Math.round(seg.dur / T * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <ScreenFooter
          status={`${v.family} · ${v.segments.length} 段 · ${T.toFixed(1)}s`}
          statusTone="ok"
          secondary={[{ label: '返回列表', onClick: () => setSelectedVideo(null) }]}
          primary={{ label: '选用此结构迁移', onClick: () => showToast('已选用此结构作为迁移源') }}
        />
        <Toast message={toastMsg} visible={toastVisible} />
      </div>
    );
  }

  // ── Main list view ──
  return (
    <div className="screen">
      <div className="screen-head">
        <div className="screen-head-l">
          <div className="screen-head-num">LIB</div>
          <div>
            <h1>结构样例库</h1>
            <div className="screen-head-sub">
              经典爆款视频结构集合 · 点击查看详细结构 → 选用可直接进入迁移流程
            </div>
          </div>
        </div>
        <div className="screen-head-r">
          <span className="mono">{savedStructures.length} 个已保存 · {LIBRARY_VIDEOS.length} 个示例</span>
        </div>
      </div>

      {/* ── 我的结构库 · REAL saved structures (above the reference 示例库) ── */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h4>我的结构库 · 已保存</h4>
          <span className="eyebrow">真实数据 · 由你扫描的样例保存而来</span>
        </div>
        <div className="panel-body">
          {savedStructures.length === 0 ? (
            <div style={{
              padding: '28px 20px', textAlign: 'center',
              color: 'var(--text-mute)', fontSize: 12.5, lineHeight: 1.6,
            }}>
              <Icon name="library" size={26} />
              <div style={{ marginTop: 10 }}>
                还没有保存的结构 — 在 01 样例扫描后点「保存到结构样例库」
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {savedStructures.map((rec) => (
                <div key={rec.id} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '14px 16px',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div>
                    <div style={{
                      fontSize: 13.5, fontWeight: 600, lineHeight: 1.3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {rec.title || '未命名结构'}
                    </div>
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>
                      {fmtSavedAt(rec.savedAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                    <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                      {rec.segmentCount} 段
                    </span>
                    <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                      {rec.durationSec}s
                    </span>
                    {rec.platform && (
                      <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                        {rec.platform}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <button className="btn primary" style={{ flex: 1, justifyContent: 'center', padding: '5px 10px', fontSize: 11.5 }}
                      onClick={() => handleOpenStructure(rec.id)}>
                      <Icon name="bolt" size={12} /> 载入
                    </button>
                    <button className="btn ghost" style={{ justifyContent: 'center', padding: '5px 10px', fontSize: 11.5 }}
                      onClick={() => handleDeleteStructure(rec.id)}>
                      <Icon name="close" size={12} /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 示例库 · reference gallery below (clearly separated) ── */}
      {/* Honesty banner — these are reference cases, not live measurements */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', marginBottom: 14,
        background: 'var(--accent-dim)', border: '1px solid var(--accent-line)',
        borderRadius: 8, color: 'var(--text-2)', fontSize: 12,
      }}>
        <Icon name="diagnose" size={14} />
        <span>
          <b style={{ color: 'var(--accent)' }}>示例库 · 参考案例（非实时数据）</b>
          <span style={{ marginLeft: 8, color: 'var(--text-dim)' }}>
            以下播放 / 点赞 / 点击 / 完播均为公开爆款的参考示例，非本工具的实时测量结果。
          </span>
        </span>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', marginBottom: 16,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
        flexWrap: 'wrap',
      }}>
        <span className="eyebrow" style={{ marginRight: 4 }}>筛选</span>

        {/* Platform filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn" onClick={() => setFilterPlatform('all')}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: filterPlatform === 'all' ? 'var(--accent-dim)' : 'transparent',
              borderColor: filterPlatform === 'all' ? 'var(--accent-line)' : 'var(--border-2)',
              color: filterPlatform === 'all' ? 'var(--accent)' : 'var(--text-dim)',
            }}>全部平台</button>
          {platforms.map(p => (
            <button key={p} className="btn" onClick={() => setFilterPlatform(p)}
              style={{
                padding: '4px 10px', fontSize: 11,
                background: filterPlatform === p ? 'var(--accent-dim)' : 'transparent',
                borderColor: filterPlatform === p ? 'var(--accent-line)' : 'var(--border-2)',
                color: filterPlatform === p ? 'var(--accent)' : 'var(--text-dim)',
              }}>{p}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border-2)' }} />

        {/* Family filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setFilterFamily('all')}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: filterFamily === 'all' ? 'var(--accent-dim)' : 'transparent',
              borderColor: filterFamily === 'all' ? 'var(--accent-line)' : 'var(--border-2)',
              color: filterFamily === 'all' ? 'var(--accent)' : 'var(--text-dim)',
            }}>全部类型</button>
          {families.map(f => (
            <button key={f} className="btn" onClick={() => setFilterFamily(f)}
              style={{
                padding: '4px 10px', fontSize: 11,
                background: filterFamily === f ? 'var(--accent-dim)' : 'transparent',
                borderColor: filterFamily === f ? 'var(--accent-line)' : 'var(--border-2)',
                color: filterFamily === f ? 'var(--accent)' : 'var(--text-dim)',
              }}>{f}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <input type="text" placeholder="搜索标题 / 标签…" value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{
              padding: '5px 10px 5px 28px', width: 180,
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 5, color: 'var(--text)', fontSize: 11.5,
              fontFamily: 'inherit', outline: 'none',
            }} />
          <Icon name="diagnose" size={13} />
        </div>
      </div>

      {/* Video grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 14,
      }}>
        {filtered.map(v => {
          const T = v.segments.reduce((a, s) => a + s.dur, 0);
          return (
            <div key={v.id} className="lib-card" onClick={() => setSelectedVideo(v)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8, overflow: 'hidden',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = v.color + '88'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              {/* Thumbnail area */}
              <div style={{
                aspectRatio: '16/9', position: 'relative', overflow: 'hidden',
                background: `linear-gradient(135deg, ${v.color}22, ${v.color}08)`,
              }}>
                <div style={{ position: 'absolute', inset: 0, opacity: 0.35 }}>
                  {createElement(SVG_BY_ROLE[v.segments[0].role] || SvgHookShape)}
                </div>
                {/* Mini structure band overlay */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, display: 'flex' }}>
                  {v.segments.map((seg, i) => {
                    const w = (seg.dur / T) * 100;
                    return (
                      <div key={i} className={`role-${seg.role}`}
                        style={{ width: `${w}%`, opacity: 0.85, borderRight: '1px solid rgba(0,0,0,0.3)' }} />
                    );
                  })}
                </div>
                {/* Play icon */}
                <div style={{
                  position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
                    border: `1.5px solid ${v.color}`,
                    display: 'grid', placeItems: 'center', color: v.color,
                  }}><Icon name="play" size={16} /></div>
                </div>
                {/* Badges */}
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
                  <span className="mono" style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)',
                  }}>{v.platform}</span>
                </div>
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                  <span className="mono" style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)',
                  }}>{v.duration}s</span>
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 6,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span className="tag" style={{
                    fontSize: 10, padding: '1px 6px',
                    color: v.color, borderColor: v.color + '44',
                  }}>{v.family}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>{v.category}</span>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                  <div>
                    <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 9.5 }}>播放</span>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 1 }}>{v.views}</div>
                  </div>
                  <div>
                    <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 9.5 }}>离线点击潜力</span>
                    <div style={{ fontWeight: 600, color: v.color, marginTop: 1 }}>{v.ctr}</div>
                  </div>
                  <div>
                    <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 9.5 }}>完播</span>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 1 }}>{v.finish_rate}</div>
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 9.5 }}>段落</span>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 1 }}>{v.segments.length}</div>
                  </div>
                </div>

                {/* Tags */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                  {v.tags.slice(0, 3).map(t => (
                    <span key={t} style={{
                      fontSize: 9.5, padding: '1px 5px',
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 3, color: 'var(--text-mute)', fontFamily: 'var(--ff-mono)',
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{
          padding: '60px 20px', textAlign: 'center',
          color: 'var(--text-mute)', fontSize: 13,
        }}>
          <Icon name="diagnose" size={32} />
          <div style={{ marginTop: 12 }}>没有匹配的样例 · 调整筛选条件试试</div>
        </div>
      )}

      <Toast message={toastMsg} visible={toastVisible} />
    </div>
  );
};
