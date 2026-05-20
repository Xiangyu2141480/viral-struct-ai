# Safety And AI Tools / 安全边界与 AI 工具说明

## 1. AI 工具使用声明

本项目允许使用 AI 工具辅助完成方案设计、代码实现、文案生成、视频分析和内容生成，但核心产品定义、结构协议、任务拆解、评分映射、工程集成和 demo 链路由项目团队自主设计与实现。

| 工具/能力 | 使用环节 | 边界 |
|---|---|---|
| Codex / Cursor / Claude Code 类编码助手 | 代码生成、重构、调试、文档整理 | 不能替代核心设计判断；提交前必须人工审查 |
| ChatGPT / Claude / 豆包类 LLM | 结构抽取、脚本草案、包装建议、评分说明 | 输出必须结构化并经过 schema 校验 |
| 火山方舟 Doubao | real mode LLM provider，优先用于结构抽取和生成 | API key 只在本地 `.env`，不得入库 |
| Whisper / ASR | 字幕或语音转写 | ASR 失败时必须支持手动字幕 fallback |
| FFmpeg / ffprobe / OpenCV | 视频元信息、关键帧、镜头基础分析 | 只处理用户授权或项目自有素材 |
| Remotion | 时间线 preview / demo 视频 | 用于可验证展示，不伪装成真实剪辑软件完整能力 |
| 即梦 / CapCut / 剪映 / Runway | 竞品参考或素材实验 | 不直接把现成产品结果冒充为自主系统输出 |

## 2. 自主设计部分

项目必须在说明文档和答辩中强调以下自主设计：

- `ViralStructureGraph`：短视频结构协议。
- `Structure Slot Matching`：结构槽位与用户素材匹配机制。
- `Material Gap Detection`：素材不足识别。
- `Gap Repair Planner`：文案、包装、复用、AIGC 建议等补全策略。
- `Explainable Timeline Protocol`：可解释、可渲染的时间线输出。
- 评分导向的可视化链路：结构 -> 映射 -> 缺口 -> 补全 -> 结果。

## 3. 密钥与配置边界

```txt
允许：
- 在本地 .env 中保存真实 API key。
- 在 .env.example 中保留空字段和说明。
- 在服务端读取 LLM_API_KEY。

禁止：
- 把真实 API key 写入仓库。
- 把真实 API key 写入 README、docs、issue、PR、截图或日志。
- 在前端代码中暴露密钥。
- 在错误信息中打印密钥。
```

推荐环境变量：

```txt
LLM_PROVIDER=ark
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=Doubao-Seed-2.0-lite
ENABLE_MOCK_AI=true
```

## 4. 内容安全边界

系统只迁移：

```txt
结构、节奏、包装方式、表达策略、槽位关系
```

系统不迁移：

```txt
原视频人物肖像、原文案、品牌元素、音乐原片段、受版权保护画面
```

营销文案中的以下强事实必须来自用户输入或证据来源：

```txt
功效、价格、优惠、认证、销量、排名、医疗/金融/教育承诺
```

无证据时，系统应降级表达，例如从“销量第一”改为“适合高频通勤场景”。

## 5. Mock / Real 双模式

为了保证答辩稳定，所有 AI 模块必须支持双模式：

| 模式 | 作用 |
|---|---|
| mock mode | 无 key、无网络、模型失败时仍可演示完整闭环 |
| real mode | 使用火山方舟 Doubao 或兼容 LLM provider 展示真实 AI 能力 |

real mode 失败时不得让 demo 中断，应返回：

```txt
模型失败原因 -> mock fallback -> UI 标记当前结果来源
```

## 6. 交付文档必须说明

最终项目说明文档必须包含：

- 使用了哪些 AI 工具。
- 分别用于哪些环节。
- 哪些部分是自主设计与实现。
- 模型 provider、工具协议和安全边界。
- 为什么本项目是结构迁移，而不是复制样例内容。
