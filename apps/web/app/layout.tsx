import './globals.css';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
            <strong>爆构引擎 ViralStruct AI</strong>
            <nav style={{ display: 'flex', gap: 12 }}>
              <a href="/demo">评审演示</a>
              <a href="/analyze">样例分析</a>
              <a href="/graph">结构图谱</a>
              <a href="/adapt">素材适配</a>
              <a href="/gaps">缺口补全</a>
              <a href="/result">结果</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
