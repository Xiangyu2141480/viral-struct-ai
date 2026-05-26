'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  QualityReport,
  ScriptSegment,
  SlotMatch,
  StoryboardShot,
  TimelineItem,
  VideoAnalysis,
  ViralStructureGraph
} from '@viral-struct/shared';
import { apiGet, apiPost, mediaUrl } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';

type DemoStatus = 'pending' | 'running' | 'done' | 'error';

interface DemoShowcaseCase {
  id: string;
  title: string;
  seedFilename: string;
  manualTranscript: string;
  productName: string;
  targetAudience: string;
  scenario: string;
  sellingPoints: string[];
  cta: string;
  stylePreference: string;
  assetBrief: string;
  assetFiles: DemoShowcaseAsset[];
}

interface DemoShowcaseAsset {
  filename: string;
  displayName: string;
  repoPath: string;
  publicUrl: string;
}

interface DemoShowcaseStep {
  id: string;
  label: string;
  route: string;
  output: string;
  judgeSignal: string;
}

interface DemoScoreEvidence {
  taskId: string;
  taskName: string;
  points: number;
  route: string;
  evidence: string;
}

interface DemoShowcase {
  case: DemoShowcaseCase;
  steps: DemoShowcaseStep[];
  scoreEvidence: DemoScoreEvidence[];
}

interface ShowcaseResponse {
  showcase: DemoShowcase;
}

interface DemoRunResponse {
  showcase: DemoShowcase;
  contentBrief: ContentBrief;
  videoAnalysis: VideoAnalysis;
  structureGraph: ViralStructureGraph;
  structureDebug?: {
    fallbackUsed: boolean;
    segmentCount: number;
    evidenceCount: number;
    warnings: string[];
  };
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
  qualityReport: QualityReport;
}

const fallbackShowcase: DemoShowcase = {
  case: {
    id: 'kangshifu_iced_black_tea_gap_repair',
    title: '康师傅冰红茶：少素材结构迁移主案例',
    seedFilename: 'huaxizi.mp4',
    manualTranscript:
      '开头先用高温场景抓住注意。普通饮料不够解腻也不够清爽。核心卖点要快速前置。真实画面展示冰镇、开盖和畅饮瞬间。最后用明确 CTA 完成转化。',
    productName: '康师傅冰红茶',
    targetAudience: '夏季通勤和校园人群',
    scenario: '午后高温、运动后或饭后解腻',
    sellingPoints: ['冰爽解腻', '柠檬茶香', '大瓶畅饮', '冷藏口感更好'],
    cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
    stylePreference: '清爽夏日、高点击、快节奏、红色卖点卡',
    assetBrief:
      '已有瓶身主图、动感冰爽图、组合包装图；缺少真人口播、缺少完整开盖畅饮过程、缺少对比镜头、缺少 CTA 结尾镜头。系统需要用标题卡、冰爽卖点卡、结构重排和素材复用完成补全。',
    assetFiles: [
      {
        filename: 'kangshifu-iced-tea-product-shot.png',
        displayName: '瓶身主图',
        repoPath: 'seed_assets/demo_assets/kangshifu_iced_tea/kangshifu-iced-tea-product-shot.png',
        publicUrl: '/media/demo-assets/kangshifu_iced_tea/kangshifu-iced-tea-product-shot.png'
      },
      {
        filename: 'kangshifu-iced-tea-splash.png',
        displayName: '动感冰爽图',
        repoPath: 'seed_assets/demo_assets/kangshifu_iced_tea/kangshifu-iced-tea-splash.png',
        publicUrl: '/media/demo-assets/kangshifu_iced_tea/kangshifu-iced-tea-splash.png'
      },
      {
        filename: 'kangshifu-iced-tea-lineup.png',
        displayName: '组合包装图',
        repoPath: 'seed_assets/demo_assets/kangshifu_iced_tea/kangshifu-iced-tea-lineup.png',
        publicUrl: '/media/demo-assets/kangshifu_iced_tea/kangshifu-iced-tea-lineup.png'
      }
    ]
  },
  steps: [
    {
      id: 'analyze',
      label: '真实样例解析',
      route: '/analyze',
      output: 'VideoAnalysis',
      judgeSignal: '真实 duration / fps / resolution / keyframes / transcript fallback'
    },
    {
      id: 'graph',
      label: '结构图谱抽取',
      route: '/graph',
      output: 'ViralStructureGraph',
      judgeSignal: '脚本结构、节奏结构、包装结构和 creativeIngredients'
    },
    {
      id: 'adapt',
      label: '新商品与素材适配',
      route: '/adapt',
      output: 'ContentBrief + AssetCard[]',
      judgeSignal: '少素材输入被转成可匹配槽位的素材卡'
    },
    {
      id: 'gaps',
      label: '缺口识别与补全',
      route: '/gaps',
      output: 'SlotMatch + MaterialGap + GapRepair',
      judgeSignal: 'opening / usage / comparison / CTA 等缺口和补全策略'
    },
    {
      id: 'result',
      label: '结果生成与验证',
      route: '/result',
      output: 'Script + Storyboard + Timeline + QualityReport',
      judgeSignal: '脚本、分镜、时间线、包装建议、映射关系和质量自检'
    }
  ],
  scoreEvidence: [
    {
      taskId: 'task_1',
      taskName: '样例视频输入与解析',
      points: 5,
      route: '/analyze',
      evidence: 'seed/upload 输入、真实元信息、封面/关键帧、字幕概览'
    },
    {
      taskId: 'task_2',
      taskName: '结构拆解',
      points: 10,
      route: '/graph',
      evidence: '脚本段落、节奏结构、包装结构三类同时展示'
    },
    {
      taskId: 'task_3',
      taskName: '新内容与素材输入',
      points: 5,
      route: '/adapt',
      evidence: '商品 brief、文字素材、图片/视频素材入口和 AssetCard 结果'
    },
    {
      taskId: 'task_5',
      taskName: '素材缺口识别',
      points: 8,
      route: '/gaps',
      evidence: '槽位级 matched / partial / missing 和缺失创作要素'
    },
    {
      taskId: 'task_6',
      taskName: '素材缺口补全',
      points: 12,
      route: '/gaps',
      evidence: '标题卡、卖点卡、CTA 卡、素材复用、结构重排等 repair'
    },
    {
      taskId: 'task_7',
      taskName: '迁移过程可视化',
      points: 10,
      route: '/demo',
      evidence: '一页串联样例结构、新内容映射、缺口、补全和最终结果'
    },
    {
      taskId: 'task_8',
      taskName: '结果可验证',
      points: 10,
      route: '/result',
      evidence: '脚本、分镜、时间线草案、Web preview、质量自检'
    },
    {
      taskId: 'task_9_10_12',
      taskName: '进阶与人机协同',
      points: 20,
      route: '/result',
      evidence: '多版本策略、包装建议和自然语言局部调整入口'
    }
  ]
};

