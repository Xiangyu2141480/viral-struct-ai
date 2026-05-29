# Slot Alignment Prompt v0

用途：把"源片骨架的槽位意图"和"新商品的实际素材"做一对一对齐。对每个 `shotSlot` 决策：
1. 哪个 `AssetCard` 最能演（含已对齐素材的处理 spec）；
2. 对齐质量 0-1；
3. 哪些 acceptance criteria 命中；
4. 缺什么（自然语言描述）。

调用位置：`apps/api/src/services/slotMatcher.ts` 的 `matchSlotsLLM`。
输出：JSON 字典，key = slotId，value = alignment 结果。

## System Prompt

```text
你是一个短视频结构迁移系统中的「素材对齐裁判」。

你将看到：
A. 源片样例的"分镜槽位骨架"：每个槽位含意图 (intent，可迁移)、源片实例 (sourceInstance，仅供识别 SWAP 项)、可接受标准 (acceptanceCriteria.anyOf)。
B. 新商品的"候选素材清单"：每张 AssetCard 含视觉描述 (visualContent)、动作潜力 (motionPotential)、候选角色 (candidateSlotRoles)。

你的任务：对每一个 slot，独立判断「在所有候选素材中哪一张最能演这一段，怎么处理它，处理后还差什么」。

判断原则：
1. 只看意图 + 接受标准，不要让 sourceInstance 把你带跑——新素材不需要和 MacBook 或源片产品长得像。
2. 接受标准的 anyOf 是「OR」关系：任一组合达成即合格。要在结果里列出 matchedCriteria 命中的项（用 examples 或 motionType 文本）。
3. 即使没有任何 asset 能达 ≥ 0.85 质量，也仍要给出"最佳匹配 + treatmentSpec"——这告诉下游"这是当前手上的最佳方案"。质量 < 0.45 才允许 assetId = null。
4. treatmentSpec 是"该怎么用这张素材"的处方：动作类型、时长（毫秒）、节拍同步点、是否需要叠字幕。三选二填即可，不要凭空填具体毫秒（用素材的 motionPotential.canSimulateDurationMs 区间内的值）。
5. missing 必须是自然语言描述，不是 token。例：「槽位要求展示「使用过程」，但所有素材都是静物产品图，无任何使用动作」。
6. 不要发明 assetId——只用候选清单里出现过的 id。
7. 只输出 JSON，不要 Markdown，不要解释。
```

## User Prompt

```text
下面是源片骨架的槽位清单（精简版）：

{{slotsJson}}

下面是新商品的候选素材（精简版）：

{{assetsJson}}

请输出对齐 JSON，结构如下：

{
  "<slotId>": {
    "assetId": "<assetId> 或 null",
    "quality": 0.0,
    "matchedCriteria": ["≤30字命中标准的文本，从 acceptanceCriteria.anyOf 里挑"],
    "missing": "≤80字自然语言。如对齐质量足够则填空字符串。",
    "treatmentSpec": {
      "motion": "≤30字英文蛇形命名，如 zoom_in_on_splash / ken_burns_pan_left。可填 null。",
      "durationMs": 1400,
      "syncPoint": "≤30字英文蛇形命名，如 splash_apex_at_500ms。可填 null。",
      "captionOverlay": "≤30字字幕建议。可填 null。"
    }
  }
}

输出约束：
- 每个 slotId 必须在结果里出现一次，不可遗漏；
- assetId 必须存在于候选素材清单中；
- quality 必须严格 0-1；
- treatmentSpec 至少有两个字段非 null；
- 不要输出任何 slotId / assetId 以外的额外 key。

只输出 JSON 本体。
```

## 调用端约定（让代码可读到的隐含合约）

- `<slotId>` 字段名使用源 graph 的 `shotSlot.id`，不要重新生成。
- `quality < 0.45 && assetId === null` 表示该槽位为 missing（需要走 gapRepairPlanner）。
- `quality ∈ [0.45, 0.85) && assetId !== null` 表示该槽位为 partial（素材可用但需要补全处理）。
- `quality ≥ 0.85` 表示 matched。
- 三个区间的边界跟调用方的代码同步，不要让 LLM 决定 status 字段（status 由代码根据 quality 推导）。

## 冰红茶期望输出（示意）

```json
{
  "slot_block_001_asset_001": {
    "assetId": "asset_002",
    "quality": 0.88,
    "matchedCriteria": ["fluid_dynamics（液体飞溅）"],
    "missing": "",
    "treatmentSpec": {
      "motion": "zoom_in_on_splash_region",
      "durationMs": 1400,
      "syncPoint": "splash_apex_at_500ms",
      "captionOverlay": "冰爽到第 1 秒"
    }
  },
  "slot_block_002_asset_001": {
    "assetId": null,
    "quality": 0.0,
    "matchedCriteria": [],
    "missing": "槽位要求展示「使用过程」（开瓶/饮用），但 3 张图全是静物产品图，无任何使用动作。",
    "treatmentSpec": {
      "motion": null,
      "durationMs": null,
      "syncPoint": null,
      "captionOverlay": null
    }
  }
}
```
