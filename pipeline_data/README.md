# pipeline_data — 链路产出数据存储

这里集中存放**真实链路每一步产生的数据**,方便交给做"示例数据演示界面"的同学直接消费。
每个子目录对应链路的一个阶段;前端的 6 个 DTO 端点(`/api/struct/*`)与这些数据一一对应。

> 约定:文件名用 `<projectId>` 或 `<videoId>`(= 源视频 id,如 `macbook_neo`)命名,便于一个项目的各阶段数据相互关联。
> 体量大的视频在 `06_final_videos/` 与 `02_fine_scans/` 的原始片段不入 git(见 `.gitignore`),JSON 结构数据保留。

## 目录与内容

| 目录 | 内容 | 对应前端端点 / 来源 |
|------|------|------|
| `01_scans/` | 粗扫结果:`sourceVideo`(屏01 结构) + `structure_graph.json` | `POST /scan` → `GET /db/scans/:id` |
| `02_fine_scans/` | 精扫明细:每段 `FineBlockDetail`(transferableMotifs / actionBeats / productPresentation 等) | `POST /scan/:id/fine-all` → `segmentDetails` |
| `03_materials/` | 素材 + asset card(`asset_cards.json`) | `POST /materials/upload` · `GET /db/libraries/:id` |
| `04_diagnoses/` | 诊断快照:`sourceVideo`(已被精扫增强) + `materials` + `diagnosis`(四态 + 每槽位 reshoot/hyperframes/aigc 三建议) | `POST /diagnose` |
| `05_timelines/` | 成片时间线(编译产物 `timeline` + 版本) | `POST /compile` |
| `06_final_videos/` | 最终成片 mp4 + 拼成成片的各 AIGC 小片段 | `POST /produce` → `downloadUrl` |
| `db/` | 文件型 DB(scans / matches),与 `seed_assets/db` 同构 | 设 `DB_DIR=./pipeline_data/db` 可让链路直接写到这里 |

## 数据如何落到这里

- **诊断快照(04)是自动写入的**:每次跑「识别并诊断缺口」,后端把该项目的完整诊断 bundle 写到
  `04_diagnoses/<projectId>.json`(覆盖式,最新一次)。这是给同学的**最完整单文件**,自带源结构 + 素材 + 四态诊断 + 三建议 prompt。
- **扫描 / 匹配**:已持久化在文件型 DB。把环境变量 `DB_DIR=./pipeline_data/db` 设上,`/scan` 与 `/diagnose`
  的 scan/match 记录就会写进 `db/`;否则默认在 `seed_assets/db`(可直接拷过来)。
- **精扫 / 素材 / 成片**:目前主要在内存 / session 目录;需要长期留存时,把对应 JSON / mp4 拷进上面的子目录即可
  (文件名同 `<videoId>`)。

## 给同学的最小消费方式

一个项目跑完后,`04_diagnoses/<projectId>.json` 基本能驱动整个屏01→屏03 的展示。需要成片就再取
`06_final_videos/` 下的 mp4。所有 JSON 都是前端 `data.ts` / `api/types.ts` 里定义的同构结构,可直接喂前端。