export function DemoShowcasePanel() {
  const videoAnalysis = useWorkflowStore((state) => state.videoAnalysis);
  const structureGraph = useWorkflowStore((state) => state.structureGraph);
  const assetCards = useWorkflowStore((state) => state.assetCards);
  const materialGaps = useWorkflowStore((state) => state.materialGaps);
  const repairs = useWorkflowStore((state) => state.repairs);
  const timeline = useWorkflowStore((state) => state.timeline);
  const qualityReport = useWorkflowStore((state) => state.qualityReport);
  const resetWorkflow = useWorkflowStore((state) => state.resetWorkflow);
  const setVideoAnalysis = useWorkflowStore((state) => state.setVideoAnalysis);
  const setStructureGraph = useWorkflowStore((state) => state.setStructureGraph);
  const setContentBrief = useWorkflowStore((state) => state.setContentBrief);
  const setAssetCards = useWorkflowStore((state) => state.setAssetCards);
  const setSlotResult = useWorkflowStore((state) => state.setSlotResult);
  const setRepairs = useWorkflowStore((state) => state.setRepairs);
  const setGenerationVariant = useWorkflowStore((state) => state.setGenerationVariant);
  const setGenerationResult = useWorkflowStore((state) => state.setGenerationResult);
  const setQualityReport = useWorkflowStore((state) => state.setQualityReport);

  const [showcase, setShowcase] = useState<DemoShowcase | null>(fallbackShowcase);
  const [statuses, setStatuses] = useState<Record<string, DemoStatus>>(initialStatuses(fallbackShowcase.steps));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    apiGet<ShowcaseResponse>('/api/demo/showcase')
      .then((response) => {
        if (mounted) {
          setShowcase(response.showcase);
          setStatuses(initialStatuses(response.showcase.steps));
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(`Demo config API unavailable; using local fallback. ${errorMessage(err)}`);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (showcase && timeline.length > 0 && !running) {
      setStatuses(allStatuses(showcase.steps, 'done'));
    }
  }, [running, showcase, timeline.length]);

  const demoBrief = useMemo<ContentBrief | null>(() => {
    if (!showcase) {
      return null;
    }

    return {
      productName: showcase.case.productName,
      targetAudience: showcase.case.targetAudience,
      scenario: showcase.case.scenario,
      sellingPoints: showcase.case.sellingPoints,
      cta: showcase.case.cta,
      stylePreference: showcase.case.stylePreference
    };
  }, [showcase]);

  async function handleRunDemo() {
    if (!showcase || !demoBrief) {
      return;
    }

    setRunning(true);
    setError(null);
    resetWorkflow();
    setStatuses(allStatuses(showcase.steps, 'running'));

    try {
      const result = await apiPost<DemoRunResponse>('/api/demo/run', {});
      setShowcase(result.showcase);
      setVideoAnalysis(result.videoAnalysis);
      setStructureGraph(result.structureGraph, result.structureDebug);
      setContentBrief(result.contentBrief);
      setAssetCards(result.assetCards);
      setSlotResult(result.slotMatches, result.materialGaps);
      setRepairs(result.repairs);
      setGenerationVariant('high_click');
      setGenerationResult({
        script: result.script,
        storyboard: result.storyboard,
        timeline: result.timeline
      });
      setQualityReport(result.qualityReport);
      setStatuses(allStatuses(result.showcase.steps, 'done'));
    } catch (err) {
      const message = errorMessage(err);
      setStatuses(allStatuses(showcase.steps, 'error'));
      setError(message);
    } finally {
      setRunning(false);
    }
  }

  if (!showcase) {
    return (
      <main className="card">
        <h1>冠军演示工作台</h1>
        <p>{error ? `加载失败：${error}` : '正在读取 demo case...'}</p>
      </main>
    );
  }

  return (
    <main style={{ display: 'grid', gap: 16 }}>
      <section
        style={{
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 8,
          padding: 18,
          background: 'linear-gradient(135deg, rgba(20,184,166,0.14), rgba(250,204,21,0.08))'
        }}
      >
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1.25fr) minmax(260px, 0.75fr)' }}>
          <div>
            <p style={{ margin: '0 0 6px', color: '#a7f3d0' }}>Champion Demo Case</p>
            <h1 style={{ margin: 0 }}>{showcase.case.title}</h1>
            <p style={{ maxWidth: 760 }}>
              用真实样例视频抽取结构，再迁移到少素材的新商品 brief；页面把 P0 闭环和评分证据集中在一个演示路径里。
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={handleRunDemo} disabled={running}>
                {running ? '演示链路运行中...' : timeline.length ? '重新运行冠军 demo' : '一键运行冠军 demo'}
              </button>
              <a href="/result">查看结果页 →</a>
            </div>
            {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
          </div>

          <DemoCaseCard showcase={showcase} />
        </div>
      </section>

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Metric label="真实解析" value={videoAnalysis?.analysisSource === 'real_ffmpeg' ? '已完成' : '待运行'} detail={videoAnalysis ? `${videoAnalysis.keyframes.length} keyframes` : showcase.case.seedFilename} />
        <Metric label="结构槽位" value={structureGraph ? String(structureGraph.shotSlots.length) : '0'} detail={structureGraph?.structureSummary ?? '等待结构图谱'} />
        <Metric label="素材缺口" value={String(materialGaps.length)} detail={repairs.length ? `${repairs.length} repairs` : '等待缺口识别'} />
        <Metric label="结果时间线" value={String(timeline.length)} detail={qualityReport ? `quality ${qualityReport.structureMatch.toFixed(2)}` : '等待生成'} />
      </section>

      <section className="card">
        <h2>迁移链路</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {showcase.steps.map((step) => (
            <article
              key={step.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(0, 1fr) 140px',
                gap: 12,
                alignItems: 'center',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: 12,
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              <StatusBadge status={statuses[step.id] ?? 'pending'} />
              <div style={{ overflowWrap: 'anywhere' }}>
                <strong>{step.label}</strong>
                <p style={{ margin: '4px 0' }}>{step.judgeSignal}</p>
                <small>{step.output}</small>
              </div>
              <a href={step.route}>{step.route}</a>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>评分证据链</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {showcase.scoreEvidence.map((item) => (
            <article
              key={item.taskId}
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: 12,
                background: 'rgba(15,23,42,0.36)'
              }}
            >
              <strong>
                {item.taskId} · {item.taskName}
              </strong>
              <p style={{ margin: '8px 0' }}>{item.evidence}</p>
              <small>
                {item.points} 分 · {item.route}
              </small>
            </article>
          ))}
        </div>
      </section>

      {timeline.length ? <ResultSnapshot timeline={timeline} qualityReport={qualityReport} gaps={materialGaps} repairs={repairs} /> : null}
    </main>
  );
}

function DemoCaseCard({ showcase }: { showcase: DemoShowcase }) {
  return (
    <aside
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: 14,
        background: 'rgba(2,6,23,0.42)'
      }}
    >
      <strong>{showcase.case.productName}</strong>
      <p>{showcase.case.targetAudience} · {showcase.case.scenario}</p>
      <p>{showcase.case.sellingPoints.join(' / ')}</p>
      <p style={{ color: '#fde68a' }}>{showcase.case.assetBrief}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {showcase.case.assetFiles.map((asset) => (
          <figure key={asset.filename} style={{ margin: 0 }}>
            <img
              src={mediaUrl(asset.publicUrl)}
              alt={asset.displayName}
              style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 6 }}
            />
            <figcaption style={{ marginTop: 4, fontSize: 12, color: '#cbd5e1' }}>{asset.displayName}</figcaption>
          </figure>
        ))}
      </div>
    </aside>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: 14,
        background: 'rgba(255,255,255,0.05)',
        minHeight: 100
      }}
    >
      <small>{label}</small>
      <strong style={{ display: 'block', fontSize: 28, marginTop: 8 }}>{value}</strong>
      <p style={{ margin: '8px 0 0', overflowWrap: 'anywhere' }}>{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: DemoStatus }) {
  const labels: Record<DemoStatus, string> = {
    pending: '等待',
    running: '运行中',
    done: '完成',
    error: '异常'
  };
  const colors: Record<DemoStatus, string> = {
    pending: '#94a3b8',
    running: '#fde68a',
    done: '#86efac',
    error: '#fca5a5'
  };

  return <span style={{ color: colors[status], fontWeight: 700 }}>{labels[status]}</span>;
}

