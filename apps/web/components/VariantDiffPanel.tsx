'use client';

import type { ContentBrief, TimelineItem } from '@viral-struct/shared';
import type { GenerationVariant } from '../lib/workflowStore';

const variantCopy: Record<GenerationVariant, {
  label: string;
  goal: string;
  changes: string[];
}> = {
  high_click: {
    label: '高点击版',
    goal: '前 3 秒抢停留，用更强 hook、更快节奏和更醒目的字幕制造点击理由。',
    changes: [
      'Hook 更强：直接抛出场景痛点或结果感。',
      '节奏更快：使用 quick_cut / push_in，字幕切得更密。',
      '包装更醒目：标题卡和强字幕优先，适合信息流首屏。'
    ]
  },
  high_conversion: {
    label: '高转化版',
    goal: '降低决策成本，把商品、核心卖点和 CTA 更早、更明确地推到观众面前。',
    changes: [
      '商品信息提前：hook 直接给结论和第一卖点。',
      '购买理由集中：卖点表达更完整，证明和对比更靠前。',
      'CTA 更明确：结尾使用更强行动指令。'
    ]
  },
  premium: {
    label: '高质感版',
    goal: '减少信息压迫，用更克制的字幕、转场和画面节奏建立高级感。',
    changes: [
      '字幕更少：长句保留更多完整语义，降低字幕密度。',
      '节奏更稳：以 fade / push_in 为主，弱化强促销感。',
      '包装更克制：减少卖点卡堆叠，强调质感描述和留白。'
    ]
  }
};

export function VariantDiffPanel({
  variant,
  timeline,
  contentBrief
}: {
  variant: GenerationVariant;
  timeline: TimelineItem[];
  contentBrief: ContentBrief;
}) {
  if (!timeline.length) return null;

  const copy = variantCopy[variant];
  const hook = timeline.find((item) => item.segmentRole === 'hook') ?? timeline[0];
  const cta = [...timeline].reverse().find((item) => item.segmentRole === 'cta') ?? timeline.at(-1);
  const transitions = Array.from(new Set(timeline.map((item) => item.packaging.transition).filter(Boolean))).join(' / ') || 'Not available';
  const motions = Array.from(new Set(timeline.map((item) => item.packaging.motion).filter(Boolean))).join(' / ') || 'Not available';
  const captionStyles = Array.from(new Set(timeline.map((item) => item.packaging.captionStyle).filter(Boolean))).join(' / ') || 'Not available';
  const avgSubtitleLines = timeline.reduce((sum, item) => sum + item.subtitles.length, 0) / Math.max(timeline.length, 1);

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Variant Diff</h2>
      <p>
        当前版本：<strong>{copy.label}</strong> · {copy.goal}
      </p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <DiffCard title="策略变化" lines={copy.changes} />
        <DiffCard
          title="Hook / CTA"
          lines={[
            `Hook: ${hook?.script ?? 'Not available'}`,
            `CTA: ${cta?.script ?? contentBrief.cta}`,
            `商品卖点: ${contentBrief.sellingPoints.slice(0, 3).join(' / ') || 'Not available'}`
          ]}
        />
        <DiffCard
          title="节奏 / 包装"
          lines={[
            `Transition: ${transitions}`,
            `Motion: ${motions}`,
            `Caption style: ${captionStyles}`,
            `Avg subtitle lines: ${avgSubtitleLines.toFixed(1)}`
          ]}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <strong>Adjusted timeline items</strong>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {timeline.slice(0, 5).map((item) => (
            <article
              key={item.id}
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: 10,
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              <strong>{item.id} · {item.segmentRole}</strong>
              <p style={{ margin: '6px 0' }}>{item.script}</p>
              <small>
                {item.packaging.cardType ?? 'no card'} · {item.packaging.transition ?? 'no transition'} · {item.packaging.motion ?? 'no motion'}
              </small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DiffCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <article
      style={{
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: 12,
        background: 'rgba(15,23,42,0.36)'
      }}
    >
      <strong style={{ display: 'block', marginBottom: 8 }}>{title}</strong>
      {lines.map((line) => (
        <p key={line} style={{ margin: '6px 0', overflowWrap: 'anywhere' }}>
          {line}
        </p>
      ))}
    </article>
  );
}
