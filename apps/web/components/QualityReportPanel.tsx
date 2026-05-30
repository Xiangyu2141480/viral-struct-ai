'use client';

import type { QualityReport } from '@viral-struct/shared';
import { useWorkflowStore } from '../lib/workflowStore';
import { AnimatedScore } from './AnimatedScore';

export function QualityReportPanel() {
  const qualityReport = useWorkflowStore((state) => state.qualityReport);

  return (
    <section className="card">
      <h2>质量自检面板</h2>
      {qualityReport ? <QualityTable report={qualityReport} /> : <p>生成结果后会调用 `/api/quality/evaluate` 产出质量自检。</p>}
    </section>
  );
}

function QualityTable({ report }: { report: QualityReport }) {
  const metrics: Array<[string, number, string]> = [
    ['结构匹配度', report.structureMatch, '保留样例 Hook-痛点-卖点-证明-CTA 的迁移结构'],
    ['素材覆盖率', report.slotCoverage, '按 matched / partial / missing 计算槽位覆盖'],
    ['画文一致性', report.visualScriptAlignment, '检查画面动作和脚本文案是否对应'],
    ['事实性', report.factuality, '卖点主要来自用户输入，避免无来源强承诺'],
    ['连贯性', report.coherence, '时间线段落顺序与表达推进是否顺畅'],
    ['字幕可读性', report.subtitleReadability, '字幕长度与节奏是否适合短视频']
  ];

  if (report.transitionFidelity !== undefined) {
    metrics.push([
      '转场保真度',
      report.transitionFidelity,
      '源视频 boundary micro scan 的转场类型与生成时间线包装转场的一致性'
    ]);
  }

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric[0]}>
              <td style={{ padding: 8 }}>{metric[0]}</td>
              <td style={{ padding: 8, fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>
                <AnimatedScore value={metric[1]} decimals={2} />
              </td>
              <td style={{ padding: 8 }}>{metric[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.warnings.length ? (
        <div style={{ marginTop: 12, color: '#fde68a' }}>
          <strong>风险提示</strong>
          <ul>
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
