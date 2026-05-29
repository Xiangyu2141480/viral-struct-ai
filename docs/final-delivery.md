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
  - Variant Diff
  - Edit Summary after natural-language edit
  - Quality metrics
- Mention fallback safety.
- Mention known limits honestly.

## 7. Known Limits To State Clearly

- Remotion is not the stable main delivery surface.
- Real MP4 export is not the focus of this checkpoint.
- Video material understanding is lightweight and protocol-oriented.
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
