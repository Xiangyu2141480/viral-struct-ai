'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssetCard, MissingMaterialGenerationJob, QualityReport, ScriptSegment, ScriptSource, StoryboardFrame, StoryboardShot, TimelineItem, ViralStructureGraph } from '@viral-struct/shared';
import { apiPost, estimateDemoAnalytics, planMissingMaterialGeneration, planStoryboardFrames } from '../lib/api';
import { useGsapReveal } from '../lib/useGsapReveal';
import { type GenerationVariant, type TimelineEditResult, useWorkflowStore } from '../lib/workflowStore';
import { DemoAnalyticsPanel } from './DemoAnalyticsPanel';
import { MigrationEvidencePanel } from './MigrationEvidencePanel';
import { MissingMaterialJobCard } from './MissingMaterialJobCard';
import { GenerationTracePanel, PipelineSourceBadge, PipelineWarningCallout } from './PipelineStatus';
import { StoryboardFramePanel } from './StoryboardFramePanel';
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
  const storyboardFrames = useWorkflowStore((state) => state.storyboardFrames ?? []);
  const storyboardFrameWarnings = useWorkflowStore((state) => state.storyboardFrameWarnings ?? []);
  const missingMaterialJobs = useWorkflowStore((state) => state.missingMaterialJobs ?? []);
  const missingMaterialJobWarnings = useWorkflowStore((state) => state.missingMaterialJobWarnings ?? []);
  const demoEstimate = useWorkflowStore((state) => state.demoEstimate);
  const timeline = useWorkflowStore((state) => state.timeline);
  const assetCards = useWorkflowStore((state) => state.assetCards);
  const pipelineTrace = useWorkflowStore((state) => state.pipelineTrace);
  const generationVariant = useWorkflowStore((state) => state.generationVariant);
  const timelineEditSummary = useWorkflowStore((state) => state.timelineEditSummary);
  const setGenerationVariant = useWorkflowStore((state) => state.setGenerationVariant);
  const setGenerationResult = useWorkflowStore((state) => state.setGenerationResult);
  const setStoryboardFrames = useWorkflowStore((state) => state.setStoryboardFrames);
  const setMissingMaterialJobs = useWorkflowStore((state) => state.setMissingMaterialJobs);
  const setQualityReport = useWorkflowStore((state) => state.setQualityReport);
  const setDemoEstimate = useWorkflowStore((state) => state.setDemoEstimate);
  const applyTimelineEditResult = useWorkflowStore((state) => state.applyTimelineEditResult);
  const [loading, setLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [materialPlanLoading, setMaterialPlanLoading] = useState(false);
  const [selectedTimelineItemId, setSelectedTimelineItemId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('开头更抓人一些，把商品信息提前，节奏更快。');
  const [error, setError] = useState<string | null>(null);
  const autoPlanKeyRef = useRef<string | null>(null);

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
      setSelectedTimelineItemId(result.timeline[0]?.id ?? null);
      const plannedFrames = await handlePlanStoryboard(result.timeline);
      const plannedJobs = await handlePlanMaterialGeneration(result.timeline, plannedFrames);

      const quality = await apiPost<QualityResponse>('/api/quality/evaluate', {
        matches: slotMatches,
        timeline: result.timeline,
        boundaries: structureGraph.boundaries,
        contentBrief,
        assets: assetCards
      });
      setQualityReport(quality.qualityReport);
      await handleEstimateAnalytics(result.timeline, plannedFrames, plannedJobs, quality.qualityReport);
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
      setSelectedTimelineItemId((current) => (
        result.updatedTimeline.some((item) => item.id === current)
          ? current
          : result.updatedTimeline[0]?.id ?? null
      ));
      const plannedFrames = await handlePlanStoryboard(result.updatedTimeline);
      const plannedJobs = await handlePlanMaterialGeneration(result.updatedTimeline, plannedFrames);
      const quality = await apiPost<QualityResponse>('/api/quality/evaluate', {
        matches: slotMatches,
        timeline: result.updatedTimeline,
        boundaries: structureGraph?.boundaries,
        contentBrief,
        assets: assetCards
      });
      setQualityReport(quality.qualityReport);
      await handleEstimateAnalytics(result.updatedTimeline, plannedFrames, plannedJobs, quality.qualityReport);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEditLoading(false);
    }
  }

  async function handlePlanStoryboard(nextTimeline = timeline): Promise<StoryboardFrame[]> {
    if (!structureGraph || !nextTimeline.length) {
      setStoryboardFrames([], ['请先生成 timeline，再规划 storyboard prompts。']);
      return [];
    }

    setStoryboardLoading(true);
    try {
      const result = await planStoryboardFrames({
        timeline: nextTimeline,
        structureGraph,
        contentBrief,
        assetCards,
        slotMatches,
        materialGaps,
        repairs
      });
      setStoryboardFrames(result.frames, result.warnings);
      return result.frames;
    } catch (err) {
      setStoryboardFrames([], [`Storyboard prompt planning failed: ${errorMessage(err)}`]);
      return [];
    } finally {
      setStoryboardLoading(false);
    }
  }

  async function handlePlanMaterialGeneration(nextTimeline = timeline, nextStoryboardFrames = storyboardFrames): Promise<MissingMaterialGenerationJob[]> {
    if (!nextTimeline.length || !materialGaps.length) {
      setMissingMaterialJobs([], materialGaps.length ? [] : ['No material gaps available for external generation planning.']);
      return [];
    }

    setMaterialPlanLoading(true);
    try {
      const result = await planMissingMaterialGeneration({
        materialGaps,
        repairs,
        storyboardFrames: nextStoryboardFrames,
        timeline: nextTimeline,
        contentBrief,
        aspectRatio: structureGraph?.meta.aspectRatio ?? '9:16',
        provider: 'mock'
      });
      setMissingMaterialJobs(result.jobs, result.warnings);
      return result.jobs;
    } catch (err) {
      setMissingMaterialJobs([], [`Missing material generation planning failed: ${errorMessage(err)}`]);
      return [];
    } finally {
      setMaterialPlanLoading(false);
    }
  }

  async function handleEstimateAnalytics(
    nextTimeline = timeline,
    nextStoryboardFrames = storyboardFrames,
    nextMissingMaterialJobs = missingMaterialJobs,
    nextQualityReport?: QualityReport
  ) {
    if (!nextTimeline.length) {
      setDemoEstimate(null);
      return;
    }

    try {
      const result = await estimateDemoAnalytics({
        structureGraph,
        contentBrief,
        slotMatches,
        materialGaps,
        repairs,
        timeline: nextTimeline,
        storyboardFrames: nextStoryboardFrames,
        missingMaterialJobs: nextMissingMaterialJobs,
        qualityReport: nextQualityReport,
        generationVariant
      });
      setDemoEstimate(result.demoEstimate);
    } catch {
      setDemoEstimate(null);
    }
  }

  useEffect(() => {
    if (!timeline.length || !structureGraph) {
      return;
    }

    const key = `${generationVariant}:${timeline.map((item) => item.id).join('|')}`;
    if (autoPlanKeyRef.current === key) {
      return;
    }

    if (storyboardFrames.length && missingMaterialJobs.length && demoEstimate) {
      autoPlanKeyRef.current = key;
      return;
    }

    autoPlanKeyRef.current = key;
    void (async () => {
      const plannedFrames = storyboardFrames.length ? storyboardFrames : await handlePlanStoryboard(timeline);
      const plannedJobs = missingMaterialJobs.length ? missingMaterialJobs : await handlePlanMaterialGeneration(timeline, plannedFrames);
      if (!demoEstimate) {
        await handleEstimateAnalytics(timeline, plannedFrames, plannedJobs);
      }
    })();
  }, [
    demoEstimate,
    generationVariant,
    missingMaterialJobs,
    storyboardFrames,
    structureGraph,
    timeline
  ]);

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
          missingMaterialJobs={missingMaterialJobs}
          timeline={timeline}
          storyboard={storyboard}
        />
      ) : null}
      {timeline.length || storyboardFrameWarnings.length ? (
        <StoryboardFramePanel
          frames={storyboardFrames}
          warnings={storyboardFrameWarnings}
          loading={storyboardLoading}
          onPlan={() => void handlePlanStoryboard().then((frames) => handlePlanMaterialGeneration(timeline, frames))}
        />
      ) : null}
      {timeline.length || missingMaterialJobWarnings.length ? (
        <MissingMaterialJobsPanel
          jobs={missingMaterialJobs}
          warnings={missingMaterialJobWarnings}
          loading={materialPlanLoading}
          onPlan={() => void handlePlanMaterialGeneration()}
        />
      ) : null}
      <DemoAnalyticsPanel estimate={demoEstimate} />
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
          selectedTimelineItemId={selectedTimelineItemId}
          onSelectTimelineItem={setSelectedTimelineItemId}
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
  warnings,
  selectedTimelineItemId,
  onSelectTimelineItem
}: {
  timeline: TimelineItem[];
  structureGraph: ViralStructureGraph | null;
  scriptSource?: ScriptSource;
  warnings: string[];
  selectedTimelineItemId: string | null;
  onSelectTimelineItem: (id: string) => void;
}) {
  const slotById = new Map((structureGraph?.shotSlots ?? []).map((slot) => [slot.id, slot]));
  const selectedRef = useGsapReveal<HTMLElement>({
    selector: '[data-selected-timeline="true"]',
    mode: 'highlight',
    dependencyKey: selectedTimelineItemId
  });

  return (
    <section ref={selectedRef} className="card">
      <h2>时间线草案</h2>
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        <PipelineSourceBadge label="Timeline" kind="script" source={scriptSource} />
        <PipelineWarningCallout warnings={warnings} />
      </div>
      {timeline.map((item) => {
        const slot = slotById.get(item.slotId);
        const selected = selectedTimelineItemId === item.id;
        return (
          <div
            className="card"
            key={item.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            data-selected-timeline={selected ? 'true' : 'false'}
            onClick={() => onSelectTimelineItem(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectTimelineItem(item.id);
              }
            }}
            style={{
              marginBottom: 8,
              cursor: 'pointer',
              border: selected ? '1px solid rgba(251,191,36,0.55)' : undefined,
              boxShadow: selected ? '0 0 0 1px rgba(251,191,36,0.18)' : undefined
            }}
          >
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

function MissingMaterialJobsPanel({
  jobs,
  warnings,
  loading,
  onPlan
}: {
  jobs: MissingMaterialGenerationJob[];
  warnings: string[];
  loading: boolean;
  onPlan: () => void;
}) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2>Missing Material Generation Jobs</h2>
          <p style={{ marginTop: 4, color: '#94a3b8' }}>
            External generation plan, not current core output. These jobs are not submitted to Seedance or any video model.
          </p>
        </div>
        <button type="button" onClick={onPlan} disabled={loading}>
          {loading ? '规划中...' : jobs.length ? '重新规划缺口生成任务' : '规划缺口生成任务'}
        </button>
      </div>

      {warnings.length ? (
        <div style={{ border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 8, padding: 12, margin: '12px 0', color: '#fbbf24' }}>
          {warnings.map((warning) => (
            <p key={warning} style={{ margin: 0 }}>{warning}</p>
          ))}
        </div>
      ) : null}

      {jobs.length ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {jobs.map((job) => (
            <MissingMaterialJobCard key={job.id} job={job} />
          ))}
        </div>
      ) : (
        <p style={{ color: '#94a3b8' }}>High/medium material gaps will appear here as external generation planning jobs.</p>
      )}
    </section>
  );
}

function collectWarnings(response: { warning?: string; warnings?: string[] }): string[] {
  return [...(response.warnings ?? []), response.warning].filter((warning): warning is string => Boolean(warning));
}
