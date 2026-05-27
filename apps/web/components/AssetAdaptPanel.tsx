'use client';

import { useMemo, useState } from 'react';
import type { AssetCard, ContentBrief } from '@viral-struct/shared';
import { apiGet, apiPostForm, mediaUrl } from '../lib/api';
import { useWorkflowStore } from '../lib/workflowStore';

interface AssetsResponse {
  assetCards: AssetCard[];
  source?: 'upload_analysis';
}

interface AssetLibraryResponse {
  assetCards: AssetCard[];
  source: 'asset_library';
  libraryId: string;
}

const DEMO_LIBRARY_ID = 'kangshifu_demo';

export function AssetAdaptPanel() {
  const structureGraph = useWorkflowStore((state) => state.structureGraph);
  const contentBrief = useWorkflowStore((state) => state.contentBrief);
  const assetCards = useWorkflowStore((state) => state.assetCards);
  const assetSourceDebug = useWorkflowStore((state) => state.assetSourceDebug);
  const setContentBrief = useWorkflowStore((state) => state.setContentBrief);
  const setAssetCards = useWorkflowStore((state) => state.setAssetCards);
  const [productName, setProductName] = useState(contentBrief.productName);
  const [targetAudience, setTargetAudience] = useState(contentBrief.targetAudience);
  const [scenario, setScenario] = useState(contentBrief.scenario);
  const [sellingPointsText, setSellingPointsText] = useState(contentBrief.sellingPoints.join('\n'));
  const [cta, setCta] = useState(contentBrief.cta);
  const [stylePreference, setStylePreference] = useState(contentBrief.stylePreference ?? '');
  const [textBrief, setTextBrief] = useState(
    '已有瓶身主图、动感冰爽图和组合包装图；缺少真人口播、完整开盖畅饮过程、对比镜头和 CTA 结尾镜头。'
  );
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextBrief = useMemo<ContentBrief>(
    () => ({
      productName,
      targetAudience,
      scenario,
      sellingPoints: parseSellingPoints(sellingPointsText),
      cta,
      stylePreference: stylePreference.trim() || undefined
    }),
    [cta, productName, scenario, sellingPointsText, stylePreference, targetAudience]
  );

  const canAnalyze = files.length > 0 || textBrief.trim().length > 0;

  async function handleAnalyzeAssets() {
    setLoading(true);
    setError(null);

    try {
      if (!nextBrief.productName || !nextBrief.targetAudience || !nextBrief.scenario || nextBrief.sellingPoints.length === 0 || !nextBrief.cta) {
        throw new Error('请补全商品名、目标用户、场景、卖点和 CTA。');
      }

      setContentBrief(nextBrief);

      const form = new FormData();
      files.forEach((file) => {
        form.append('assets', file);
      });
      form.append('textBrief', textBrief);
      const result = await apiPostForm<AssetsResponse>('/api/assets/analyze', form);
      setAssetCards(result.assetCards, {
        source: result.source ?? 'upload_analysis',
        label: '上传素材启发式分析'
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadDemoLibrary() {
    setLoading(true);
    setError(null);

    try {
      setContentBrief(nextBrief);
      const result = await apiGet<AssetLibraryResponse>(`/api/assets/libraries/${encodeURIComponent(DEMO_LIBRARY_ID)}`);
      setAssetCards(result.assetCards, {
        source: result.source,
        libraryId: result.libraryId,
        label: `队友 AssetCard 库：${result.libraryId}`
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h1>步骤 3：新内容与素材适配</h1>
      {!structureGraph ? (
        <p style={{ color: '#fde68a' }}>建议先到结构图谱页抽取结构；本页仍可先准备商品 brief 和素材。</p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div className="card">
          <h3>新商品 Brief</h3>
          <label style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
            <span>商品名</span>
            <input value={productName} onChange={(event) => setProductName(event.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
            <span>目标用户</span>
            <input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
            <span>使用场景</span>
            <input value={scenario} onChange={(event) => setScenario(event.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
            <span>卖点</span>
            <textarea
              value={sellingPointsText}
              onChange={(event) => setSellingPointsText(event.target.value)}
              style={{ width: '100%', minHeight: 90 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
            <span>CTA</span>
            <input value={cta} onChange={(event) => setCta(event.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>风格偏好</span>
            <input value={stylePreference} onChange={(event) => setStylePreference(event.target.value)} />
          </label>
        </div>

        <div className="card">
          <h3>上传素材</h3>
          <button type="button" onClick={handleLoadDemoLibrary} disabled={loading} style={{ marginBottom: 12 }}>
            使用康师傅 AssetCard 库
          </button>
          <p style={{ marginTop: 0 }}>
            推荐演示路径会直接读取 `seed_assets/asset_libraries/kangshifu_demo/asset_cards.json`，使用队友的素材卡协议结果。
          </p>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>图片或视频素材</span>
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            <span>文字素材 / 缺口提示</span>
            <textarea
              value={textBrief}
              onChange={(event) => setTextBrief(event.target.value)}
              style={{ width: '100%', minHeight: 120 }}
            />
          </label>
          <button type="button" onClick={handleAnalyzeAssets} disabled={loading || !canAnalyze} style={{ marginTop: 12 }}>
            {loading ? '分析中...' : '分析素材并保存'}
          </button>
          {error ? <p style={{ color: '#fca5a5' }}>{error}</p> : null}
          <p>Demo 推荐故意只提供少量冰红茶素材，以展示素材缺口能力。</p>
        </div>
      </div>

      {assetCards.length ? (
        <AssetCards cards={assetCards} sourceLabel={assetSourceDebug?.label ?? '当前素材卡'} />
      ) : (
        <p style={{ marginTop: 16 }}>尚未生成 AssetCard。提交素材后会调用 `/api/assets/analyze`。</p>
      )}
    </section>
  );
}

function AssetCards({ cards, sourceLabel }: { cards: AssetCard[]; sourceLabel: string }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>素材理解结果</h2>
      <p>{sourceLabel}</p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {cards.map((card) => (
          <article className="card" key={card.id}>
            <strong>
              {card.id} · {card.type}
            </strong>
            {card.url ? (
              <img
                src={mediaUrl(card.url)}
                alt={card.id}
                style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6, marginTop: 8 }}
              />
            ) : null}
            <p>{card.spatialDescription ?? card.text ?? '文本素材'}</p>
            <p>适配槽位：{card.suitableSlots.join(' / ') || '无'}</p>
            <p>检测要素：{card.detectedIngredients?.join(' / ') || '无'}</p>
            <p>质量分：{card.qualityScore}</p>
          </article>
        ))}
      </div>
      <p>
        <a href="/gaps">查看素材缺口 →</a>
      </p>
    </section>
  );
}

function parseSellingPoints(value: string): string[] {
  return value
    .split(/[\n,，、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
