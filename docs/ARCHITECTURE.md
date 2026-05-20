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

## Provider 策略

系统按 provider 抽象 AI 能力，避免把项目绑定到单一模型或单一网络环境。

```txt
mock provider
  - 默认可演示
  - 用固定 case 保证答辩稳定
  - 覆盖结构抽取、缺口识别、补全和时间线生成

ark provider
  - 火山方舟 Doubao 优先
  - OpenAI-compatible 调用风格
  - 用于 real mode 展示真实结构理解与生成能力

optional providers
  - OpenAI / local ASR / VLM
  - 只作为扩展，不阻断主 demo
```

所有 provider 输出都必须回到共享协议：

```txt
VideoAnalysis
ViralStructureGraph
AssetCard[]
SlotMatch[]
MaterialGap[]
GapRepair[]
TimelineItem[]
QualityReport
```

模型失败时必须降级到 mock provider，并在 UI 中标记结果来源。

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

## 工具协议与安全边界

工具协议详见 `docs/TOOL_PROTOCOL.md`。所有工具输入/输出都应是结构化 JSON，并经过共享 schema 校验。

安全边界详见 `docs/safety-and-ai-tools.md` 和 `docs/SAFETY_BOUNDARY.md`。核心原则：

- 只迁移结构方法，不复制样例内容结果。
- API key 只允许存在于本地服务端 `.env`。
- 营销强事实必须有用户输入或证据来源。
- AIGC 补全要在 demo 和文档中标记。
