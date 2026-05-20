# 整体 AI 架构

## 总体链路

```txt
样例视频上传
  ↓
Video Analyzer
  - ffprobe 元信息
  - FFmpeg 抽封面 / 关键帧
  - shot detection
  - ASR / 手动字幕 fallback
  ↓
Structure Extractor
  - 脚本结构
  - 节奏结构
  - 包装结构
  - 镜头槽位
  ↓
ViralStructureGraph
  ↓
新内容 + 用户素材输入
  ↓
Asset Analyzer
  - spatial frame
  - temporal frames
  - 素材描述
  - 槽位推荐
  ↓
Slot Matcher
  - slot → asset 匹配
  - matched / partial / missing
  ↓
Gap Repair Planner
  - 包装补全
  - 文案补全
  - 裁切复用
  - AIGC 可选
  ↓
Timeline Generator
  - 脚本
  - 分镜
  - 字幕分段
  - 包装建议
  - 时间线协议
  ↓
Renderer
  - Remotion preview
  - FFmpeg / Remotion export
  ↓
Visualization & Quality Report
```

## 核心设计：ViralStructureGraph

```ts
type ViralStructureGraph = {
  meta: VideoMeta;
  segments: SegmentNode[];
  shotSlots: ShotSlotNode[];
  rhythm: RhythmStructure;
  packaging: PackagingStructure;
  edges: GraphEdge[];
};
```

## 结构迁移思想

```txt
不是复制样例内容，而是迁移创作方法：

Hook 方式
卖点推进顺序
镜头节奏
字幕密度
包装样式
CTA 位置
```

## VC-LLM 参考方式

本项目参考 VC-LLM 对广告生成的结构化定义：

```txt
clip selection + clip ranking + grounded script + subtitle segmentation
```

但本项目增加：

```txt
样例结构抽取
结构槽位定义
素材缺口识别
补全策略库
包装层生成
迁移过程可视化
```
