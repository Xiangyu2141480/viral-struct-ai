'use client';

import type { AssetCard, TimelineItem, ViralStructureGraph } from '@viral-struct/shared';
import { mediaUrl } from '../lib/api';

interface VisualTimelinePreviewProps {
  timeline: TimelineItem[];
  assetCards: AssetCard[];
  structureGraph?: ViralStructureGraph | null;
  compact?: boolean;
}

interface FrameSource {
  asset?: AssetCard;
  label: string;
  detail: string;
}

export function VisualTimelinePreview({ timeline, assetCards, structureGraph, compact = false }: VisualTimelinePreviewProps) {
  const assetById = new Map(assetCards.map((asset) => [asset.id, asset]));
  const slotById = new Map((structureGraph?.shotSlots ?? []).map((slot) => [slot.id, slot]));
  const frames = timeline.slice(0, compact ? 6 : 8);

  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(260px, 1fr))' : 'repeat(auto-fit, minmax(280px, 1fr))',
        alignItems: 'start'
      }}
    >
      <div
        style={{
          aspectRatio: '9 / 16',
          width: '100%',
          maxWidth: compact ? 360 : 380,
          margin: compact ? 0 : '0 auto',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#0f172a',
          boxShadow: '0 18px 48px rgba(0,0,0,0.28)'
        }}
      >
        {frames.map((item, index) => {
          const source = frameSource(item, assetById);
          return (
            <TimelineFrame
              key={item.id}
              item={item}
              source={source}
              index={index}
              total={Math.max(frames.length, 1)}
            />
          );
        })}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: 12,
            background: 'rgba(15,23,42,0.48)'
          }}
        >
          <strong>画面来源追溯</strong>
          <p style={{ margin: '8px 0 0', color: '#cbd5e1' }}>
            每个画面都对应样例结构槽位，并标记使用的素材或补全策略。
          </p>
        </div>
        <ol style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 8 }}>
          {frames.map((item) => {
            const source = frameSource(item, assetById);
            const slot = slotById.get(item.slotId);
            return (
              <li key={item.id}>
                <strong>{item.sourceSegmentId}</strong> → {item.slotId} → {source.label}
                <br />
                <small style={{ color: '#cbd5e1' }}>{source.detail}</small>
                {slot?.intent ? (
                  <>
                    <br />
                    <small style={{ color: '#a7f3d0' }}>迁移意图：{slot.intent.purpose}</small>
                  </>
                ) : null}
                {slot?.sourceInstance ? (
                  <>
                    <br />
                    <small style={{ color: '#fde68a' }}>源片实例：{slot.sourceInstance.productInSource}</small>
                  </>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function TimelineFrame({
  item,
  source,
  index,
  total
}: {
  item: TimelineItem;
  source: FrameSource;
  index: number;
  total: number;
}) {
  const imageUrl = source.asset?.url ? mediaUrl(source.asset.url) : null;
  const height = `${100 / total}%`;
  const palette = cardPalette(item.packaging.cardType, index);

  return (
    <section
      style={{
        position: 'relative',
        minHeight: height,
        overflow: 'hidden',
        borderBottom: index === total - 1 ? 'none' : '1px solid rgba(255,255,255,0.12)',
        background: imageUrl ? '#111827' : palette.background,
        color: '#f8fafc'
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={source.asset?.spatialDescription ?? item.assetId ?? item.segmentRole}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: item.repair ? 'saturate(1.08) contrast(1.05)' : 'saturate(1.02)'
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: imageUrl
            ? 'linear-gradient(180deg, rgba(2,6,23,0.18), rgba(2,6,23,0.76))'
            : 'linear-gradient(135deg, rgba(15,23,42,0.2), rgba(15,23,42,0.58))'
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100%',
          padding: 12,
          display: 'grid',
          alignContent: 'end',
          gap: 6
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge text={cardLabel(item.packaging.cardType)} color={palette.accent} />
          <Badge text={source.label} color={item.repair ? '#f97316' : '#22c55e'} />
        </div>
        <strong style={{ fontSize: 15, lineHeight: 1.25 }}>{roleLabel(item.segmentRole)}</strong>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {item.script}
        </p>
        <small style={{ color: '#e2e8f0' }}>
          {formatSeconds(item.start)} - {formatSeconds(item.end)} · {item.packaging.transition ?? 'none'} ·{' '}
          {item.packaging.motion ?? 'static'}
        </small>
      </div>
    </section>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 22,
        padding: '2px 8px',
        borderRadius: 6,
        background: color,
        color: '#0f172a',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.2
      }}
    >
      {text}
    </span>
  );
}

function frameSource(item: TimelineItem, assetById: Map<string, AssetCard>): FrameSource {
  const asset = item.assetId ? assetById.get(item.assetId) : undefined;
  if (asset) {
    return {
      asset,
      label: item.repair ? `${asset.id} + ${item.repair.strategy}` : asset.id,
      detail: asset.spatialDescription ?? asset.temporalDescription ?? '使用匹配素材'
    };
  }

  if (item.repair) {
    return {
      label: item.repair.strategy,
      detail: item.repair.explanation
    };
  }

  return {
    label: 'packaging',
    detail: item.visualAction
  };
}

function cardPalette(cardType: TimelineItem['packaging']['cardType'], index: number) {
  if (cardType === 'title_card') {
    return { background: '#7f1d1d', accent: '#fde047' };
  }

  if (cardType === 'comparison_card') {
    return { background: '#164e63', accent: '#67e8f9' };
  }

  if (cardType === 'cta_card') {
    return { background: '#3b0764', accent: '#f0abfc' };
  }

  return index % 2 === 0
    ? { background: '#92400e', accent: '#fed7aa' }
    : { background: '#14532d', accent: '#86efac' };
}

function cardLabel(cardType: TimelineItem['packaging']['cardType']): string {
  if (cardType === 'title_card') return '标题卡';
  if (cardType === 'comparison_card') return '对比卡';
  if (cardType === 'cta_card') return 'CTA 卡';
  return '卖点卡';
}

function roleLabel(role: TimelineItem['segmentRole']): string {
  const labels: Record<TimelineItem['segmentRole'], string> = {
    hook: '开头吸引',
    pain_point: '痛点铺垫',
    selling_point: '卖点推进',
    proof: '证明强化',
    usage: '使用场景',
    comparison: '对比证明',
    cta: '行动召唤'
  };
  return labels[role];
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))}s`;
}
