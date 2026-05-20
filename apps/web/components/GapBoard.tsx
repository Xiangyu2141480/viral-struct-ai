const gaps = [
  ['开头吸引镜头', '缺失', '标题卡 + 产品图推近'],
  ['商品特写', '可用', '产品图直接使用'],
  ['使用过程镜头', '部分可用', '手持图裁切 + 步骤字幕'],
  ['对比镜头', '缺失', '左右对比卡片'],
  ['CTA 镜头', '可补全', '结尾行动卡']
];

const ingredientGaps = [
  {
    ingredient: '真人博主近脸上脸试用',
    affected: '使用过程 / 证明',
    current: '当前只有产品图、手持图和商品文案，没有人物出镜、脸部近景或上脸动作。',
    repair: '优先让用户补充授权上脸试用视频；无法补拍时降级为手部试色 + 产品特写 + 步骤字幕。'
  },
  {
    ingredient: '妆前妆后对比',
    affected: '证明段落',
    current: '没有 before / after 图，也没有对比镜头。',
    repair: '使用 before_after_card 或 comparison_card 表达变化，并提示后续补充真实对比素材。'
  },
  {
    ingredient: '柔光高质感画面',
    affected: '商品特写 / 结果展示',
    current: '素材背景普通，缺少样例中的柔光、干净背景和高审美包装。',
    repair: '使用 style_filter_suggestion、浅色背景版式和卖点卡统一视觉风格。'
  }
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
      <div style={{ marginTop: 24 }}>
        <h2>要素缺口</h2>
        <p>这里展示 creativeIngredients 如何参与素材适配：系统识别的是创作要素，不评价人的外貌。</p>
        <div style={{ display: 'grid', gap: 12 }}>
          {ingredientGaps.map((gap) => (
            <article
              key={gap.ingredient}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                padding: 14,
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              <strong>缺失要素：{gap.ingredient}</strong>
              <p>影响段落：{gap.affected}</p>
              <p>当前素材：{gap.current}</p>
              <p>补全建议：{gap.repair}</p>
            </article>
          ))}
        </div>
      </div>
      <p><a href="/result">生成脚本、分镜和时间线 →</a></p>
    </section>
  );
}
