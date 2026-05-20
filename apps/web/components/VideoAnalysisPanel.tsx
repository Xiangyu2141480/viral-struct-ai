export function VideoAnalysisPanel() {
  return (
    <section className="card">
      <h1>步骤 1：样例视频输入与解析</h1>
      <p>目标：展示时长、比例、镜头数、字幕/语音概览、封面和关键帧。</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <h3>上传样例视频</h3>
          <input type="file" accept="video/*" />
          <textarea placeholder="ASR 失败时可手动粘贴字幕 fallback" style={{ width: '100%', minHeight: 120, marginTop: 12 }} />
        </div>
        <div className="card">
          <h3>Mock 分析结果</h3>
          <ul>
            <li>时长：15s</li>
            <li>比例：9:16</li>
            <li>镜头数：5</li>
            <li>结构：Hook → 痛点 → 卖点 → 对比 → CTA</li>
          </ul>
          <a href="/graph">查看结构图谱 →</a>
        </div>
      </div>
    </section>
  );
}
