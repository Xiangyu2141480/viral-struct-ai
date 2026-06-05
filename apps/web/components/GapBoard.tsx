'use client';

import { useState } from 'react';
import type { GapRepair, GapSpecSource, MaterialGap, SlotAlignmentSource, SlotMatch } from '@viral-struct/shared';
import { apiPost } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';
import { GenerationTracePanel, PipelineSourceBadge, PipelineWarningCallout } from './PipelineStatus';

interface MatchResponse {
  matches: SlotMatch[];
  gaps: MaterialGap[];
  alignmentSource?: SlotAlignmentSource;
  warning?: string;
  warnings?: string[];
}

interface RepairResponse {
  repairs: GapRepair[];
  gapSpecSource?: GapSpecSource;
  warning?: string;
  warnings?: string[];
}

export function GapBoard() {
  const structureGraph = useWorkflowStore((state) => state.structureGraph);
  const contentBrief = useWorkflowStore((state) => state.contentBrief);
  const assetCards = useWorkflowStore((state) => state.assetCards);
  const slotMatches = useWorkflowStore((state) => state.slotMatches);
  const materialGaps = useWorkflowStore((state) => state.materialGaps);
  const repairs = useWorkflowStore((state) => state.repairs);
  const pipelineTrace = useWorkflowStore((state) => state.pipelineTrace);
  const setSlotResult = useWorkflowStore((state) => state.setSlotResult);
  const setRepairs = useWorkflowStore((state) => state.setRepairs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDetectGaps() {
    if (!structureGraph) {
      setError('请先在结构图谱页抽取 ViralStructureGraph。');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const matchResult = await apiPost<MatchResponse>('/api/slots/match', {
        structureGraph,
        assetCards,
        boundaries: structureGraph.boundaries
      });
      setSlotResult(matchResult.matches, matchResult.gaps, {
        alignmentSource: matchResult.alignmentSource,
        warnings: collectWarnings(matchResult)
      });

      const repairResult = await apiPost<RepairResponse>('/api/gaps/repair', {
        gaps: matchResult.gaps,
        assetCards,
        newContent: contentBrief,
        structureGraph,
        boundaries: structureGraph.boundaries
      });
      setRepairs(repairResult.repairs, {
        gapSpecSource: repairResult.gapSpecSource,
        warnings: collectWarnings(repairResult)
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h1>步骤 4：素材缺口识别与补全</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <p>
          当前结构槽位：{structureGraph?.shotSlots.length ?? 0} 个 · 当前素材：{assetCards.length} 个
        </p>
        <button type="button" onClick={handleDetectGaps} disabled={loading || !structureGraph}>
          {loading ? '识别中...' : slotMatches.length ? '重新识别缺口' : '识别槽位匹配与素材缺口'}
        </button>
        {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      </div>

      {slotMatches.length ? <MatchTable matches={slotMatches} /> : <p>尚未识别。点击按钮后会调用 `/api/slots/match`。</p>}
      {(slotMatches.length || repairs.length) ? (
        <GenerationTracePanel
          alignmentSource={pipelineTrace.alignmentSource}
          gapSpecSource={pipelineTrace.gapSpecSource}
          warnings={pipelineTrace.warnings}
          qualityContext={`${assetCards.length} assets · ${structureGraph?.shotSlots.length ?? 0} slots`}
        />
      ) : null}
      {materialGaps.length ? (
        <GapList gaps={materialGaps} repairs={repairs} gapSpecSource={pipelineTrace.gapSpecSource} warnings={pipelineTrace.warnings} />
      ) : null}

      {repairs.length ? (
        <p>
          <a href="/result">生成脚本、分镜和时间线 →</a>
        </p>
      ) : null}
    </section>
  );
}

function MatchTable({ matches }: { matches: SlotMatch[] }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>槽位匹配</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">槽位</th>
            <th align="left">状态</th>
            <th align="left">素材</th>
            <th align="left">分数</th>
            <th align="left">来源</th>
            <th align="left">原因</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.slotId}>
              <td style={{ padding: 8 }}>{match.slotId}</td>
              <td style={{ padding: 8 }}>{match.status}</td>
              <td style={{ padding: 8 }}>{match.assetId ?? '无'}</td>
              <td style={{ padding: 8 }}>{match.score.toFixed(2)}</td>
              <td style={{ padding: 8 }}>
                {match.alignmentSource === 'llm_judge' ? 'LLM Judge' : match.alignmentSource === 'rule_based' ? 'Rule-based' : 'Unknown'}
              </td>
              <td style={{ padding: 8 }}>{match.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GapList({
  gaps,
  repairs,
  gapSpecSource,
  warnings
}: {
  gaps: MaterialGap[];
  repairs: GapRepair[];
  gapSpecSource?: GapSpecSource;
  warnings: string[];
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <h2>要素缺口与补全策略</h2>
      <p>这里展示 creativeIngredients 如何参与素材适配：系统识别的是创作要素，不评价人的外貌。</p>
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        <PipelineSourceBadge label="Gap repair" kind="gap" source={gapSpecSource} />
        <PipelineWarningCallout warnings={warnings} />
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {gaps.map((gap) => {
          const repair = repairs.find((item) => item.slotId === gap.slotId);
          return (
            <article
              key={gap.slotId}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: 14,
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              <strong>
                {gap.role} · {gap.type ?? 'missing_visual_ingredient'} · {gap.severity}
              </strong>
              <p>影响段落：{gap.affectedSegmentId ?? gap.slotId}</p>
              <p>缺口原因：{gap.reason}</p>
              <p>缺失要素：{gap.missingIngredients?.join(' / ') || '无'}</p>
              <p>补全来源：{gapSpecSource === 'llm_generated' ? 'LLM Gap Spec' : gapSpecSource === 'rule_based' ? 'Rule-based repair' : 'Not run'}</p>
              <p>补全策略：{repair ? `${repair.strategy} · ${repair.explanation}` : '待生成'}</p>
              {repair?.gapSpec ? (
                <p>
                  拍摄规格：{repair.gapSpec.ideal ?? repair.gapSpec.minimalAcceptable ?? repair.gapSpec.alternativeIfNoShoot}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectWarnings(response: { warning?: string; warnings?: string[] }): string[] {
  return [...(response.warnings ?? []), response.warning].filter((warning): warning is string => Boolean(warning));
}
