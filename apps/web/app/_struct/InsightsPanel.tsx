'use client';

// InsightsPanel.tsx — surfaces the backend evaluation/generation capabilities
// (quality self-check, offline performance estimate, brand-safety guardrail,
// storyboard planning, AIGC generation specs) as buttons on Screen 04.
// Each button calls a /api/struct/* capability route through the store.

import { useProjectStore } from './store/useProjectStore';
import { Icon } from './components';

function pct(n: number | undefined): string {
  return n === undefined ? 'n/a' : `${Math.round(n * 100)}%`;
}

const RISK_COLOR: Record<string, string> = {
  low: 'var(--st-filled)',
  medium: 'var(--st-weakly)',
  high: 'var(--st-critical)',
  none: 'var(--st-filled)',
};

export function InsightsPanel() {
  const evaluateQuality = useProjectStore((s) => s.evaluateQuality);
  const estimatePerformance = useProjectStore((s) => s.estimatePerformance);
  const checkSafety = useProjectStore((s) => s.checkSafety);
  const planStoryboard = useProjectStore((s) => s.planStoryboard);
  const planMaterialJobs = useProjectStore((s) => s.planMaterialJobs);
  const insightLoading = useProjectStore((s) => s.insightLoading);
  const qualityReport = useProjectStore((s) => s.qualityReport);
  const demoEstimate = useProjectStore((s) => s.demoEstimate);
  const safetyStatus = useProjectStore((s) => s.safetyStatus);
  const storyboardFrames = useProjectStore((s) => s.storyboardFrames);
  const materialJobs = useProjectStore((s) => s.materialJobs);

  const buttons: { key: string; label: string; icon: string; onClick: () => void }[] = [
    { key: 'quality', label: '质量评估', icon: 'check', onClick: () => void evaluateQuality() },
    { key: 'estimate', label: '预测评分', icon: 'sparkle', onClick: () => void estimatePerformance() },
    { key: 'safety', label: '安全检查', icon: 'alert', onClick: () => void checkSafety() },
    { key: 'storyboard', label: '生成分镜', icon: 'play', onClick: () => void planStoryboard() },
    { key: 'materialJobs', label: 'AIGC 生成规划', icon: 'sparkle', onClick: () => void planMaterialJobs() },
  ];

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <h4>评估与生成 · 后端能力</h4>
        <span className="eyebrow">质量 / 预测 / 安全 / 分镜 / AIGC</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {buttons.map((b) => (
            <button
              key={b.key}
              className="btn"
              onClick={b.onClick}
              disabled={insightLoading !== null}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              <Icon name={b.icon} size={12} /> {insightLoading === b.key ? '运行中…' : b.label}
            </button>
          ))}
        </div>

        {/* Quality report */}
        {qualityReport && (
          <ResultCard title="质量评估 · QualityReport" tone="ok">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                ['结构匹配', qualityReport.structureMatch],
                ['素材覆盖', qualityReport.slotCoverage],
                ['图文一致', qualityReport.visualScriptAlignment],
                ['事实性', qualityReport.factuality],
                ['连贯性', qualityReport.coherence],
                ['字幕可读', qualityReport.subtitleReadability],
                ['转场保真', qualityReport.transitionFidelity],
              ].map(([label, v]) => (
                <Metric key={label as string} label={label as string} value={pct(v as number | undefined)} />
              ))}
            </div>
          </ResultCard>
        )}

        {/* Demo estimate */}
        {demoEstimate && (
          <ResultCard title="预测评分 · 离线启发式估计" tone="accent">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {Object.entries(demoEstimate.metrics ?? {}).map(([k, m]) => (
                <Metric key={k} label={(m as { label?: string }).label ?? k} value={String((m as { score?: number }).score ?? '—')} />
              ))}
            </div>
            <div className="mono dim" style={{ fontSize: 10, marginTop: 8 }}>{demoEstimate.disclaimer}</div>
          </ResultCard>
        )}

        {/* Safety */}
        {safetyStatus && (
          <ResultCard title="安全检查 · 品牌 / IP / 宣称" tone={safetyStatus.status === 'passed' ? 'ok' : 'critical'}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="pill" style={{ color: safetyStatus.status === 'passed' ? 'var(--st-filled)' : 'var(--st-critical)' }}>
                {safetyStatus.status}
              </span>
              {(['ipRisk', 'brandRisk', 'claimRisk'] as const).map((k) => (
                <span key={k} className="mono" style={{ fontSize: 11, color: RISK_COLOR[safetyStatus[k]] ?? 'var(--text-2)' }}>
                  {k}: {safetyStatus[k]}
                </span>
              ))}
            </div>
            {safetyStatus.reasons?.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: 'var(--text-dim)' }}>
                {safetyStatus.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </ResultCard>
        )}

        {/* Storyboard */}
        {storyboardFrames && (
          <ResultCard title={`分镜规划 · ${storyboardFrames.length} 帧`} tone="accent">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {storyboardFrames.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  <span className="mono" style={{ color: 'var(--accent-2)' }}>#{i + 1}</span>{' '}
                  {(f as { prompt?: string; description?: string }).prompt ??
                    (f as { description?: string }).description ??
                    JSON.stringify(f).slice(0, 120)}
                </div>
              ))}
            </div>
          </ResultCard>
        )}

        {/* Material generation jobs */}
        {materialJobs && (
          <ResultCard title={`AIGC 生成规划 · ${materialJobs.length} 个任务`} tone="accent">
            {materialJobs.length === 0 ? (
              <div className="mono dim" style={{ fontSize: 11 }}>当前无需 AIGC 生成（缺口可由现有素材或包装补足）</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {materialJobs.map((j, i) => {
                  const job = j as { mode?: string; slotId?: string; positivePrompt?: string; prompt?: string };
                  return (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                      <span className="mono" style={{ color: 'var(--accent-2)' }}>{job.mode ?? 'job'}{job.slotId ? ` · ${job.slotId}` : ''}</span>{' '}
                      {job.positivePrompt ?? job.prompt ?? JSON.stringify(j).slice(0, 120)}
                    </div>
                  );
                })}
              </div>
            )}
          </ResultCard>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5 }}>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function ResultCard({ title, tone, children }: { title: string; tone: 'ok' | 'accent' | 'critical'; children: React.ReactNode }) {
  const line = tone === 'ok' ? 'var(--st-filled)' : tone === 'critical' ? 'var(--st-critical)' : 'var(--accent)';
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderLeft: `3px solid ${line}`, borderRadius: 5 }}>
      <div className="eyebrow" style={{ marginBottom: 8, color: line }}>{title}</div>
      {children}
    </div>
  );
}
