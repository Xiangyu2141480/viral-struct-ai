# AIGC Helper → Wan2.7 视频生成与拼接管线 — 写代码指导文档

> 目标读者:实现这条管线的工程师 / Claude。本文是 **实现指南**,不是已落地的代码。
> 关联:这是 PR#70 `scripts/render_director_enhanced.mts`(对真实片段做 HTML/GSAP 叠加)的**生成版兄弟**——
> 那条桥"增强已有真片",这条管线"为缺口/部分满足的 beat 用扩散模型生成新片",再统一按 director 时间线拼接。

---

## 0. 一句话目标

把 **Director 交接给 Video Agent 的 JSON**(`AuthoredTimeline` + 每个 beat 的 `enhancement` / `fillStatus`)变成一条成片:
**逐 beat 按"素材适配程度"路由到正确的 Wan2.7 模型 → 并发生成 → 下载 → 按时间线 ffmpeg 拼接 → 输出最终长视频。**

---

## 1. 管线位置

```
ContentBrief
  → analyzeProductIntelligence → buildProductNativeStructureGraph
  → 结构压缩 → 槽位匹配
  → runDirectorAgent → orchestratedToAuthored
        ⇒ AuthoredTimeline（交接 JSON：beats[].enhancement / fillStatus / mediaLayers）
  → ★【本管线】aigcHelper（beat → WanJob）→ wanVideoClient（并发生成）→ 下载缓存 → stitch（ffmpeg concat）
  → 最终 MP4
```

- 完全匹配(`matched`)的 beat **不进生成**,直接用真实片段(可选 hyperframes 叠加)。
- 生成只服务 **gap / partial** 的 beat。

---

## 2. 输入契约(Director 的交接 JSON)

来自 `orchestratedToAuthored(orchestratedTimeline)` 的 `AuthoredTimeline`,以及上游 `OrchestratedTimeline.slots`。每个 beat 渲染器需要的字段:

| 字段 | 来源 | 用途 |
|---|---|---|
| `id` / `segmentRole` | beat | 命名 / 文案语义 |
| `startSeconds` / `endSeconds` | beat | 时长 `dur = end - start`、拼接顺序 |
| `mediaLayers[].media.resolvedPath` | beat | 该 beat 匹配到的**真实素材**路径(可能图/视频/无) |
| `enhancement.options[]` | beat | `{channel: 'reshoot'|'hyperframes'|'aigc', guidance, recommended}` —— **aigc 的 guidance 就是生成 prompt** |
| `fillStatus` | `OrchestratedSlot.fillStatus` | **路由模型的依据**(见 §3) |
| `referenceAssetIds`(AigcOption) | slot.fill.options(aigc) | 参考素材 id |
| 产品参考图 | 外部输入(用户上传的 product shot) | gap 生成时的主体锚定 |

> `fillStatus` 枚举(来自 `packages/shared/src/orchestratedTimeline.ts`):
> `matched | partial_asset_support | needs_hyperframes_enhancement | source_specific_not_transferable | missing_generation_required`

---

## 3. ★核心决策:`fillStatus` → Wan2.7 模型路由

| beat 情况 | fillStatus | 输入素材 | Wan 模型 | media | 状态 |
|---|---|---|---|---|---|
| 完全有真片 | `matched` | 真实视频 | **不生成**,直接用真片(可选 hyperframes 叠加) | — | ✓ 已有 |
| 部分满足·图 | `partial_asset_support` | 匹配到图片 | **`wan2.7-r2v`**(参考重绘,已定) | `reference_image` = 匹配图 + 全局产品图 | ✅ 已开通 |
| 部分满足·视频 | `partial_asset_support` / `needs_hyperframes_enhancement` | 匹配到视频 | **`wan2.7-videoedit`** | `media` = 源视频 + `prompt`(编辑指令) | ✅ 已开通 |
| 完全缺失 | `missing_generation_required` / `fill.kind==='gap'` | 全局产品图(+ beat 自带 referenceAssetIds) | **`wan2.7-r2v`** | `reference_image` = 产品图(≤5) | ✅ 已实测 |
| 缺失且无任何产品图 | gap | 无 | `wan2.7-t2v` | — | ✅ 已开通(兜底,极少用) |
| 源特定不可迁移 | `source_specific_not_transferable` | — | 走 director 的 targetEquivalent → 当 gap 处理(r2v) | reference_image | — |

