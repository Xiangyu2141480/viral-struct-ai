# Pipeline 对齐排查 + 数据库 · 修改报告

> 本轮目标:①全链路字段对齐排查(尤其屏1)②修复 ③做数据库(扫描结果/案例结构/素材/asset card/匹配)④补拍视频入库+重解析 ⑤实时修改报告。
> 约束:不调用 LLM 跑测试(仅 typecheck + 纯逻辑 smoke)。
> 分支:`feat/pipeline-alignment-and-db`。

---

## 1. 字段对齐排查与修复

### 1.1 【已修】屏1↔屏4 `shot` 字段语义冲突(错用素材迁移字段)

**根因**:`SourceSegment` 缺独立"迁移规则"字段 → `shot` 被挪用承载迁移指令(`transferRule`)。

scan 出的 `structure_graph.json` 的 segment 字段语义:
| 字段 | 含义 |
|------|------|
| `purpose` | 结构功能(+精扫定位) |
| `caption` | **源画面视觉描述**("双手…拿出银色苹果笔记本…") |
| `transferRule` | **迁移指令**("替换为新商品的高强度视觉揭示…") ← 素材迁移字段 |

冲突点:
- 后端 `graphToSourceVideo`:`shot ← seg.transferRule`(把迁移指令塞进 shot)。
- 屏1 段落明细:`迁移规则 ← seg.shot`(碰巧标对名,但用了语义错误的字段)。
- **屏4 预览 [screens-cd.tsx:1561]**:`{seg.shot}` 当**镜头描述**显示 → 实际显示"替换为新商品…"迁移文案。**Bug**。
- 反向 `buildStructureGraph`:`transferRule ← segment.shot`,把语义彻底绕乱。

**修复(语义归位,新增专用字段)**:
| 文件 | 改动 |
|------|------|
| `apps/api/.../structAdapter/structTypes.ts` | `SourceSegment` 新增 `transferRule?: string`;`shot` 注释为"源视觉描述" |
| `apps/api/.../structAdapter/structAdapter.ts` `graphToSourceVideo` | `shot ← seg.caption`(真实视觉);新增 `transferRule ← seg.transferRule` |
| `apps/api/.../structAdapter/structAdapter.ts` `buildStructureGraph` | `transferRule ← segment.transferRule ?? segment.shot`(优先新字段,旧数据兜底) |
| `apps/web/app/_struct/data.ts` | 前端 `SourceSegment` 同步加 `transferRule?` |
| `apps/web/app/_struct/screens-ab.tsx:381-382` | 镜头内容 `← seg.shot \|\| seg.caption`;迁移规则 `← seg.transferRule` |

**效果**:屏4 镜头描述恢复为真实视觉;迁移规则有了专属字段、不再寄生 `shot`;前后端+反向 adapter 三方语义一致。

### 1.2 其他 adapter 核查(无同类错位,反而变好)

- `timelineItemsToSegs`:`shot ← item.visualAction ?? seg.shot` —— 屏4 时间线用 director 的 visualAction,兜底现在是真实视觉,**正确**。
- `segmentToShotSlot`:`requiredAsset.subject / sourceInstance.specificAction ← segment.shot` —— 原来是迁移文案(错),现在是真实视觉描述(对),**改善了反向喂给 director 的槽位语义**。
- `assetCardsToMaterials` / `toDiagnosisRecord`:未发现源/迁移字段串用。

---

## 2. 数据库(file-backed,无原生依赖、Windows 安全、可换 SQLite)

**选型理由**:沿用项目已有的 file-backed 持久化范式(`structLibraryStore`),零额外依赖、不触发 Windows 原生编译、diff 友好、可随时换 SQLite。一集合一目录、一记录一 JSON、原子写(temp+rename)、id 防穿越、单条损坏不拖垮整库。

