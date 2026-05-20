'use client';

import { useState } from 'react';
import type { QualityReport, ScriptSegment, StoryboardShot, TimelineItem } from '@viral-struct/shared';
import { apiPost } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';

interface TimelineResponse {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}

interface QualityResponse {
  qualityReport: QualityReport;
}

export function TimelineView() {
  const structureGraph = useWorkflowStore((state) => state.structureGraph);
  const contentBrief = useWorkflowStore((state) => state.contentBrief);
  const slotMatches = useWorkflowStore((state) => state.slotMatches);
  const repairs = useWorkflowStore((state) => state.repairs);
  const script = useWorkflowStore((state) => state.script);
  const storyboard = useWorkflowStore((state) => state.storyboard);
  const timeline = useWorkflowStore((state) => state.timeline);
  const setGenerationResult = useWorkflowStore((state) => state.setGenerationResult);
  const setQualityReport = useWorkflowStore((state) => state.setQualityReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!structureGraph) {
      setError('请先抽取结构图谱。');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await apiPost<TimelineResponse>('/api/timeline/generate', {
        structureGraph,
        newContent: contentBrief,
        matches: slotMatches,
        repairs
      });
      setGenerationResult(result);

      const quality = await apiPost<QualityResponse>('/api/quality/evaluate', {
        matches: slotMatches,
        timeline: result.timeline
      });
      setQualityReport(quality.qualityReport);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h1>步骤 5：生成结果</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <p>
          商品：{contentBrief.productName} · 匹配槽位：{slotMatches.length} · 补全策略：{repairs.length}
        </p>
        <button type="button" onClick={handleGenerate} disabled={loading || !structureGraph}>
          {loading ? '生成中...' : timeline.length ? '重新生成结果' : '生成脚本、分镜和时间线'}
        </button>
        {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      </div>

      {script.length ? <ScriptList script={script} /> : null}
      {storyboard.length ? <StoryboardList storyboard={storyboard} /> : null}
      {timeline.length ? <TimelineList timeline={timeline} /> : <p>尚未生成。点击按钮后会调用 `/api/timeline/generate`。</p>}
    </section>
  );
}

function ScriptList({ script }: { script: ScriptSegment[] }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>脚本</h2>
      <ol>
        {script.map((segment) => (
          <li key={segment.segmentId}>
            <strong>{segment.role}</strong> · {formatSeconds(segment.start)} - {formatSeconds(segment.end)}：{segment.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StoryboardList({ storyboard }: { storyboard: StoryboardShot[] }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>分镜</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {storyboard.map((shot) => (
          <article className="card" key={shot.id}>
            <strong>
              {formatSeconds(shot.start)} - {formatSeconds(shot.end)}
            </strong>
            <p>画面：{shot.visual}</p>
            <p>口播：{shot.narration}</p>
            <p>包装：{shot.packaging}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TimelineList({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <section className="card">
      <h2>时间线草案</h2>
      {timeline.map((item) => (
        <div className="card" key={item.id} style={{ marginBottom: 8 }}>
          <strong>
            {formatSeconds(item.start)} - {formatSeconds(item.end)} · {item.segmentRole}
          </strong>
          <p>{item.visualAction}</p>
          <p>{item.script}</p>
          <p>字幕：{item.subtitles.join(' / ')}</p>
          <p>
            包装：{item.packaging.cardType ?? 'none'} · {item.packaging.transition ?? 'none'} · {item.packaging.motion ?? 'none'}
          </p>
          {item.repair ? <p>补全：{item.repair.strategy}</p> : null}
        </div>
      ))}
    </section>
  );
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
