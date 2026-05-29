'use client';

import { useState } from 'react';
import type { AssetCard, QualityReport, ScriptSegment, ScriptSource, StoryboardShot, TimelineItem, ViralStructureGraph } from '@viral-struct/shared';
import { apiPost } from '../lib/api';
import { type GenerationVariant, type TimelineEditResult, useWorkflowStore } from '../lib/workflowStore';
import { MigrationEvidencePanel } from './MigrationEvidencePanel';
import { GenerationTracePanel, PipelineSourceBadge, PipelineWarningCallout } from './PipelineStatus';
import { TimelineEditSummary } from './TimelineEditSummary';
import { VariantDiffPanel } from './VariantDiffPanel';
import { VisualTimelinePreview } from './VisualTimelinePreview';

interface TimelineResponse {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
  scriptSource?: ScriptSource;
  warning?: string;
  warnings?: string[];
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
  const materialGaps = useWorkflowStore((state) => state.materialGaps);
  const repairs = useWorkflowStore((state) => state.repairs);
  const script = useWorkflowStore((state) => state.script);
  const storyboard = useWorkflowStore((state) => state.storyboard);
  const timeline = useWorkflowStore((state) => state.timeline);
  const assetCards = useWorkflowStore((state) => state.assetCards);
  const pipelineTrace = useWorkflowStore((state) => state.pipelineTrace);
  const generationVariant = useWorkflowStore((state) => state.generationVariant);
  const timelineEditSummary = useWorkflowStore((state) => state.timelineEditSummary);
  const setGenerationVariant = useWorkflowStore((state) => state.setGenerationVariant);
  const setGenerationResult = useWorkflowStore((state) => state.setGenerationResult);
  const setQualityReport = useWorkflowStore((state) => state.setQualityReport);
  const applyTimelineEditResult = useWorkflowStore((state) => state.applyTimelineEditResult);
  const [loading, setLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
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
        assets: assetCards,
        variant: generationVariant,
        boundaries: structureGraph.boundaries
      });
      setGenerationResult(result, {
        scriptSource: result.scriptSource,
        warnings: collectWarnings(result)
      });

      const quality = await apiPost<QualityResponse>('/api/quality/evaluate', {
        matches: slotMatches,
        timeline: result.timeline,
        boundaries: structureGraph.boundaries,
        contentBrief,
        assets: assetCards
      });
      setQualityReport(quality.qualityReport);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyEdit() {
    const normalized = instruction.trim();
    if (!normalized || !timeline.length) {
      setError('请先生成 timeline，并输入改片指令。');
      return;
    }

    setEditLoading(true);
    setError(null);

    try {
      const result = await apiPost<TimelineEditResult>('/api/timeline/apply-edit', {
        instruction: normalized,
        timeline,
        contentBrief
      });
      applyTimelineEditResult(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEditLoading(false);
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

      {timeline.length ? <Preview timeline={timeline} assetCards={assetCards} structureGraph={structureGraph} /> : null}
      {(slotMatches.length || repairs.length || timeline.length) ? (
        <GenerationTracePanel
          alignmentSource={pipelineTrace.alignmentSource}
          gapSpecSource={pipelineTrace.gapSpecSource}
          scriptSource={pipelineTrace.scriptSource}
          warnings={pipelineTrace.warnings}
          qualityContext={`${contentBrief.productName} · ${assetCards.length} assets · ${slotMatches.length} slot matches`}
        />
      ) : null}
      {timeline.length ? (
        <VariantDiffPanel
          variant={generationVariant}
          timeline={timeline}
          contentBrief={contentBrief}
        />
      ) : null}
      {timeline.length ? (
        <MigrationEvidencePanel
          structureGraph={structureGraph}
          contentBrief={contentBrief}
          assetCards={assetCards}
          slotMatches={slotMatches}
          materialGaps={materialGaps}
          repairs={repairs}
          timeline={timeline}
          storyboard={storyboard}
        />
      ) : null}
      {timeline.length ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>人工可调 / 自然语言改片</h2>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            style={{ width: '100%', minHeight: 72 }}
          />
          <button
            type="button"
            onClick={handleApplyEdit}
            disabled={editLoading || !timeline.length || !instruction.trim()}
            style={{ marginTop: 8 }}
          >
            {editLoading ? '应用中...' : '应用调整'}
          </button>
        </section>
      ) : null}
      <TimelineEditSummary summary={timelineEditSummary} />

      {script.length ? <ScriptList script={script} /> : null}
      {storyboard.length ? <StoryboardList storyboard={storyboard} /> : null}
      {timeline.length ? (
        <TimelineList
          timeline={timeline}
          structureGraph={structureGraph}
          scriptSource={pipelineTrace.scriptSource}
          warnings={pipelineTrace.warnings}
        />
      ) : <p>尚未生成。点击按钮后会调用 `/api/timeline/generate`。</p>}
    </section>
  );
}

function Preview({
  timeline,
  assetCards,
  structureGraph
}: {
  timeline: TimelineItem[];
  assetCards: AssetCard[];
  structureGraph: ViralStructureGraph | null;
}) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Web 视觉预览</h2>
      <VisualTimelinePreview timeline={timeline} assetCards={assetCards} structureGraph={structureGraph} />
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

function TimelineList({
  timeline,
  structureGraph,
  scriptSource,
  warnings
}: {
  timeline: TimelineItem[];
  structureGraph: ViralStructureGraph | null;
  scriptSource?: ScriptSource;
  warnings: string[];
}) {
  const slotById = new Map((structureGraph?.shotSlots ?? []).map((slot) => [slot.id, slot]));

  return (
    <section className="card">
      <h2>时间线草案</h2>
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        <PipelineSourceBadge label="Timeline" kind="script" source={scriptSource} />
        <PipelineWarningCallout warnings={warnings} />
      </div>
      {timeline.map((item) => {
        const slot = slotById.get(item.slotId);
        return (
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
            <p>脚本来源：{item.scriptSource === 'llm_generated' ? 'LLM Script Generation' : item.scriptSource === 'template' ? 'Template fallback' : 'Not run'}</p>
            {slot?.intent ? <p>迁移意图：{slot.intent.purpose}</p> : null}
            {slot?.acceptanceCriteria ? (
              <p>替代标准：{slot.acceptanceCriteria.anyOf.flatMap((criterion) => criterion.examples).slice(0, 3).join(' / ')}</p>
            ) : null}
            {item.repair ? <p>补全：{item.repair.strategy} · {item.repair.explanation}</p> : null}
          </div>
        );
      })}
    </section>
  );
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectWarnings(response: { warning?: string; warnings?: string[] }): string[] {
  return [...(response.warnings ?? []), response.warning].filter((warning): warning is string => Boolean(warning));
}
