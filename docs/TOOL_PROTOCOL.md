# 工具协议

系统内部所有工具都输出结构化 JSON，避免只依赖自然语言。

## 1. analyze_video

```json
{
  "name": "analyze_video",
  "input": {
    "videoUrl": "string"
  },
  "output": {
    "metadata": "VideoMetadata",
    "shots": "Shot[]",
    "keyframes": "Keyframe[]",
    "transcript": "TranscriptSegment[]",
    "audioFeatures": "AudioFeature[]"
  }
}
```

## 2. extract_structure

```json
{
  "name": "extract_structure",
  "input": {
    "videoAnalysis": "VideoAnalysis"
  },
  "output": {
    "structureGraph": "ViralStructureGraph"
  }
}
```

## 3. analyze_assets

```json
{
  "name": "analyze_assets",
  "input": {
    "assets": "UploadedAsset[]"
  },
  "output": {
    "assetCards": "AssetCard[]"
  }
}
```

## 4. match_slots

```json
{
  "name": "match_slots",
  "input": {
    "structureGraph": "ViralStructureGraph",
    "assetCards": "AssetCard[]"
  },
  "output": {
    "matches": "SlotMatch[]",
    "gaps": "MaterialGap[]"
  }
}
```

## 5. plan_gap_repairs

```json
{
  "name": "plan_gap_repairs",
  "input": {
    "gaps": "MaterialGap[]",
    "assetCards": "AssetCard[]",
    "newContent": "ContentBrief"
  },
  "output": {
    "repairs": "GapRepair[]"
  }
}
```

## 6. generate_timeline

```json
{
  "name": "generate_timeline",
  "input": {
    "structureGraph": "ViralStructureGraph",
    "newContent": "ContentBrief",
    "matches": "SlotMatch[]",
    "repairs": "GapRepair[]"
  },
  "output": {
    "script": "ScriptSegment[]",
    "storyboard": "StoryboardShot[]",
    "timeline": "TimelineItem[]"
  }
}
```

## 7. render_video

```json
{
  "name": "render_video",
  "input": {
    "timeline": "TimelineItem[]",
    "format": "mp4"
  },
  "output": {
    "previewUrl": "string",
    "renderUrl": "string"
  }
}
```

## 8. apply_edit_instruction

```json
{
  "name": "apply_edit_instruction",
  "input": {
    "instruction": "开头更抓人一些，把商品信息提前",
    "timeline": "TimelineItem[]"
  },
  "output": {
    "patches": "TimelinePatch[]",
    "updatedTimeline": "TimelineItem[]"
  }
}
```
