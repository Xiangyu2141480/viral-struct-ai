'use client';

import { useEffect, useState } from 'react';
import type { VideoAnalysis, ViralStructureGraph } from '@viral-struct/shared';
import { apiPost } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';

interface StructureResponse {
  structureGraph: ViralStructureGraph;
}

const defaultNodes = [
  ['Hook', '强标题 + 快切，制造注意力'],
  ['痛点', '指出普通方案问题'],
  ['卖点', '商品特写 + 卖点卡'],
  ['证明', '对比卡 / 数据卡'],
  ['CTA', '结尾行动卡']
];

export function StructureGraphMock() {
  const videoAnalysis = useWorkflowStore((state) => state.videoAnalysis);
  const structureGraph = useWorkflowStore((state) => state.structureGraph);
  const setStructureGraph = useWorkflowStore((state) => state.setStructureGraph);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extractGraph(analysis: VideoAnalysis | null) {
    setLoading(true);
    setError(null);

    try {
      const result = await apiPost<StructureResponse>('/api/structure/extract', {
        videoAnalysis: analysis
      });
      setStructureGraph(result.structureGraph);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (videoAnalysis && !structureGraph && !loading) {
      void extractGraph(videoAnalysis);
    }
  }, [videoAnalysis, structureGraph, loading]);

  const graph = structureGraph;

  return (
    <section className="card">
      <h1>步骤 2：Viral Structure Graph</h1>
      <p>从样例解析结果抽取可迁移结构、镜头槽位和 creativeIngredients，而不是复制样例内容。</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>当前样例</strong>
        <p>
          {videoAnalysis
            ? `${videoAnalysis.metadata.videoId} · ${formatSeconds(videoAnalysis.metadata.duration)} · ${videoAnalysis.metadata.aspectRatio}`
            : '尚未解析样例视频；当前展示默认 mock 视图，也可以抽取 mock fallback。'}
        </p>
        <button type="button" onClick={() => extractGraph(videoAnalysis)} disabled={loading}>
          {loading ? '抽取中...' : graph ? '重新抽取结构' : '抽取结构图谱'}
        </button>
        {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
      </div>

      {graph ? (
        <>
          <GraphSummary graph={graph} videoAnalysis={videoAnalysis} />
          <SegmentStrip graph={graph} />
          <SlotTable graph={graph} />
          <CreativeIngredients graph={graph} />
        </>
      ) : (
        <DefaultGraphView />
      )}

      <p style={{ marginTop: 16 }}>
        <a href="/adapt">输入新商品和用户素材 →</a>
      </p>
    </section>
  );
}

function DefaultGraphView() {
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {defaultNodes.map((node, index) => (
          <div className="card" key={node[0]} style={{ width: 180 }}>
            <strong>
              {index + 1}. {node[0]}
            </strong>
            <p>{node[1]}</p>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 16 }}>默认视图用于无 M1 分析结果时兜底展示。</p>
    </>
  );
}

function GraphSummary({
  graph,
  videoAnalysis
}: {
  graph: ViralStructureGraph;
  videoAnalysis: VideoAnalysis | null;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>结构摘要</h2>
      <p>{graph.structureSummary}</p>
      <ul>
        <li>结构来源：{videoAnalysis ? 'M1 VideoAnalysis 规则抽取' : 'Mock fallback'}</li>
        <li>视频类型：{graph.meta.videoType}</li>
        <li>风格：{graph.meta.style}</li>
        <li>节奏：{graph.rhythm.cutFrequency} · 平均镜头 {formatSeconds(graph.rhythm.avgShotDuration)}</li>
        <li>包装：{graph.packaging.titleStyle} · 字幕密度 {graph.packaging.captionDensity}</li>
      </ul>
    </div>
  );
}

function SegmentStrip({ graph }: { graph: ViralStructureGraph }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
      {graph.segments.map((segment, index) => (
        <article className="card" key={segment.id} style={{ width: 220 }}>
          <strong>
            {index + 1}. {segment.role}
          </strong>
          <p>{segment.caption}</p>
          <p>
            {formatSeconds(segment.start)} - {formatSeconds(segment.end)}
          </p>
          <small>{segment.purpose}</small>
          <br />
          <small>{segment.transferRule}</small>
        </article>
      ))}
    </div>
  );
}

function SlotTable({ graph }: { graph: ViralStructureGraph }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>结构槽位</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">槽位</th>
            <th align="left">需要素材</th>
            <th align="left">关键要素</th>
            <th align="left">Fallback</th>
          </tr>
        </thead>
        <tbody>
          {graph.shotSlots.map((slot) => (
            <tr key={slot.id}>
              <td style={{ padding: 8 }}>{slot.role}</td>
              <td style={{ padding: 8 }}>
                {slot.requiredAsset.type} · {slot.requiredAsset.subject}
              </td>
              <td style={{ padding: 8 }}>{slot.visualIngredientRequirements?.join(' / ') || '无'}</td>
              <td style={{ padding: 8 }}>{slot.fallbackStrategies.join(' / ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CreativeIngredients({ graph }: { graph: ViralStructureGraph }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h2>爆款视频要素</h2>
      <p>creativeIngredients 描述中性的画面创作条件、动作方式、场景风格和信任建立方式，不做颜值或敏感属性判断。</p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {graph.creativeIngredients.map((ingredient) => (
          <article
            key={ingredient.id}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: 14,
              background: 'rgba(255,255,255,0.04)'
            }}
          >
            <strong>{ingredient.name}</strong>
            <p style={{ margin: '8px 0' }}>{ingredient.description}</p>
            <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
              <div><dt>类型</dt><dd>{ingredient.type}</dd></div>
              <div><dt>迁移条件</dt><dd>{ingredient.transferability}</dd></div>
              <div><dt>缺失补全</dt><dd>{ingredient.fallbackStrategies.join(' / ')}</dd></div>
              <div><dt>置信度</dt><dd>{ingredient.confidence}</dd></div>
              <div>
                <dt>证据</dt>
                <dd>
                  {ingredient.evidence.map((evidence) => (
                    <div key={`${ingredient.id}-${evidence.type}-${evidence.value}`}>
                      {evidence.type} · {evidence.value}
                    </div>
                  ))}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
