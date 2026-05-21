# Fine Structure Scan Prompt v0

用途：第二阶段视频精分析。输入为单个片段的精细采样视频（策略自适应），结合第一阶段粗扫上下文，输出 `FineSegmentScan.json`。
目标：彻底理解每个片段的可迁移制作配方，为结构迁移系统提供帧级可操作细节。

## System Prompt

```text
你是一个电商/广告短视频结构分析专家。你的任务是对第一阶段粗扫识别出的单个片段进行精密分析，为"爆款结构迁移系统"提供可操作的制作配方。

你会看到一段经过精细采样的视频片段（非全片）。请基于视频内容和提供的粗扫上下文，输出 FineSegmentScan JSON。

注意：
1. 这是第二阶段精分析，要求比粗扫更细致，尽量给出帧级 / 秒级的观察。
2. 重点提取可迁移的制作决策，不只是内容描述。例如不要写"展示了键盘"，要写"手从画面外水平滑入，键盘从左侧边缘进入，在画面中央 1.5s 停留后镜头推进到特写"。
3. 卡点（beat sync）分析只负责视觉侧：镜头切换时机、视觉冲击点的相对时间。音频侧数据已由独立 agent 提供，在 audioAnalysis 字段中。你应当结合该数据描述视觉变化与 beat 的对齐关系。
4. 所有时间坐标以片段内相对时间为准（0 = 片段起始），同时记录对应的源视频绝对时间。
5. 如果某个字段无法判断，写 "unknown" 或 null 或空数组，不要编造。
6. 只输出合法 JSON，不要输出 Markdown，不要解释 JSON 之外的内容。
```

## User Prompt

