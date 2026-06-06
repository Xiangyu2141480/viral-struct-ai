# `/api/struct/*` 契约 mock server

零依赖的桩服务,按 [`docs/API_CONTRACT.md`](../../../docs/API_CONTRACT.md) §10 返回 StructMigrate demo 所需的 8 个接口形状。用于**在真实后端就绪之前**验证前端接线。

## 用途

demo 的 store 在接口调用失败时会静默回退到本地 fixtures(`mode='mock'`)。跑这个 mock server 后,每屏都会切到 `LIVE`(右上角角标变绿),证明 fetch → 解析 → 渲染整条链路与 [`api/types.ts`](../app/demo/_struct/api/types.ts) 里的形状一致。

每个响应都带一条 `warnings: ['🔌 来自契约 mock server(非真实后端)']`,所以 demo 顶部的 StatusBanner 会提醒你这些是桩数据,而非真实 pipeline。

## 运行

```bash
# 默认监听 4000(= 前端 NEXT_PUBLIC_API_BASE 默认值,零配置)
pnpm --filter @viral-struct/web mock:struct

# 或自定义端口(此时前端需设 NEXT_PUBLIC_API_BASE=http://localhost:4100)
PORT=4100 node apps/web/mock/struct-mock-server.mjs
```

> ⚠️ mock server 与真实后端都用 4000 端口 —— 二选一,别同时跑。

然后另开一个终端:

```bash
pnpm --filter @viral-struct/web dev   # http://localhost:3000/demo
```

## 覆盖的接口

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/api/struct/sample/analyze` | 返回固定 SourceVideo(multipart 不解析) |
| POST | `/api/struct/materials/upload` | 返回固定素材卡片(multipart 不解析) |
| POST | `/api/struct/materials/match` | 回显素材 + 套用 assignments |
| POST | `/api/struct/diagnose` | 按请求 segments 生成四态 diagnosis |
| POST | `/api/struct/strategy/apply` | 将指定槽位标记为 filled |
| POST | `/api/struct/compile` | 由 segments 生成 timeline + 合成 version |
| POST | `/api/struct/nl-edit` | 回显 timeline + patchSummary |
| POST | `/api/struct/export` | 返回 `status:'done'` 的 job |
| GET  | `/api/struct/export/:jobId` | 返回该 job 的完成状态 |

桩的行为有意简化(JSON 接口尽量回显请求数据,multipart 接口返回内置样例)——目标是验证形状契约,不是复刻真实算法。
