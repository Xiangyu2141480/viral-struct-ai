# Final Delivery / 最终交付说明

## 1. Deliverables

Required delivery package:

- Code repository.
- Demo recording.
- Video/result case evidence.
- Project documentation.

Recommended documentation set:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_PLAN.md`
- `docs/DEMO_SCRIPT.md`
- `docs/scoring-map.md`
- `docs/safety-and-ai-tools.md`
- `docs/TOOL_PROTOCOL.md`
- `docs/asset-manager-ui-contract.md`
- `docs/asset-manager-video-agent-contract.md`
- `docs/examples/*.json`

## 2. Main Demo Path

Primary review route:

```txt
http://localhost:3000/demo
```

The `/demo` route is the safest path for judges because it uses a fixed case and checked-in evidence:

```txt
macbook_neo sample structure
  -> 康师傅冰红茶 brief and AssetCard library
  -> slot/gap/repair
  -> timeline and quality report
  -> evidence trace
```

## 3. Standard Product Flow

Secondary route:

```txt
/analyze -> /graph -> /adapt -> /gaps -> /result
```

Use this route to show the product form:

- sample video analysis
- structure graph
- new content and asset input
- gap board
- final result

## 4. Current Completed Capabilities

| Capability | Status | Evidence |
|---|---|---|
| Standard strong chain | Complete | slots/gaps/timeline fallback-capable routes |
| Generation Trace | Complete | `/gaps`, `/result` |
| Migration Evidence | Complete | `/result` |
| Variant Diff | Complete | `/result` |
| Natural Language Edit Patch | Complete as rule-based patch | `/api/timeline/apply-edit`, Edit Summary |
| Quality metrics | Complete | `/api/quality/evaluate`, `/demo` |
| Asset Manager data contract | Complete for backend/data handoff | `AssetAnalysisProfile`, `AssetLibraryReport`, `SlotCoverageMatrix`, `AssetSupplyContext` |
| Asset supply context | Complete for contract/API handoff | `/api/assets/manager/asset-supply-context`, `docs/examples/asset-supply-context.sample.json`; legacy `/video-agent-bundle` returns the same `asset-supply-v1` response |
| Asset Manager scenario support | Complete for backend/data handoff | `MaterialScenarioProfile`, `MissingMaterialBrief`, scenario sample JSON, manual scenario script |
| Missing material input briefs | Complete as handoff inputs | manual shoot brief, AIGC prompt brief, HyperFrames brief; no real external generation |
| Asset Evidence integration | Complete in data layer and minimal evidence panel | `SlotMatch.assetEvidence`, `apps/web/app/_struct/AssetManagerEvidence.tsx` |
| Transition Grammar | Complete as plan-only handoff | `TransitionRecipe`, `CategoryPresetRegistry`, `docs/examples/transition-recipes-beverage-demo.sample.json` |
| Sonic Grammar | Complete as plan-only handoff | `AudioTrackPlan`, `AudioCue`, `AudioGenerationJobCard`, `docs/examples/audio-plan-beverage-demo.sample.json` |
| Transition/Sonic evidence cards | Complete as minimal UI evidence | existing Asset Manager evidence panel shows Transition Plan, Sonic Plan, Missing Transition Assets, Audio Warnings |
| Optional VLM asset analyzer | Available but disabled by default | deterministic fallback, `ASSET_VLM_ENABLED=false` |
| LLM fallback | Complete | source fields and warnings |
| Deterministic fallback without key | Complete | tests and demo-safe flow |
| Web visual preview | Complete | `/result` |
| MP4 export | Not claimed | Remotion package remains placeholder |

## 5. Pre-Submission Commands

```bash
pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
rg --hidden -n "ark-[A-Za-z0-9-]+" .
```

Expected:

- typecheck passes
- tests pass
- build passes
- secret scan returns no matches

## 6. Recording Checklist

- Start on `/demo`.
- Run the demo and show evidence trace.
- Open `/result` and show:
- Generation Trace
- Migration Evidence
- Asset Evidence if UI handoff fields are being shown
- Transition / Sonic Grammar evidence cards if shown
- Variant Diff
- Edit Summary after natural-language edit
- Quality metrics
- Mention fallback safety.
- Mention known limits honestly.

## 7. Known Limits To State Clearly

- Remotion is not the stable main delivery surface.
- Real MP4 export is not the focus of this checkpoint.
- Video material understanding is lightweight and protocol-oriented.
- Asset Manager UI panels are a handoff target for frontend teammates; this checkpoint completes the backend/data contract and examples.
- Asset Manager `MissingMaterialBrief` is a handoff input for downstream repair/generation/render modules, not the final repair strategy.
- AIGC-ready means prompt-ready planning only; Gemini, Seedance, and HyperFrames are not called by Asset Manager.
- Transition recipes and audio cues are plan-only / job-card-only. They do not call external video or audio generation, do not mix audio into MP4, and do not claim real rendered output.
- The ice tea mapping is a beverage demo case. The core contracts remain category-agnostic and can fall back to `generic`.
- Offline diagnostic scores, if shown, are not fake CTR, conversion, or real user behavior.
- Deterministic asset analysis is the main path; optional VLM enrichment is disabled by default and must not be required for the demo.
- SAM2, GroundingDINO, SigLIP2, VideoRAG, and complete long-video temporal grounding are not implemented.
- Natural-language editing is deterministic rule-based patching.
- The system does not copy source video content.

## 8. Safety Checklist

- No real API key in repo.
- No real API key in screenshots.
- No unauthorized large media added for this final checkpoint.
- No claim of complete production editing software.
- No claim of guaranteed factual marketing statements.

## 9. Suggested Final QA

Before submission, have one teammate run the full demo from a clean terminal and record:

- commands used
- browser path
- any fallback warnings
- screenshots of `/demo`, `/gaps`, `/result`
- final secret scan result
