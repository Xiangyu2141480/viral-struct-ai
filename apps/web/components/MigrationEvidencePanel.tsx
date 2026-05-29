'use client';

import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  SlotMatch,
  StoryboardShot,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { buildMigrationEvidenceRows } from '../lib/migrationEvidence';

export function MigrationEvidencePanel({
  structureGraph,
  contentBrief,
  assetCards,
  slotMatches,
  materialGaps,
  repairs,
  timeline,
  storyboard
}: {
  structureGraph: ViralStructureGraph | null;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  timeline: TimelineItem[];
  storyboard: StoryboardShot[];
}) {
  const rows = buildMigrationEvidenceRows({
    structureGraph,
    contentBrief,
    assetCards,
    slotMatches,
    materialGaps,
    repairs,
    timeline,
    storyboard
  });

  if (!rows.length) {
    return null;
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Migration Evidence</h2>
      <p>
        结构迁移证据链：样例结构 → 新内容映射 → 素材覆盖 / 缺口 → 补全策略 → 最终 timeline。
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map((row) => (
          <article
            key={row.id}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: 12,
              background: 'rgba(15,23,42,0.36)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <strong>
                #{row.order} · {row.source.segmentRole} · {row.source.slotRole}
              </strong>
              <span style={{ color: row.gap.hasGap ? '#fde68a' : '#86efac', fontWeight: 700 }}>
                {row.gap.hasGap ? 'Gap repaired' : 'Asset covered'}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10
              }}
            >
              <EvidenceCell
                title="样例结构"
                lines={[
                  `Segment: ${row.source.segmentId}`,
                  `Intent: ${row.source.intent}`,
                  `Source pattern: ${row.source.sourceInstance}`,
                  `Accepts: ${row.source.acceptanceCriteria}`
                ]}
              />
              <EvidenceCell
                title="迁移到新内容"
                lines={[
                  row.mapping.summary,
                  `Selling point: ${row.mapping.sellingPoint}`,
                  `Rationale: ${row.mapping.rationale}`
                ]}
              />
              <EvidenceCell
                title="素材覆盖 / 缺口"
                lines={[
                  `Asset: ${row.asset.assetId}`,
                  `${row.asset.assetType} · ${row.asset.assetLabel}`,
                  `Match: ${row.asset.status} · ${row.asset.score}`,
                  row.gap.hasGap ? `Gap: ${row.gap.type}` : 'Gap: none'
                ]}
              />
              <EvidenceCell
                title="缺口补全"
                lines={[
                  `Strategy: ${row.repair.strategy}`,
                  `Reason: ${row.repair.explanation}`,
                  `Spec: ${row.repair.spec}`
                ]}
              />
              <EvidenceCell
                title="最终生成"
                lines={[
                  `${row.final.timelineId} · ${row.final.duration}`,
                  `Script: ${row.final.script}`,
                  `Visual: ${row.final.visual}`,
                  `Packaging: ${row.final.packaging}`
                ]}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EvidenceCell({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <strong style={{ display: 'block', marginBottom: 6, color: '#bfdbfe' }}>{title}</strong>
      {lines.map((line) => (
        <p key={line} style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>
          {line || 'Not available'}
        </p>
      ))}
    </div>
  );
}
