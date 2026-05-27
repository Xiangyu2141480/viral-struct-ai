'use client';

import { useState } from 'react';
import type { AssetCard, QualityReport, ScriptSegment, StoryboardShot, TimelineItem } from '@viral-struct/shared';
import { apiPost } from '../lib/api';
import { type GenerationVariant, useWorkflowStore } from '../lib/workflowStore';
import { VisualTimelinePreview } from './VisualTimelinePreview';

interface TimelineResponse {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}

interface QualityResponse {
  qualityReport: QualityReport;
}

const variantLabels: Record<GenerationVariant, string> = {
  high_click: '高点击版',
  high_conversion: '高转化版',
  premium: '高质感版'
};

export function TimelineView() {
  const structureGraph = useWorkflowStore((state) => state.structureGraph);
  const contentBrief = useWorkflowStore((state) => state.contentBrief);
  const slotMatches = useWorkflowStore((state) => state.slotMatches);
  const repairs = useWorkflowStore((state) => state.repairs);
  const script = useWorkflowStore((state) => state.script);
  const storyboard = useWorkflowStore((state) => state.storyboard);
  const timeline = useWorkflowStore((state) => state.timeline);
  const assetCards = useWorkflowStore((state) => state.assetCards);
  const generationVariant = useWorkflowStore((state) => state.generationVariant);
  const editNotes = useWorkflowStore((state) => state.editNotes);
  const setGenerationVariant = useWorkflowStore((state) => state.setGenerationVariant);
  const setGenerationResult = useWorkflowStore((state) => state.setGenerationResult);
  const setQualityReport = useWorkflowStore((state) => state.setQualityReport);
  const applyLocalEdit = useWorkflowStore((state) => state.applyLocalEdit);
  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState('开头更抓人一些，把商品信息提前，节奏更快。');
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
        repairs,
        variant: generationVariant
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {(Object.keys(variantLabels) as GenerationVariant[]).map((variant) => (
            <button
              key={variant}
              type="button"
              onClick={() => setGenerationVariant(variant)}
              disabled={generationVariant === variant || loading}
            >
              {variantLabels[variant]}
            </button>
          ))}
        </div>
        <button type="button" onClick={handleGenerate} disabled={loading || !structureGraph}>
          {loading ? '生成中...' : timeline.length ? `重新生成 ${variantLabels[generationVariant]}` : `生成 ${variantLabels[generationVariant]}`}
        </button>
        {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      </div>

      {timeline.length ? <Preview timeline={timeline} assetCards={assetCards} /> : null}
      {timeline.length ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>人工可调 / 自然语言改片</h2>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            style={{ width: '100%', minHeight: 72 }}
          />
          <button type="button" onClick={() => applyLocalEdit(instruction)} style={{ marginTop: 8 }}>
            应用调整
          </button>
          {editNotes.length ? (
            <ul>
              {editNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {script.length ? <ScriptList script={script} /> : null}
      {storyboard.length ? <StoryboardList storyboard={storyboard} /> : null}
      {timeline.length ? <MappingView timeline={timeline} /> : null}
      {timeline.length ? <TimelineList timeline={timeline} /> : <p>尚未生成。点击按钮后会调用 `/api/timeline/generate`。</p>}
    </section>
  );
}

function Preview({ timeline, assetCards }: { timeline: TimelineItem[]; assetCards: AssetCard[] }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Web 视觉预览</h2>
      <VisualTimelinePreview timeline={timeline} assetCards={assetCards} />
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

function MappingView({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>样例结构 → 新结果映射</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">样例段落</th>
            <th align="left">槽位</th>
            <th align="left">素材/补全</th>
            <th align="left">新结果</th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: 8 }}>{item.sourceSegmentId}</td>
              <td style={{ padding: 8 }}>{item.slotId}</td>
              <td style={{ padding: 8 }}>{item.assetId ?? item.repair?.strategy ?? 'packaging'}</td>
              <td style={{ padding: 8 }}>{item.script}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
          {item.repair ? <p>补全：{item.repair.strategy} · {item.repair.explanation}</p> : null}
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
