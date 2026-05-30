import type { DemoEstimate, DemoEstimateMetric } from '@viral-struct/shared';

export function DemoAnalyticsPanel({ estimate }: { estimate: DemoEstimate | null }) {
  if (!estimate) {
    return null;
  }

  const metrics: Array<[string, DemoEstimateMetric]> = [
    ['Viral Potential Score', estimate.metrics.viralPotential],
    ['Template Fit Score', estimate.metrics.templateFit],
    ['Gap Repair Coverage', estimate.metrics.gapRepairCoverage],
    ['Evidence Confidence', estimate.metrics.evidenceConfidence],
    ['Variant Distinctiveness', estimate.metrics.variantDistinctiveness],
    ['Estimated CTR Lift', estimate.metrics.estimatedCtrLift]
  ];

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Demo Analytics</h2>
      <p style={{ color: '#fbbf24', fontWeight: 700 }}>
        {estimate.disclaimer}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {metrics.map(([name, metric]) => (
          <article
            key={name}
            style={{
              border: '1px solid rgba(148, 163, 184, 0.24)',
              borderRadius: 8,
              padding: 12,
              background: 'rgba(15,23,42,0.35)'
            }}
          >
            <strong>{name}</strong>
            <p style={{ fontSize: 28, margin: '8px 0', fontWeight: 800 }}>
              {metric.simulated ? metric.label : `${metric.score.toFixed(1)}`}
            </p>
            {!metric.simulated ? <p style={{ margin: '0 0 8px', color: '#94a3b8' }}>{metric.label}</p> : null}
            <p style={{ margin: 0 }}>{metric.explanation}</p>
            {metric.formula ? <p style={{ marginTop: 8, color: '#94a3b8', fontSize: 12 }}>Formula: {metric.formula}</p> : null}
          </article>
        ))}
      </div>
      {estimate.warnings.length ? (
        <div style={{ marginTop: 12, color: '#fde68a' }}>
          <strong>Estimate Notes</strong>
          <ul>
            {estimate.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