### 2.1 引擎与仓储(新增)
| 文件 | 作用 |
|------|------|
| `apps/api/src/services/db/jsonStore.ts` | 通用集合引擎 `createCollection<T>`:put/get/list/query/remove,原子写,`createdAt` 倒序 |
| `apps/api/src/services/db/scanRepository.ts` | **扫描结果/案例结构**:`ScanRecord`(sourceVideo + structureGraph + 输入路径);saveScan/getScan/listScans/deleteScan |
| `apps/api/src/services/db/matchRepository.ts` | **素材匹配字段**:`MatchSetRecord`(按 projectId 幂等 upsert);saveMatchSet/getMatchSet/listMatchSets |
| `apps/api/src/services/db/assetLibraryRepository.ts` | **素材 + asset card**:包住现有 `asset_cards.json`(单一真源);readLibraryCards/appendLibraryCards(续号防冲突)/listLibraries |
| `apps/api/src/services/videoPaths.ts` | 新增 `getDbDir()`(默认 `./seed_assets/db`,可 `DB_DIR` 覆盖) |

> 设计要点:**asset card 不另起炉灶**——直接复用 `<assetLibraryDir>/<id>/asset_cards.json`(`loadAssetLibrary` 读的同一文件),`assetLibraryRepository` 是它的写入侧。扫描结果与匹配是真正缺失的两块,放进新集合。

### 2.2 入库接线
| 位置 | 改动 |
|------|------|
| `POST /api/struct/scan` | 扫描成功后 `saveScan({sourceVideo, structureGraph, videoPath, roughScanPath})` 持久化(失败仅告警不阻断) |
| `POST /api/struct/diagnose` | 算出匹配后 `saveMatchSet({projectId, matches})` 持久化(slot→asset/quality/fillStatus) |

### 2.3 读取端点(新增)
| 端点 | 返回 |
|------|------|
| `GET /api/struct/db/scans` | 扫描结果列表(摘要) |
| `GET /api/struct/db/scans/:id` | 单条扫描(完整 sourceVideo + graph) |
| `GET /api/struct/db/libraries` | 素材库列表 + 卡片数 |
| `GET /api/struct/db/libraries/:id` | 某库素材(materials) |
| `GET /api/struct/db/matches/:projectId` | 某项目的匹配集 |

前端 client:`apps/web/app/_struct/api/db.ts`(listScans/getScan/listLibraries/getLibrary/getMatchSet + reshootIntoLibrary)。

---

## 3. 补拍视频入素材库 + 重新解析

**新增** `POST /api/struct/materials/reshoot`(multipart:`assets[]` + `libraryId` + `textBrief?`):
1. `analyzeAssetsWithFallbackResult`(确定性本地分析优先,不强依赖 VLM key)把补拍片解析成 AssetCard。
2. 落盘到稳定 session 目录(url 可存活),改写 card.url。
3. `appendLibraryCards(libraryId, cards)` **续号并入素材库 + 持久化**。
4. 返回整库 materials —— 补拍片即刻出现在库里;之后 `loadAssetLibrary` / `GET /db/libraries/:id` 再读即"重新解析后的"集合。

> 即"补拍阶段的视频也能进素材库并重新解析":进库=appendLibraryCards,解析=analyzeAssets,重读=loadAssetLibrary。

---

## 4. 验证(不调 LLM)

- ✅ `pnpm --filter @viral-struct/api typecheck` 通过
- ✅ `pnpm --filter @viral-struct/web tsc --noEmit` 通过
- ✅ **DB 纯逻辑 smoke**(临时 DB 目录):
  - `saveScan→getScan→listScans` 往返成功,且 `transferRule` 字段随结构正确持久化
  - `saveMatchSet` 同 projectId **幂等 upsert**(s1→asset_002 覆盖)
  - `appendLibraryCards` **续号** `asset_001/asset_002` 无冲突;`readLibraryCards`/`listLibraries` 正常

---

## 5. 待跟进(本轮未做,供后续)

- 前端 UI:补拍上传按钮(调 `reshootIntoLibrary`)、DB 浏览面板(调 `/db/*`)——client 已就绪,差挂 UI。
- `POST /sample/analyze` 路径也可顺手 `saveScan`(目前仅 `/scan` 入库)。
- 如需强一致/并发,可把 file-backed 换成 SQLite(`createCollection` 接口不变)。