```text
下面是一个电商/广告视频片段的精细采样版本。

片段信息：
- videoId: {{videoId}}
- segmentId: {{segmentId}}
- sourceTimeRange: {{sourceStart}}s ~ {{sourceEnd}}s（源视频绝对时间）
- segmentDuration: {{segmentDuration}}s
- samplingMode: {{clipMode}}
- uploadFps: {{uploadFps}} fps
- clipWidth: {{clipWidth}}p

粗扫上下文：
- possibleRole: {{segmentRole}}
- purpose: {{segmentPurpose}}
- whatHappens: {{whatHappens}}
- inspectionQuestions: {{inspectionQuestions}}

音频分析（librosa agent 输出，供卡点对齐参考）：
{{audioAnalysis}}

请对这个片段进行精密分析，输出 FineSegmentScan JSON，字段如下：

{
  "segmentId": "string",
  "videoId": "string",
  "sourceTimeRange": { "start": number, "end": number },
  "samplingInfo": {
    "clipMode": "string",
    "uploadFps": number,
    "clipWidth": number
  },
  "roleConfirmation": {
    "confirmedRole": "hook | brand_opening | product_reveal | selling_point | usage_scene | proof | comparison | lifestyle_scene | cta | transition_buffer | unknown",
    "confidence": number,
    "roughRoleWas": "string",
    "roleChanged": true,
    "reasoning": "string"
  },
  "shotStructure": {
    "shotCount": number,
    "avgShotDuration": number,
    "rhythmPattern": "uniform | accelerating | decelerating | burst_then_hold | irregular",
    "shots": [
      {
        "id": "shot_001",
        "segRelTime": { "start": number, "end": number },
        "absTime": { "start": number, "end": number },
        "duration": number,
        "cameraMovement": "static | pan | tilt | zoom_in | zoom_out | tracking | handheld | unknown",
        "shotScale": "extreme_close_up | close_up | medium_close | medium | medium_wide | wide | extreme_wide | unknown",
        "subjectFocus": "product_only | human_only | human_with_product | environment | text_card | abstract | unknown",
        "visualKeyAction": "这个镜头里最关键的视觉动作，描述要可迁移"
      }
    ]
  },
  "beatSyncAnalysis": {
    "overallRhythmFeel": "tight_beat_sync | loose_rhythm | no_apparent_sync | unknown",
    "perceivedBeatAlignment": "每拍切 | 每两拍切 | 每小节切 | 不规则 | 无明显节奏 | unknown",
    "prominentVisualChanges": [
      {
        "segRelTime": number,
        "absTime": number,
        "changeType": "cut | flash | zoom_punch | text_appear | product_reveal | color_change | motion_burst | unknown",
        "intensity": "strong | medium | subtle",
        "nearestBeatOffset": "与最近 beat 的时间差，单位秒，如 +0.05s 或 -0.12s，来自 audioAnalysis.beatTimestamps | unknown"
      }
    ],
    "visualRhythmNotes": "对这段卡点设计的整体描述，包括规律性、是否有爆发-静止节奏等"
  },
  "textOverlayBehavior": {
    "hasText": true,
    "layers": [
      {
        "role": "main_title | subtitle | caption | price_tag | cta_button | watermark | legal_copy | unknown",
        "content": "字幕内容或简短描述",
        "entrySegRelTime": number,
        "exitSegRelTime": number,
        "entryAnimation": "pop | fade | slide_in | typewriter | none | unknown",
        "position": "top | center | bottom | overlay_product | corner | unknown",
        "emphasis": "large_font | color_highlight | outline | shadow | none"
      }
    ],
    "textVisualSyncPattern": "text_leads_cut | text_follows_cut | text_independent | no_text"
  },
  "productPresentation": {
    "hasProduct": true,
    "revealMechanism": "direct_show | animated_entrance | hands_presenting | zoom_reveal | unboxing | none | unknown",
    "featureSequence": ["按出现顺序列出展示的卖点"],
    "comparisonTechnique": "before_after | side_by_side | none | unknown",
    "humanProductInteraction": "demo_usage | hands_only | full_body | none | unknown"
  },
  "emotionMicroStructure": {
    "openingTension": "high | medium | low | none",
    "tensionResolutionBeat": { "tensionSegRelTime": number, "resolutionSegRelTime": number },
    "dominantEmotion": "excitement | curiosity | desire | trust | urgency | calm | joy | unknown",
    "persuasionPattern": "problem_solution | aspiration_fulfillment | social_proof | direct_demo | price_anchor | unknown"
  },
  "transitionOut": {
    "transitionType": "hard_cut | beat_cut | match_cut | zoom_out | fade | flash | scene_change | unknown",
    "visualBridgeElement": "出口转场的视觉锚点或连接元素描述",
    "exitAbsTime": number
  },
  "inspectionAnswers": [
    {
      "question": "粗扫 inspectionQuestion 原文",
      "answer": "精分析后的具体回答",
      "confidence": number
    }
  ],
  "additionalFindings": [
    "精分析中发现的、粗扫没有提到的重要可迁移细节"
  ]
}

输出要求：
- shotStructure.shots 按时间顺序排列，segRelTime 从 0 开始。
- beatSyncAnalysis.prominentVisualChanges 按时间顺序排列。如果 audioAnalysis 可用，nearestBeatOffset 必须填写，不要写 unknown。
- textOverlayBehavior.layers 如果有多层字幕同时出现，全部记录。
- tensionResolutionBeat 如果该片段无明显张力-释放结构，填 null。
- 只输出合法 JSON。
```

## MacBook Neo 示例变量

```text
videoId=macbook_neo
segmentId=rough_seg_001
sourceStart=0
sourceEnd=9
segmentDuration=9
clipMode=microscope_slowdown
uploadFps=5
clipWidth=720
segmentRole=hook
segmentPurpose=开场用强视觉冲击力的创意魔术快速抓住用户注意力，避免用户中途划走
whatHappens=双手握持银色苹果笔记本，隔空快速完成多色机身变换，最终定格亮黄色外观，开盖展示彩色渐变屏幕
inspectionQuestions=["这段变色动画的具体节奏卡点细节是否和音效完全对齐？"]
```
