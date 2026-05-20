const items = [
  ['0-2s', 'Hook 标题卡 + 产品图推近', '通勤路上，咖啡总是凉得太快？'],
  ['2-4s', '痛点卡片', '普通杯不保温，还容易洒一包。'],
  ['4-7s', '产品特写', '保温 8 小时，早上到下午都能喝热咖啡。'],
  ['7-10s', '手持图裁切 + 箭头', '单手开盖，放进车载杯架也没问题。'],
  ['10-13s', '左右对比卡', '普通杯易漏，便携杯倒置不漏。'],
  ['13-15s', 'CTA 卡', '通勤党想喝热咖啡，就选它。']
];

export function TimelineView() {
  return (
    <section className="card">
      <h1>步骤 5：生成结果</h1>
      <h3>时间线草案</h3>
      {items.map((item) => (
        <div className="card" key={item[0]} style={{ marginBottom: 8 }}>
          <strong>{item[0]}</strong>
          <p>{item[1]}</p>
          <p>{item[2]}</p>
        </div>
      ))}
    </section>
  );
}
