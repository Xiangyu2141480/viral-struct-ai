# 产品规格

## 页面流

```txt
/                  单页应用（左侧步骤导航切换）
步骤 01 · 样例解析  样例视频分析 + 结构图谱（上下对位）
步骤 02 · 素材输入  新内容与素材输入
步骤 03 · 缺口诊断  素材缺口与补全
步骤 04 · 成片编译  脚本 / 分镜 / 时间线 / 一键演示
```

完整流程：01 样例解析 → 02 素材输入 → 03 缺口诊断 → 04 成片编译（同一页面 / 路由 `/`，左侧步骤导航切换）。

## 用户故事

```txt
作为创作者，我可以上传一条爆款样例视频，系统帮我拆出结构。
作为创作者，我可以输入新商品和少量素材，系统判断是否足够。
作为创作者，我可以看到缺少哪些镜头，并选择补全策略。
作为创作者，我可以生成脚本、分镜、时间线和视频 demo。
作为创作者，我可以调整 hook、节奏、卖点顺序和包装风格。
```

## 关键组件

```txt
UploadPanel
VideoAnalysisPanel
StructureGraph
MappingTable
AssetCardGrid
GapBoard
RepairPlannerPanel
TimelineView
VideoRenderPreview
QualityReport
VersionSwitcher
EditInstructionBox
```