**关键结论**:四个模型**不是同一个**,但走**同一异步端点 + 同一请求结构**,适配器只切 `model` + `media` 类型。

> **探测确认(2026-06-10)**:`wan2.7-r2v / i2v / videoedit / t2v` 在本 workspace **全部已开通**(`wan2.7-v2v` 不存在)。
> 按已定决策**图匹配走 r2v 而非 i2v**,故实际路由用 **r2v + videoedit(+ t2v 兜底)**,i2v 保留为未来选项。
> 各模型必填字段(探测所得):r2v = `media` + `prompt`;i2v = `media`(prompt 可选);**videoedit = `media`(源视频)+ `prompt`(编辑指令)**;t2v = `prompt`。

---

## 4. `aigcHelper` 职责(beat → WanJob)

输入:一个 beat(+ 其匹配素材 + 全局产品图)。输出:`WanJob`。**以确定性逻辑为主**,LLM 润色为可选薄层。

```ts
interface WanJob {
  beatId: string;
  model: 'wan2.7-r2v' | 'wan2.7-i2v' | 'wan2.7-videoedit' | 'wan2.7-t2v';
  prompt: string;
  negativePrompt?: string;
  media: Array<{ type: 'reference_image' | 'reference_video' | 'first_frame' | 'source_video'; url: string }>;
  parameters: { resolution: '720P' | '1080P'; ratio: '9:16' | '16:9' | '1:1'; duration: number; promptExtend: boolean; watermark: boolean; seed?: number };
  fallbackRealClipPath?: string; // partial 时的兜底真片
}
```

步骤:
1. **路由 model**:按 §3 表从 `fillStatus` + 匹配素材类型决定。
2. **构造 media**:本地素材 → base64 data URI(图,小)或 OSS 临时 URL(视频/大图);多素材用「图1/图2、视频1」索引,顺序与数组一致。
3. **参数**:`duration = clamp(round(end-start), 模型 min, 模型 max)`(**整数**!);`ratio` 取 beat/graph 的 aspectRatio;`resolution` 默认 720P(config)。
4. **产品锚定**(实测必要):prompt 前缀点名产品,如「参考图片中的{productName}…」,否则瓶身/标签会飘。
5. **诚实红线**:剔除虚构功效/价格/品牌;AIGC beat 置 `watermark=true` 或烧入「AI生成」字样;只描述产品与画面已有内容。
6. **(可选)LLM 润色**:用豆包(`LLM_API_KEY`,**非视频模型**)把 director 的 guidance 改写成 v-LLM 友好的视觉化中文 prompt。默认关,因 director 的 prompt 已足够产品相关。

---

## 5. `wanVideoClient`(已验证事实 + 待确认)

**端点(异步,所有 Wan2.7 模型共用)**:
```
POST {WAN_BASE_URL}/services/aigc/video-generation/video-synthesis
  Headers: Authorization: Bearer {DASHSCOPE_API_KEY}
           Content-Type: application/json
           X-DashScope-Async: enable          # 必须，否则 "does not support synchronous calls"
           X-DashScope-WorkSpace: {WAN_WORKSPACE_ID}
  Body: { model, input:{ prompt, media[], negative_prompt? }, parameters:{ resolution, ratio, duration, prompt_extend, watermark, seed? } }
  → output.task_id (PENDING)

GET {WAN_BASE_URL}/tasks/{task_id}            # 每 ~15s 轮询
  → output.task_status: PENDING|RUNNING|SUCCEEDED|FAILED|UNKNOWN
  → SUCCEEDED 时 output.video_url（H.264 MP4，24h 过期）
```

- **`WAN_BASE_URL = https://dashscope.aliyuncs.com/api/v1`**(全局北京端点)。
  ⚠ **不要**用 key CSV 里的 `ws-xxx.cn-beijing.maas.aliyuncs.com`(那是 OpenAI-compat 域名,证书 hostname 不匹配,curl+OpenSSL 双双验证失败)。
