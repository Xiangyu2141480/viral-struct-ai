const gaps = [
  ['开头吸引镜头', '缺失', '标题卡 + 产品图推近'],
  ['商品特写', '可用', '产品图直接使用'],
  ['使用过程镜头', '部分可用', '手持图裁切 + 步骤字幕'],
  ['对比镜头', '缺失', '左右对比卡片'],
  ['CTA 镜头', '可补全', '结尾行动卡']
];

export function GapBoard() {
  return (
    <section className="card">
      <h1>步骤 4：素材缺口识别与补全</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">结构槽位</th>
            <th align="left">状态</th>
            <th align="left">补全策略</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap) => (
            <tr key={gap[0]}>
              <td style={{ padding: 8 }}>{gap[0]}</td>
              <td style={{ padding: 8 }}>{gap[1]}</td>
              <td style={{ padding: 8 }}>{gap[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><a href="/result">生成脚本、分镜和时间线 →</a></p>
    </section>
  );
}
