export function AssetAdaptPanel() {
  return (
    <section className="card">
      <h1>步骤 3：新内容与素材适配</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <h3>新商品 Brief</h3>
          <input placeholder="商品名：便携咖啡杯" style={{ width: '100%', marginBottom: 8 }} />
          <input placeholder="目标用户：通勤上班族" style={{ width: '100%', marginBottom: 8 }} />
          <textarea placeholder="卖点：保温 8 小时 / 不漏水 / 单手开盖" style={{ width: '100%', minHeight: 120 }} />
        </div>
        <div className="card">
          <h3>上传素材</h3>
          <input type="file" multiple accept="image/*,video/*" />
          <p>Demo 推荐故意只提供产品图 + 手持图，以展示素材缺口能力。</p>
          <a href="/gaps">查看素材缺口 →</a>
        </div>
      </div>
    </section>
  );
}
