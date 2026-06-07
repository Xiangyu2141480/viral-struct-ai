# Kangshifu Plain User Uploads

Put ordinary user-shot Kangshifu iced tea test videos in this directory when you want to evaluate Asset Manager material coverage.

Recommended filenames:

- `plain_001_table_product_pan.mp4`
- `plain_002_hand_pickup.mp4`
- `plain_003_open_cap.mp4`
- `plain_004_drink_neck_down.mp4`
- `plain_005_product_label_closeup.mp4`
- `plain_006_open_cap_hands.mp4`
- `plain_009_bad_dark_shaky.mp4`

Most local video files in this folder are intentionally ignored by Git to avoid committing large media by accident. The allowlisted `plain_001` through `plain_006` samples are intentionally tracked so the plain-user Asset Manager test has reproducible real vertical-video inputs. Later 16:9 uploads should stay local and are not part of this PR.

After adding or replacing local files, rerun the Asset Manager plain-material audit from the repository root:

```powershell
pnpm --dir apps/api exec tsx ../../scripts/manual_test_asset_manager.ts
```

The audit regenerates:

- `seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json`
- `tmp/asset-supply-original.json`
- `tmp/asset-supply-plain.json`
- `tmp/asset-manager-comparison-report.md`
