const metrics = [
  ['结构匹配度', '0.86', '保留 Hook-痛点-卖点-证明-CTA 结构'],
  ['素材覆盖率', '0.62', '5 个槽位中 3 个直接或部分匹配，2 个补全'],
  ['画文一致性', '0.81', '商品特写和卖点基本对应'],
  ['事实性', '0.92', '卖点主要来自用户输入'],
  ['字幕可读性', '0.88', '单条字幕长度适中']
];

export function QualityReportPanel() {
  return (
    <section className="card">
      <h2>质量自检面板</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {metrics.map((m) => (
            <tr key={m[0]}>
              <td style={{ padding: 8 }}>{m[0]}</td>
              <td style={{ padding: 8 }}>{m[1]}</td>
              <td style={{ padding: 8 }}>{m[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
