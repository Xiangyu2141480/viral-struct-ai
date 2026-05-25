import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "assemble_timeline.py"


def load_module():
    spec = importlib.util.spec_from_file_location("assemble_timeline", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class AssembleTimelineTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_assemble_inserts_transition_units_and_patches_adjacent_blocks(self):
        rough_scan = {
            "videoId": "demo",
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 0, "end": 10},
                    "coarseRoleGuess": "attention_grab",
                    "observableSummary": "opening",
                },
                {
                    "id": "block_002",
                    "timeRange": {"start": 10, "end": 20},
                    "coarseRoleGuess": "feature_or_claim",
                    "observableSummary": "feature",
                },
            ],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 10,
                    "inspectionWindow": {"start": 7.5, "end": 12.5},
                }
            ],
        }
        boundary_scan = {
            "schemaVersion": "boundary_micro_scan_v1",
            "boundaries": [
                {
                    "boundaryId": "boundary_001",
                    "timelinePatch": {
                        "patchType": "insert_transition_unit",
                        "fromBlockId": "block_001",
                        "toBlockId": "block_002",
                        "fromBlockPatch": {
                            "id": "block_001",
                            "timeRangePatch": {"end": 8.8},
                        },
                        "transitionUnit": {
                            "id": "transition_boundary_001",
                            "unitType": "transition",
                            "timeRange": {"start": 8.8, "end": 11.2},
                            "techniqueTags": ["flash", "zoom_out"],
                            "confidence": 0.91,
                            "semanticPivotTime": 10.0,
                        },
                        "toBlockPatch": {
                            "id": "block_002",
                            "timeRangePatch": {"start": 11.2},
                        },
                    },
                }
            ],
        }

        assembled = self.module.assemble_timeline(rough_scan, boundary_scan)

        self.assertEqual(assembled["schemaVersion"], "content_transition_timeline_v1")
        self.assertEqual(assembled["videoId"], "demo")
        # v2.5: transition unit id unified to boundary's canonical id
        # (was "transition_boundary_001" before unification).
        self.assertEqual([unit["id"] for unit in assembled["timelineUnits"]], [
            "block_001",
            "boundary_001",
            "block_002",
        ])
        self.assertEqual(assembled["timelineUnits"][0]["timeRange"], {"start": 0.0, "end": 8.8})
        self.assertEqual(assembled["timelineUnits"][1]["unitType"], "transition")
        self.assertEqual(assembled["timelineUnits"][1]["timeRange"], {"start": 8.8, "end": 11.2})
        # v2.5: transition unit must carry boundaryId pointing to its parent boundary
        self.assertEqual(assembled["timelineUnits"][1]["boundaryId"], "boundary_001")
        # v2.5: transition unit must expose canonicalBoundaryTime (preferring semanticPivotTime)
        self.assertEqual(assembled["timelineUnits"][1]["canonicalBoundaryTime"], 10.0)
        self.assertEqual(assembled["timelineUnits"][2]["timeRange"], {"start": 11.2, "end": 20.0})
        self.assertEqual(assembled["assemblyStats"]["transitionUnitCount"], 1)
        self.assertEqual(assembled["assemblyStats"]["patchedBoundaryCount"], 1)
        self.assertEqual(assembled["assemblyStats"]["unscannedBoundaryCount"], 0)

    def test_transition_canonical_boundary_time_falls_back_to_midpoint_when_pivot_missing(self):
        """v2.5: if boundary_micro_scan didn't emit semanticPivotTime, derive
        canonicalBoundaryTime from the midpoint of timeRange."""
        rough_scan = {
            "videoId": "demo",
            "contentBlocks": [
                {"id": "block_001", "timeRange": {"start": 0, "end": 10}},
                {"id": "block_002", "timeRange": {"start": 10, "end": 20}},
            ],
            "boundaryCandidates": [
                {"id": "boundary_001", "fromBlockId": "block_001", "toBlockId": "block_002",
                 "roughBoundaryTime": 10},
            ],
        }
        boundary_scan = {
            "boundaries": [
                {
                    "boundaryId": "boundary_001",
                    "timelinePatch": {
                        "patchType": "insert_transition_unit",
                        "fromBlockId": "block_001",
                        "toBlockId": "block_002",
                        # Patch blocks to make room for the transition window
                        "fromBlockPatch": {"id": "block_001", "timeRangePatch": {"end": 9.0}},
                        "toBlockPatch": {"id": "block_002", "timeRangePatch": {"start": 11.0}},
                        "transitionUnit": {
                            "id": "ignored",
                            "unitType": "transition",
                            "timeRange": {"start": 9.0, "end": 11.0},
                            # No semanticPivotTime — should fall back to midpoint 10.0
                        },
                    },
                }
            ],
        }

        assembled = self.module.assemble_timeline(rough_scan, boundary_scan)
        transition = assembled["timelineUnits"][1]
        self.assertEqual(transition["id"], "boundary_001")
        self.assertEqual(transition["canonicalBoundaryTime"], 10.0)

    def test_assemble_keeps_unscanned_stage_one_boundaries_as_content_boundaries(self):
        rough_scan = {
            "videoId": "demo",
            "contentBlocks": [
                {"id": "block_001", "timeRange": {"start": 0, "end": 5}},
                {"id": "block_002", "timeRange": {"start": 5, "end": 12}},
            ],
            "boundaryCandidates": [
                {"id": "boundary_001", "fromBlockId": "block_001", "toBlockId": "block_002"},
            ],
        }

        assembled = self.module.assemble_timeline(rough_scan, {"boundaries": []})

        self.assertEqual([unit["id"] for unit in assembled["timelineUnits"]], ["block_001", "block_002"])
        self.assertEqual(assembled["timelineUnits"][0]["timeRange"], {"start": 0.0, "end": 5.0})
        self.assertEqual(assembled["timelineUnits"][1]["timeRange"], {"start": 5.0, "end": 12.0})
        self.assertEqual(assembled["assemblyStats"]["unscannedBoundaryCount"], 1)

    def test_cli_writes_assembled_timeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            rough_path = tmp_dir / "rough.json"
            boundary_path = tmp_dir / "boundary.json"
            out_path = tmp_dir / "timeline.json"
            rough_path.write_text(
                json.dumps(
                    {
                        "videoId": "demo",
                        "contentBlocks": [
                            {"id": "block_001", "timeRange": {"start": 0, "end": 3}},
                        ],
                        "boundaryCandidates": [],
                    }
                ),
                encoding="utf-8",
            )
            boundary_path.write_text(json.dumps({"boundaries": []}), encoding="utf-8")

            exit_code = self.module.main([
                "--rough-scan",
                str(rough_path),
                "--boundary-scan",
                str(boundary_path),
                "--out",
                str(out_path),
            ])

            self.assertEqual(exit_code, 0)
            self.assertTrue(out_path.exists())
            written = json.loads(out_path.read_text(encoding="utf-8"))
            self.assertEqual(written["timelineUnits"][0]["id"], "block_001")


if __name__ == "__main__":
    unittest.main()