- **`wan2.7-r2v`:已实测**(伦敦→北京,产品图 base64 当 `reference_image`,3s/9:16/720P,~1 分钟出片)。
  参数:`resolution` 720P/1080P;`ratio` 9:16/16:9/1:1/4:3/3:4;`duration` **整数** [2,15](无参考视频)/[2,10](有);`prompt_extend`、`watermark`、`seed`。
- **i2v / videoedit / t2v:同模式,换 `model` + media 类型**,但**精确 media 字段名与 workspace 开通状态待确认**(编码前查文档/模型市场)。
- **素材约束**:参考图 ≤20MB,JPEG/PNG(**PNG 不带 alpha**)/BMP/WEBP;参考视频 mp4/mov ≤100MB、1–30s;`media` 图+视频 ≤5;prompt ≤5000 字;negative ≤500 字。

---

## 6. 并发设计

- 6–8 个 beat 串行 = 8×(1–5min),不可接受 → **有界并发池**(建议 4–6 路同时 create+poll)。
- 查询接口 RPS ≤20 → 轮询间隔 ~15s + 抖动;并发数别太高。
- 每任务超时(如 8min)+ 失败重试 1 次;最终失败 → 走 §10 兜底。
- 实现:`Promise` 池(p-limit 风格)或 `asyncio`,取决于 §11 语言决策。

---

## 7. 素材与结果处理

- **本地图** → base64 data URI(简单,小);**本地视频 / 大图** → 上传 OSS 取**临时 URL**(`oss://` / 公网 URL);videoedit 的输入视频几乎必须走 URL(base64 视频太大)。
- **SUCCEEDED 立即下载** `video_url`(24h 过期)到本地缓存目录(gitignore),按 beat 指纹命名。

---

## 8. 拼接(stitch)+ 音频

1. 所有 beat 落地后(生成片 + matched 真片),按 `startSeconds` 排序。
2. **归一化**:scale/pad 到统一 720×1280、fps 30、SAR。
3. **P1:一遍拼接,保留各段自带音频**(生成片是 Wan 配的、matched 真片是原声):
   `ffmpeg -i b0 -i b1 … -filter_complex "[0:v][0:a][1:v][1:a]…concat=n=N:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac final.mp4`
   - 注意:各段声源不同,**接缝处音量/环境音可能跳变**——P1 接受,统一 BGM/解说稍后再定。
   - 缺音频的段先补一条静音轨(`anullsrc`)以保证 concat 的 a 流对齐。
4. **(后续·可选)统一一条音轨**:video-only 拼接(`a=0`)→ `ffmpeg -i silent.mp4 -stream_loop -1 -i {audioTrackPath} -map 0:v -map 1:a -c:v copy -c:a aac -shortest final.mp4`。
5. (后续)用 director 的 `transitions`(ffmpeg `xfade`)替代硬切。

---

## 9. 诚实 / 安全

- 生成 beat 必须以**真实产品图**为参考(r2v/i2v),不得凭空捏造产品。
- AIGC beat 带披露(`watermark=true` 或烧字幕「AI生成」)。
- 无虚构功效/价格/未授权品牌/检测数据(director 已约束,helper 再校一次)。

---

## 10. 缓存 / 幂等

- 每 beat 指纹 = `hash(model + prompt + media内容hash + parameters)`。命中缓存则跳过生成(借鉴 `fine_scan` 的 resume fingerprint)。
- 避免重跑烧额度 + 规避 24h URL 过期。

---

## 11. 失败处理(绝不因单 beat 拖垮整片)

单 beat 生成失败 → 兜底顺序:
1. partial 时用**匹配到的真实片段**(fallbackRealClipPath);
2. 否则**确定性占位卡**(诚实的纯色/产品图静帧卡,标注);
3. 再不行**跳过 + 记 warning**,继续拼其余 beat。

---

## 12. 文件结构(建议)

> 决策点(§15):**TS(推荐,贴合 director/video-agent)** vs Python(复用已测脚本)。

