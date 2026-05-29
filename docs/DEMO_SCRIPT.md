# Demo Script / 3-5 Minute Recording Script

## Goal

Show that Viral Struct AI can learn a transferable short-video structure from a sample, adapt it to a new product, diagnose missing materials, repair the gaps, generate a timeline, and support human edits.

Main route:

```txt
/demo
```

Secondary product route:

```txt
/analyze -> /graph -> /adapt -> /gaps -> /result
```

## 0:00 - 0:30 Opening

Say:

> This project is an AI creation platform for short-video structure migration. It does not copy the sample video. It extracts the sample's reusable creative structure: hook, rhythm, shot slots, packaging and CTA logic, then maps that structure to a new product and available materials.

Show:

- README or `/demo` page.
- Mention the main demo case: macbook_neo sample structure to 康师傅冰红茶.

## 0:30 - 1:10 Main Demo Chain

Open:

```txt
http://localhost:3000/demo
```

Action:

- Run the demo.
- Point to the evidence trace.

Say:

> The demo runs the whole chain: source analysis, rough/fine structure artifacts, AssetCard library, slot matching, gap repair, timeline generation and quality evaluation. The important part is that every step has evidence, not just a final answer.

Show:

- evidenceTrace
- transition fidelity
- migration contract statistics
- quality report

## 1:10 - 1:50 Standard Workflow

Open pages in order:

```txt
/analyze
/graph
/adapt
/gaps
/result
```

Say:

> The standard product flow uses the same strong chain as the demo path. If a model call is unavailable, the system falls back to deterministic rules and labels the source instead of hiding the fallback.

Show:

- `/analyze`: video metadata/keyframes.
- `/graph`: structure graph and migration contract.
- `/adapt`: product brief and AssetCard material library.
- `/gaps`: matching/gap/repair source badges.

## 1:50 - 2:40 Migration Evidence

Open:

```txt
/result
```

Say:

> This is the key scoring evidence. Each row explains how a source structure becomes a new result: source pattern, migrated content, asset coverage or gap, repair strategy and final timeline item.

Show:

- Generation Trace
- Migration Evidence
- Timeline list
- Web visual preview

Call out:

- Source Structure
- New Mapping
- Asset / Gap
- Repair
- Final Timeline

## 2:40 - 3:20 Variant Diff

Action:

- Generate or switch high_click.
- Generate or switch high_conversion.
- Generate or switch premium.

Say:

> The system can generate different strategic versions from the same structure. High-click strengthens the hook and rhythm. High-conversion moves product information and CTA earlier. Premium reduces subtitle pressure and uses more restrained packaging.

Show:

- Variant Diff panel.
- changed hook/CTA.
- different transition/caption/card styles.

## 3:20 - 4:10 Natural Language Edit

In `/result`, enter one or more instructions:

```txt
开头更抓人
商品信息提前
减少字幕
增强节奏感
CTA 更强
```

Say:

> The natural-language edit is not a fake UI note. It calls `/api/timeline/apply-edit`, receives an updated timeline, patch summary and changed items, then updates the result page.

Show:

- Edit Summary.
- changed items.
- before/after script/timing/packaging.

## 4:10 - 4:40 Safety And Limits

Say:

> The project is intentionally transparent about limits. Remotion is not claimed as a final MP4 export path in this checkpoint. ASR is not required for the main demo. Natural-language editing is a rule-based timeline patch, not a full professional editor. API keys are never committed; model failures are shown as fallback warnings.

Show:

- `docs/safety-and-ai-tools.md`.
- Generation Trace warnings if available.

## 4:40 - 5:00 Close

Say:

> The core contribution is defining video structure as a transferable protocol and making the migration process explainable. The evaluator can see what was extracted, how it maps to new content, where material gaps occur, how the system repairs them and what final timeline is produced.

End on:

- `/result` Migration Evidence or `/demo` full evidence chain.
