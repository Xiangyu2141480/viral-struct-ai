const nodes = [
  ['Hook', '强标题 + 快切，制造注意力'],
  ['痛点', '指出普通方案问题'],
  ['卖点', '商品特写 + 卖点卡'],
  ['证明', '对比卡 / 数据卡'],
  ['CTA', '结尾行动卡']
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
      <p style={{ marginTop: 16 }}>
        <a href="/adapt">输入新商品和用户素材 →</a>
      </p>
    </section>
  );
}
