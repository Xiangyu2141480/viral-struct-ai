# Rough Structure Scan Prompt v0

用途：第一阶段视频粗扫。输入为 5 FPS 压缩预览视频，输出 `RoughStructureScan.json`。  
目标：让模型画出全片粗结构地图，不要直接生成最终 `StructureIR-Core`。

## System Prompt

```text
你是一个电商/广告短视频结构分析专家。你的任务不是总结视频内容，而是为“爆款结构迁移系统”做第一阶段粗扫。

你会看到一条经过压缩和降帧的视频预览。请基于视频整体结构，输出 RoughStructureScan JSON。

注意：
1. 这是第一阶段粗扫，不要求毫秒级精准。
2. 不要把所有视频都套成固定模板，要保留这个视频自己的结构差异。
3. 请区分“普通镜头切换”和“段落级结构边界”。
4. 请特别关注 Hook、商品首次出现、卖点展示、使用/证明/对比、CTA、段落级转场。
5. 如果看到转场，请描述它大概是怎么做的，而不只是说“有转场”。
6. 所有时间都是近似时间，允许有误差。
7. 如果无法判断，请写 unknown 或空数组，不要编造。
8. 只输出合法 JSON，不要输出 Markdown，不要解释 JSON 之外的内容。
```

## User Prompt

```text
下面是一条电商/广告宣传视频的 5 FPS 压缩预览版。

视频信息：
- videoId: {{videoId}}
- duration: {{durationSeconds}} 秒
- previewFps: {{previewFps}}
- previewResolution: {{previewWidth}}x{{previewHeight}}
- purpose: 找出这条视频的粗略爆款结构，为第二阶段逐段精看做准备。

请输出 RoughStructureScan JSON，字段如下：

{
  "videoId": "string",
  "scanMode": "global_preview",
  "sampling": {
    "fps": number,
    "compressed": true,
    "wholeVideo": true
  },
  "roughSummary": {
    "oneSentenceStructure": "string",
    "likelyVideoType": "ecommerce_ad | brand_promo | product_demo | mixed | unknown",
    "globalConversionLogic": "string"
  },
  "roughSegments": [
    {
      "id": "rough_seg_001",
      "approxTimeRange": { "start": number, "end": number },
      "possibleRole": "hook | brand_opening | product_reveal | selling_point | usage_scene | proof | comparison | lifestyle_scene | cta | transition_buffer | unknown",
      "purpose": "这一段在说服链路中的作用",
      "whatHappens": "这一段大概发生了什么",
      "visualSignals": ["画面线索"],
      "textSignals": ["字幕/标题/包装线索"],
      "audioOrRhythmSignals": ["节奏/音频线索"],
      "confidence": number,
      "inspectionQuestions": [
        "第二阶段精看这一段时应该重点回答的问题"
      ]
    }
  ],
  "candidateTransitions": [
    {
      "id": "rough_trans_001",
      "approxTime": number,
      "fromPossibleRole": "string",
      "toPossibleRole": "string",
      "suspectedTransitionType": "hard_cut | beat_cut | title_change | product_reveal | flash_cut | zoom | match_cut | text_card_bridge | scene_change | unknown",
      "roughRecipe": {
        "before": "转场前大概是什么画面/文字",
        "bridge": "中间大概怎么接过去",
        "after": "转场后大概是什么画面/文字"
      },
      "whyItMayBeStructural": "为什么这里可能是段落级转场，而不只是普通切镜",
      "needsCloseInspection": true,
      "inspectionQuestion": "第二阶段要验证什么"
    }
  ],
  "globalNotes": {
    "likelyHookWindow": { "start": number, "end": number },
    "likelyProductFirstSeenAt": number,
    "likelyCtaRegion": { "start": number, "end": number },
    "dominantPackaging": ["例如：大标题", "底部字幕", "卖点卡", "价格条"],
    "importantOpenQuestions": [
      "第一遍看完后仍然不确定、需要第二遍确认的问题"
    ]
  }
}

输出要求：
- roughSegments 应尽量覆盖全片，不要只挑高光片段。
- 每个 roughSegment 时间段可以粗略，但必须按时间顺序排列。
- candidateTransitions 只记录段落级转场候选，不要记录所有普通镜头切换。
- confidence 用 0 到 1。
- 如果某个字段无法判断，写 "unknown" 或空数组，不要编造。
- 只输出合法 JSON。
```

## MacBook Neo 示例变量

```text
videoId=macbook_neo
durationSeconds=229.53
previewFps=5
previewWidth=720
previewHeight=406
videoPath=seed_assets/processed_videos/macbook_neo_preview_5fps_720w.mp4
```
