import { ScoreMap } from '../components/ScoreMap';

export default function HomePage() {
  return (
    <main>
      <section className="card">
        <h1>爆款结构迁移引擎</h1>
        <p>
          从样例视频中抽取可迁移结构，映射到新商品和用户素材，并在素材不足时自动识别缺口和补全，最终生成脚本、分镜、时间线和视频 demo。
        </p>
        <p>
          <a href="/analyze">开始样例分析 →</a>
        </p>
      </section>
      <ScoreMap />
    </main>
  );
}
