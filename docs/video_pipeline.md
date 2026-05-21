┌─────────────────────────────────────────────────────────────┐
│              样例视频 Sample Video + 用户输入 User Brief       │
│                       新商品 / 素材 / 卖点                    │
└─────────────────────────────────────────────────────────────┘
              │                                  │
              ▼                                  ▼
┌────────────────────────────┐      ┌────────────────────────────┐
│ Module 1                   │      │ Module 2                   │
│ Sample Understanding        │      │ Asset Understanding         │
│ Compiler                    │      │ 素材理解器                  │
│                             │      │                             │
│ VCA-style 多 Query 探索      │      │ spatial / temporal 理解      │
│ Evidence Harvest             │      │ AssetCard[] 生成             │
│ Global Scan                  │      │ detectedObjects              │
│ Boundary Microscope          │      │ detectedIngredients          │
│ Structure Compile            │      │ suitableSlots                │
└──────────────┬─────────────┘      └──────────────┬─────────────┘
               │                                    │
               ▼                                    ▼
┌────────────────────────────┐      ┌────────────────────────────┐
│ Layer 1A                   │      │ Layer 1B                   │
│ Required Ingredients        │      │ Detected Ingredients        │
│ 样例槽位所需创作要素          │      │ 用户素材已有创作要素          │
│                             │      │                             │
│ human / hand / action        │      │ human / hand / action        │
│ comparison / proof / CTA     │      │ comparison / proof / CTA     │
│ scene / style / packaging    │      │ scene / style / packaging    │
└──────────────┬─────────────┘      └──────────────┬─────────────┘
               │                                    │
               └────────────────┬───────────────────┘
                                ▼
                  ┌────────────────────────────┐
                  │ Module 3                   │
                  │ Slot Matcher + Gap Judge    │
                  │                             │
                  │ required vs detected        │
                  │ coverage scoring            │
                  │ matched / partial / missing │
                  └──────────────┬─────────────┘
                                 │
                       ┌─────────┴─────────┐
                       ▼                   ▼
          ┌────────────────────┐ ┌────────────────────┐
          │ Module 4           │ │ Module 5           │
          │ Timeline Planner    │ │ Gap Repair Planner │
          │                    │ │                    │
          │ 匹配槽位             │ │ 缺口槽位             │
          │ → 脚本/分镜/字幕       │ │ → 包装补全           │
          │ → TimelineProtocol │ │ → 裁切复用           │
          │                    │ │ → 文案补全           │
          │                    │ │ → 结构降级           │
          │                    │ │ → AIGC fallback     │
          └─────────┬──────────┘ └─────────┬──────────┘
                    │                      │
                    └──────────┬───────────┘
                               ▼
                  ┌────────────────────────────┐
                  │ Module 6                   │
                  │ Composer / Renderer         │
                  │ Remotion / FFmpeg           │
                  └──────────────┬─────────────┘
                                 ▼
                  ┌────────────────────────────┐
                  │ Preview / MP4 Demo          │
                  │ + QualityReport             │
                  │ + MigrationTrace            │
                  │ + EvidenceIndex             │
                  └────────────────────────────┘
