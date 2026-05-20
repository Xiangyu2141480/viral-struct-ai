const nodes = [
  ['Hook', '强标题 + 快切，制造注意力'],
  ['痛点', '指出普通方案问题'],
  ['卖点', '商品特写 + 卖点卡'],
  ['证明', '对比卡 / 数据卡'],
  ['CTA', '结尾行动卡']
];

const ingredients = [
  {
    name: '真人博主近脸出镜',
    type: 'human_presence / face_closeup',
    segments: 'Hook / 卖点 / CTA',
    value: '建立亲近感和可信度，让口播不只是字幕说明。',
    transfer: '需要用户提供授权真人口播或近脸演示素材。',
    repair: 'ask_user_for_human_demo / product_closeup_replacement / caption_rewrite'
  },
  {
    name: '上脸试用展示',
    type: 'beauty_demo / makeup_application',
    segments: '使用过程 / 证明',
    value: '用真实动作和结果展示支撑卖点，而不是空泛口号。',
    transfer: '需要上脸、手部试色或使用前后素材。',
    repair: 'hand_demo / swatch_card / before_after_card / caption_rewrite'
  },
  {
    name: '柔光高亮画面',
    type: 'soft_light / clean_background',
    segments: 'Hook / 商品特写 / 证明',
    value: '提升肤质、产品质感和整体审美一致性。',
    transfer: '可由拍摄条件提供，也可通过包装和滤镜建议重建。',
    repair: 'style_filter_suggestion / product_closeup_replacement'
  }
];

export function StructureGraphMock() {
  return (
    <section className="card">
      <h1>步骤 2：Viral Structure Graph</h1>
      <p>这里展示从样例中抽取的可迁移结构，而不是复制样例内容。</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {nodes.map((node, index) => (
          <div className="card" key={node[0]} style={{ width: 180 }}>
            <strong>{index + 1}. {node[0]}</strong>
            <p>{node[1]}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <h2>爆款视频要素</h2>
        <p>
          creativeIngredients 描述中性的画面创作条件、人设出镜方式、动作方式、场景风格和信任建立方式，不做颜值评分。
        </p>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {ingredients.map((ingredient) => (
            <article
              key={ingredient.name}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                padding: 14,
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              <strong>{ingredient.name}</strong>
              <p style={{ margin: '8px 0' }}>{ingredient.value}</p>
              <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
                <div><dt>类型</dt><dd>{ingredient.type}</dd></div>
                <div><dt>出现段落</dt><dd>{ingredient.segments}</dd></div>
                <div><dt>迁移条件</dt><dd>{ingredient.transfer}</dd></div>
                <div><dt>缺失补全</dt><dd>{ingredient.repair}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </div>
      <p style={{ marginTop: 16 }}>
        <a href="/adapt">输入新商品和用户素材 →</a>
      </p>
    </section>
  );
}