**TS 方案(推荐)**:
- `packages/video-agent/src/aigc/wanVideoClient.ts` — 异步 HTTP 客户端(create + poll,无需 SDK)。
- `packages/video-agent/src/aigc/aigcHelper.ts` — beat → `WanJob` 路由 + prompt 变换(§3/§4)。
- `apps/api/src/services/videoAgent/aigcRenderer.ts` — 编排:并发生成 + 下载 + 拼接。
- `packages/shared/src/aigcJob.ts` — `WanJob` / `AigcBeatPlan` 类型(Zod)。
- `scripts/render_director_aigc.mts` — runner(对标 `render_director_enhanced.mts`),先跑通再产品化。
- 复用:`render_director_enhanced.mts` 的 ffmpeg concat;`.env` 配置。

---

## 13. 配置(.env,已 gitignore)

```
DASHSCOPE_API_KEY=sk-...
WAN_BASE_URL=https://dashscope.aliyuncs.com/api/v1
WAN_WORKSPACE_ID=ws-...
WAN_MODEL_R2V=wan2.7-r2v
WAN_MODEL_I2V=wan2.7-i2v          # 待确认开通
WAN_MODEL_VIDEOEDIT=wan2.7-videoedit  # 待确认开通
WAN_MODEL_T2V=wan2.7-t2v
WAN_RESOLUTION=720P
WAN_MAX_CONCURRENCY=4
WAN_CACHE_DIR=tmp/wan_cache
```

---

## 14. 测试策略

- **单元**:路由表(`fillStatus`→model)、prompt 变换(产品锚定 / duration 取整夹紧 / ratio)、media 映射(图→data uri、视频→OSS)、指纹。
- **集成**:mock `WanVideoClient`(零网络)→ 编排器对每个 beat 产出正确 `WanJob` + 正确拼接计划。
- **E2E**(flag 门控,真实额度):1–2 个 beat 打真实 DashScope(默认关,只在手动验证时跑)。

---

## 15. 已定决策(2026-06-10)

1. **语言**:**TS**(`packages/video-agent` 内,贴合 director/video-agent 同栈)。
2. **产品参考图**:**全局上传的 product shot** 作每个 gap / 图-partial beat 的主锚点;beat 自带 `referenceAssetIds` 追加进 media(r2v ≤5)。
3. **分辨率**:**720P**。
4. **图匹配 beat**:**r2v(参考重绘)**,不用 i2v。
5. **音频**:**P1 保留各段自带音频**(一遍 concat `a=1`);统一 BGM/解说稍后再定(§8 第 4 点为未来可选)。
6. **模型开通**:r2v / i2v / videoedit / t2v **全部已开通**(探测确认);路由用 **r2v + videoedit + t2v 兜底**。
7. **触发点**:先 **runner 脚本** 跑通(P1)→ 再产品化成 service + route → 最后接 demo。

---

## 16. 分阶段落地(每步可独立验证)

- **P1(仅用已验证的 r2v)**:`WanJob` 类型 + `wanVideoClient`(r2v)+ `aigcHelper`(r2v 路由 + matched 跳过)+ runner 生成 gap beat + 并发 + 下载 + ffmpeg 拼接。**端到端跑通一条全 gap 的时间线**。
- **P2**:确认 i2v/videoedit 文档与开通后,补 图匹配(i2v)+ 视频匹配(videoedit)两条路由。
- **P3**:缓存/幂等、并发调优、director transitions(xfade)、产品化成 service + route + 测试、接进 demo / director handoff。

---

## 附:已验证的 r2v 调用(参考实现骨架)

```python
# 已实测可用：伦敦 → 北京 r2v，产品图 base64 作 reference_image
body = {
  "model": "wan2.7-r2v",
  "input": {"prompt": PROMPT, "media": [{"type": "reference_image", "url": "data:image/png;base64,..."}]},
  "parameters": {"resolution": "720P", "ratio": "9:16", "duration": 3, "prompt_extend": False, "watermark": False},
}
# POST .../services/aigc/video-generation/video-synthesis  (X-DashScope-Async: enable, X-DashScope-WorkSpace)
# 轮询 GET .../tasks/{task_id} 至 SUCCEEDED → output.video_url（24h，立即下载）
```
（完整可运行版见 `tmp/wan_r2v_test.py`。）
