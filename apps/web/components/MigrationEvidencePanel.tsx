'use client';

import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  MissingMaterialGenerationJob,
  SlotMatch,
  StoryboardShot,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { buildMigrationEvidenceRows } from '../lib/migrationEvidence';
import { useGsapReveal } from '../lib/useGsapReveal';

export function MigrationEvidencePanel({
  structureGraph,
  contentBrief,
  assetCards,
  slotMatches,
  materialGaps,
  repairs,
  missingMaterialJobs = [],
  timeline,
  storyboard
}: {
  structureGraph: ViralStructureGraph | null;
  contentBrief: ContentBrief;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
  missingMaterialJobs?: MissingMaterialGenerationJob[];
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

  const revealRef = useGsapReveal<HTMLDivElement>({
    selector: '[data-evidence-row]',
    dependencyKey: rows.map((row) => row.id).join('|')
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
      <div ref={revealRef} style={{ display: 'grid', gap: 12 }}>
        {rows.map((row) => (
          <EvidenceRow key={row.id} row={row} job={findJob(row, missingMaterialJobs)} />
        ))}
      </div>
    </section>
  );
}

function EvidenceRow({
  row,
  job
}: {
  row: ReturnType<typeof buildMigrationEvidenceRows>[number];
  job?: MissingMaterialGenerationJob;
}) {
  const gapPulseRef = useGsapReveal<HTMLElement>({
    mode: 'pulse',
    dependencyKey: row.gap.hasGap ? `${row.id}:${row.repair.strategy}` : row.id,
    disabled: !row.gap.hasGap,
    stagger: false
  });

  return (
    <article
      ref={gapPulseRef}
      data-evidence-row="true"
      data-gap-repair={row.gap.hasGap ? 'true' : 'false'}
      style={{
        border: row.gap.hasGap ? '1px solid rgba(253,230,138,0.28)' : '1px solid rgba(255,255,255,0.12)',
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
            `Spec: ${row.repair.spec}`,
            job ? `Generation job: ${job.status} · ${job.mode} · ${job.providerLabel}` : 'Generation job: Not planned'
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
  );
}

function findJob(
  row: ReturnType<typeof buildMigrationEvidenceRows>[number],
  jobs: MissingMaterialGenerationJob[]
): MissingMaterialGenerationJob | undefined {
  return jobs.find((job) => job.gapId === row.source.slotId || job.timelineItemId === row.final.timelineId);
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
