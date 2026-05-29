# Safety And AI Tools / 安全边界与 AI 工具说明

## 1. AI Tool Usage Statement

本项目允许使用 AI 工具辅助方案设计、编码、调试、脚本生成、视频分析和文档整理，但核心产品定义、结构协议、任务拆解、工程集成、演示链路和安全边界由项目团队自主设计与实现。

| Tool / Capability | Used For | Boundary |
|---|---|---|
| Codex / Cursor / Claude Code | coding, debugging, documentation, PR review | outputs require human review before merge |
| ChatGPT / Claude / Doubao | script ideas, structured analysis, copy drafts | output must be converted into project protocols |
| Volcengine Doubao | optional OpenAI-compatible LLM provider | API key only through local environment variables |
| FFmpeg / ffprobe | metadata, covers, keyframes | only for authorized project/user media |
| Python rough/fine scan scripts | visual rhythm, boundaries, structure artifacts | artifacts are checked and validated before use |
| ASR tools | optional transcript extraction | not required for the standard demo; manual transcript fallback exists |
| Remotion | future/rendering package skeleton | not claimed as stable MP4 export in this checkpoint |

## 2. Self-Designed System Parts

The following are project-owned designs:

- `ViralStructureGraph`: structure protocol for short-video migration.
- `ShotSlot`: slot-level requirements and migration contracts.
- `AssetCard`: structured user/demo asset understanding.
- `SlotMatch`: slot-to-asset alignment with source and rationale.
- `MaterialGap`: explicit material shortage diagnosis.
- `GapRepair`: repair strategy planning.
- `TimelineItem`: explainable result timeline.
- `QualityReport`: structure and result quality metrics.
- `PipelineTrace`: source/warning evidence for the standard workflow.
- `MigrationEvidence`: explainability chain from source pattern to final result.
- `/api/timeline/apply-edit`: rule-based natural-language patch pipeline.

## 3. Secret Handling

Allowed:

```txt
LLM_API_KEY in local environment variables
LLM_BASE_URL in local environment variables
LLM_MODEL in local environment variables
.env.example with empty placeholders
```

Forbidden:

```txt
committing real API keys
placing keys in README/docs/issues/PR descriptions
placing keys in frontend code
printing keys in logs or errors
embedding keys in screenshots
```

Recommended local setup:

```powershell
$env:LLM_API_KEY="<local-only-key>"
$env:LLM_BASE_URL="<provider-base-url>"
$env:LLM_MODEL="Doubao-Seed-2.0-lite"
```

Before PR:

```bash
rg --hidden -n "ark-[A-Za-z0-9-]+" .
```

The command should return no matches.

## 4. Content Safety Boundary

The system migrates:

```txt
structure
rhythm
shot intent
caption density
packaging strategy
CTA placement
material coverage logic
```

The system does not migrate:

```txt
source video footage
source music
source speaker likeness
copyrighted visual assets
brand-owned expression from the sample video
```

Strong marketing claims must come from user input or evidence. Without evidence, copy should be softened. Examples:

| Unsafe Claim | Safer Fallback |
|---|---|
| "销量第一" | "适合高频使用场景" |
| "立刻见效" | "强调使用体验" |
| "官方认证" | "突出用户提供的证明材料" |

## 5. Fallback Policy

All model-adjacent paths must be demo-safe:

```txt
LLM available and output valid -> use LLM enhanced result
LLM unavailable / key missing / output invalid -> deterministic fallback
UI displays source + warning
```

Current fallback-visible fields:

- `alignmentSource`
- `gapSpecSource`
- `scriptSource`
- `warnings`
- `analysisSource`

## 6. What We Do Not Claim

This checkpoint does not claim:

- complete Remotion/MP4 export
- complete ASR-first workflow
- full professional video editor
- model training
- fully autonomous creative agent
- guaranteed factual marketing claims
- direct reproduction of sample content

The demo should be presented as an explainable AI creation planning system with a Web visual preview and timeline protocol.
