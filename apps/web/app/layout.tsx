import './globals.css';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  // The StructMigrate UI is a full-screen app with its own sidebar nav, so the
  // root layout is intentionally bare — no global header/nav/container.
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