function ResultSnapshot({
  timeline,
  qualityReport,
  gaps,
  repairs
}: {
  timeline: TimelineItem[];
  qualityReport: QualityReport | null;
  gaps: MaterialGap[];
  repairs: GapRepair[];
}) {
  return (
    <section className="card">
      <h2>最终结果快照</h2>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)' }}>
        <div
          style={{
            aspectRatio: '9 / 16',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#f8fafc',
            color: '#0f172a',
            border: '1px solid rgba(255,255,255,0.16)'
          }}
        >
          {timeline.slice(0, 6).map((item, index) => (
            <div
              key={item.id}
              style={{
                minHeight: `${100 / Math.min(timeline.length, 6)}%`,
                padding: 12,
                display: 'grid',
                alignContent: 'center',
                gap: 6,
                background: index % 2 === 0 ? '#ecfeff' : '#fff7ed',
                borderBottom: '1px solid rgba(15,23,42,0.12)'
              }}
            >
              <strong>{item.packaging.cardType ?? item.segmentRole}</strong>
              <span>{item.script}</span>
              <small>{item.visualAction}</small>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div>
            <strong>质量自检</strong>
            <p>
              {qualityReport
                ? `结构匹配 ${qualityReport.structureMatch.toFixed(2)} · 素材覆盖 ${qualityReport.slotCoverage.toFixed(2)} · 连贯性 ${qualityReport.coherence.toFixed(2)}`
                : '等待质量报告'}
            </p>
          </div>
          <div>
            <strong>缺口与补全</strong>
            <p>
              {gaps.length} 个 gap · {repairs.map((repair) => repair.strategy).join(' / ') || '暂无 repair'}
            </p>
          </div>
          <div>
            <strong>时间线追溯</strong>
            <ol>
              {timeline.slice(0, 5).map((item) => (
                <li key={item.id}>
                  {item.sourceSegmentId} → {item.slotId} → {item.assetId ?? item.repair?.strategy ?? 'packaging'}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

function initialStatuses(steps: DemoShowcaseStep[]): Record<string, DemoStatus> {
  return allStatuses(steps, 'pending');
}

function allStatuses(steps: DemoShowcaseStep[], status: DemoStatus): Record<string, DemoStatus> {
  return Object.fromEntries(steps.map((step) => [step.id, status]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
