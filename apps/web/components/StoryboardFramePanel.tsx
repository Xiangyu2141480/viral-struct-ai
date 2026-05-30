import type { StoryboardFrame } from '@viral-struct/shared';
import { GeneratedVisualAssetCard } from './GeneratedVisualAssetCard';

export function StoryboardFramePanel({
  frames,
  warnings,
  loading,
  onPlan
}: {
  frames: StoryboardFrame[];
  warnings: string[];
  loading?: boolean;
  onPlan?: () => void;
}) {
  if (!frames.length && !warnings.length && !onPlan) {
    return null;
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2>Storyboard Prompt Planner</h2>
          <p style={{ marginTop: 4, color: '#94a3b8' }}>
            Prompt-ready storyboard drafts only. These cards do not claim real image generation.
          </p>
        </div>
        {onPlan ? (
          <button type="button" onClick={onPlan} disabled={loading}>
            {loading ? '规划中...' : frames.length ? '重新规划 storyboard prompts' : '规划 storyboard prompts'}
          </button>
        ) : null}
      </div>

      {warnings.length ? (
        <div style={{ border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 8, padding: 12, margin: '12px 0', color: '#fbbf24' }}>
          {warnings.map((warning) => (
            <p key={warning} style={{ margin: 0 }}>{warning}</p>
          ))}
        </div>
      ) : null}

      {frames.length ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {frames.map((frame) => (
            <GeneratedVisualAssetCard key={frame.id} frame={frame} />
          ))}
        </div>
      ) : (
        <p style={{ color: '#94a3b8' }}>生成 timeline 后会自动规划 3-5 张 prompt-ready storyboard draft。</p>
      )}
    </section>
  );
}
