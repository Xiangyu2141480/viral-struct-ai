const rows = [
  ['P0 基础闭环', '样例解析、结构拆解、结构迁移', '25'],
  ['P0 素材缺口', '槽位级识别 + 补全策略', '20'],
  ['P0 展示验证', '迁移可视化 + demo', '20'],
  ['P1 进阶创作', '包装、多版本、真实素材适配', '20'],
  ['人机协同', '参数调整 + 自然语言改片', '15']
];

export function ScoreMap() {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>评分覆盖地图</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              <td style={{ padding: 8 }}>{row[0]}</td>
              <td style={{ padding: 8 }}>{row[1]}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{row[2]} 分</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
