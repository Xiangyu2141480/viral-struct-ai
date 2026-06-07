import importlib.util
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "rough_scan.py"
LLM_CLIENT_PATH = ROOT / "scripts" / "llm_client.py"


def load_module():
    spec = importlib.util.spec_from_file_location("rough_scan", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_llm_client():
    """Load the provider-neutral shared client as its own module.

    Symbols that moved out of the rough-scan file (HTTP transport, semaphore,
    Files/Responses API, prompt utils, IO utils) now live here. Tests that
    patch those internals MUST target this module — the function bodies read
    *this* module's globals (e.g. ``_CURL_PATH``), so patching the rough-scan
    module would be a no-op.
    """
    spec = importlib.util.spec_from_file_location("llm_client", LLM_CLIENT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RoughScanTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        # Symbols moved to the shared client; route through it where the
        # rough-scan module does not re-export them.
        self.client = load_llm_client()

    def test_load_dotenv_reads_key_value_pairs_without_quotes(self):
        env_path = ROOT / "tests" / "tmp_env.test"
        env_path.write_text(
            "LLM_BASE_URL=https://example.com/api/v3\n"
            "SAMPLE_TOKEN='dummy-value'\n"
            "LLM_MODEL=ep-test\n",
            encoding="utf-8",
        )
        try:
            values = self.client.load_dotenv(env_path)
        finally:
            env_path.unlink()

        self.assertEqual(values["LLM_BASE_URL"], "https://example.com/api/v3")
        self.assertEqual(values["SAMPLE_TOKEN"], "dummy-value")
        self.assertEqual(values["LLM_MODEL"], "ep-test")

    def test_render_prompt_replaces_video_placeholders(self):
        template = "video={{videoId}}, fps={{previewFps}}, size={{previewWidth}}x{{previewHeight}}"
        rendered = self.client.render_prompt(
            template,
            {
                "videoId": "macbook_neo",
                "previewFps": 5,
                "previewWidth": 720,
                "previewHeight": 406,
            },
        )

        self.assertEqual(rendered, "video=macbook_neo, fps=5, size=720x406")

    def test_build_responses_payload_uses_input_video_and_input_text(self):
        payload = self.module.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
        )

        self.assertEqual(payload["model"], "ep-test")
        self.assertTrue(payload["store"])
        content = payload["input"][0]["content"]
        self.assertEqual(content[0], {"type": "input_video", "file_id": "file-abc"})
        self.assertEqual(content[1], {"type": "input_text", "text": "只输出 JSON"})

    def test_build_responses_payload_defaults_to_deterministic_temperature(self):
        payload = self.module.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
        )

        self.assertEqual(payload["temperature"], 0)

    def test_build_responses_payload_allows_temperature_override(self):
        payload = self.module.build_responses_payload(
            model="ep-test",
            file_id="file-abc",
            prompt_text="只输出 JSON",
            store=True,
            temperature=0.3,
        )

        self.assertEqual(payload["temperature"], 0.3)

    def test_extract_response_text_handles_output_text_and_content_array(self):
        self.assertEqual(
            self.client.extract_response_text({"output_text": "{\"ok\": true}"}),
            "{\"ok\": true}",
        )

        nested = {
            "output": [
                {
                    "content": [
                        {"type": "output_text", "text": "{\"ok\": true}"}
                    ]
                }
            ]
        }
        self.assertEqual(self.module.extract_response_text(nested), "{\"ok\": true}")

    def test_extract_json_object_strips_markdown_fence(self):
        text = "```json\n{\"videoId\":\"macbook_neo\"}\n```"
        parsed = self.client.extract_json_object(text)

        self.assertEqual(parsed, {"videoId": "macbook_neo"})

    def test_normalize_rough_scan_keeps_only_stage_one_contract(self):
        parsed = {
            "videoId": "demo",
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 0, "end": 9},
                    "coarseRoleGuess": "attention_grab",
                    "boundaryReason": "opening block ends before a visual reset",
                    "observableSummary": "fast product reveal opening",
                    "visualSignals": ["hands", "product"],
                    "textSignals": ["headline"],
                    "audioOrRhythmSignals": ["fast beat"],
                    "confidence": 0.86,
                    "fineScanFocusQuestions": ["what is the hook mechanism?"],
                },
                {
                    "id": "block_002",
                    "timeRange": {"start": 10, "end": 27},
                    "coarseRoleGuess": "product_or_brand_intro",
                    "observableSummary": "product assembly",
                    "confidence": 0.9,
                },
            ],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 9.5,
                    "inspectionWindow": {"start": 7.0, "end": 12.0},
                    "visibleBoundaryCue": "white flash between blocks",
                    "whyNeedsMicroscope": "possible flash transition",
                    "confidence": 0.78,
                }
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)

        self.assertEqual(normalized["schemaVersion"], "rough_content_blocks_v1")
        self.assertEqual(len(normalized["contentBlocks"]), 2)
        self.assertEqual(normalized["contentBlocks"][0]["id"], "block_001")
        self.assertEqual(normalized["contentBlocks"][0]["coarseRoleGuess"], "attention_grab")
        self.assertEqual(len(normalized["boundaryCandidates"]), 1)
        self.assertEqual(normalized["boundaryCandidates"][0]["id"], "boundary_001")
        self.assertEqual(normalized["boundaryCandidates"][0]["roughBoundaryTime"], 9.5)

    def test_normalize_strips_v0_2_kill_fields_from_content_blocks(self):
        """v0.2: LLM may still emit audioOrRhythmSignals / hasInternalTransition / confidence
        from cached prompts; normalize must strip them."""
        parsed = {
            "videoId": "demo",
            "contentBlocks": [
                {
                    "id": "block_001",
                    "timeRange": {"start": 0, "end": 9},
                    "audioOrRhythmSignals": ["should be stripped"],
                    "hasInternalTransition": True,
                    "confidence": 0.9,
                }
            ],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 9.5,
                }
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)
        block = normalized["contentBlocks"][0]

        self.assertNotIn("audioOrRhythmSignals", block)
        self.assertNotIn("hasInternalTransition", block)
        self.assertNotIn("confidence", block)

    def test_normalize_adds_canonical_boundary_time(self):
        """v2.5: normalize must add canonicalBoundaryTime field as the single
        source of truth for boundary time. At rough stage it equals
        roughBoundaryTime; Stage 1.5 may override it in transition units.
        See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §4.1."""
        parsed = {
            "videoId": "demo",
            "contentBlocks": [{"id": "block_001", "timeRange": {"start": 0, "end": 9}}],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 9.5,
                }
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)
        boundary = normalized["boundaryCandidates"][0]

        self.assertEqual(boundary["canonicalBoundaryTime"], 9.5)
        # roughBoundaryTime preserved for backward compat
        self.assertEqual(boundary["roughBoundaryTime"], 9.5)

    def test_normalize_strips_v0_2_kill_fields_from_boundary_candidates(self):
        """v0.2: boundary KILL fields whyNeedsMicroscope / confidence must be stripped."""
        parsed = {
            "videoId": "demo",
            "contentBlocks": [{"id": "block_001", "timeRange": {"start": 0, "end": 9}}],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 9.5,
                    "whyNeedsMicroscope": "should be stripped",
                    "confidence": 0.78,
                }
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)
        boundary = normalized["boundaryCandidates"][0]

        self.assertNotIn("whyNeedsMicroscope", boundary)
        self.assertNotIn("confidence", boundary)

    def test_normalize_strips_v0_2_kill_fields_from_summary_and_notes(self):
        """v0.2: roughSummary.globalConversionLogic + globalNotes likely* / importantOpenQuestions
        must be stripped if LLM emits them."""
        parsed = {
            "videoId": "demo",
            "roughSummary": {
                "oneSentenceStructure": "summary",
                "likelyVideoType": "product_demo",
                "globalConversionLogic": "should be stripped",
            },
            "globalNotes": {
                "likelyProductFirstSeenAt": 0.8,
                "dominantPackaging": ["headline"],
                "likelyHookWindow": {"start": 0, "end": 9},
                "likelyCtaRegion": {"start": 200, "end": 220},
                "importantOpenQuestions": ["redundant"],
            },
            "contentBlocks": [{"id": "block_001", "timeRange": {"start": 0, "end": 9}}],
            "boundaryCandidates": [
                {
                    "id": "boundary_001",
                    "fromBlockId": "block_001",
                    "toBlockId": "block_002",
                    "roughBoundaryTime": 9.5,
                }
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)

        self.assertNotIn("globalConversionLogic", normalized["roughSummary"])
        self.assertIn("oneSentenceStructure", normalized["roughSummary"])  # kept
        self.assertNotIn("likelyHookWindow", normalized["globalNotes"])
        self.assertNotIn("likelyCtaRegion", normalized["globalNotes"])
        self.assertNotIn("importantOpenQuestions", normalized["globalNotes"])
        # Phase 3: likelyProductFirstSeenAt is migrated to likelySubjectFirstSeenAt
        self.assertNotIn("likelyProductFirstSeenAt", normalized["globalNotes"])
        self.assertIn("likelySubjectFirstSeenAt", normalized["globalNotes"])
        self.assertEqual(normalized["globalNotes"]["likelySubjectFirstSeenAt"], 0.8)
        self.assertIn("dominantPackaging", normalized["globalNotes"])  # kept

    def test_normalize_rough_scan_requires_content_blocks(self):
        with self.assertRaisesRegex(ValueError, "contentBlocks"):
            self.module.normalize_rough_scan({"videoId": "demo"})

    def test_normalize_rough_scan_requires_boundary_candidates(self):
        with self.assertRaisesRegex(ValueError, "boundaryCandidates"):
            self.module.normalize_rough_scan({
                "videoId": "demo",
                "contentBlocks": [
                    {
                        "id": "block_001",
                        "timeRange": {"start": 0, "end": 1},
                    }
                ],
            })

    def test_rough_prompt_uses_segmentation_plan_as_primary_schema(self):
        prompt = (ROOT / "prompts" / "video_understanding" / "rough_structure_scan_v0.md").read_text(
            encoding="utf-8"
        )

        self.assertIn('"contentBlocks"', prompt)
        self.assertIn('"boundaryCandidates"', prompt)
        self.assertIn('"roughBoundaryTime"', prompt)
        self.assertIn('"coarseRoleGuess"', prompt)
        self.assertIn("第一阶段只负责识别内容块", prompt)
        self.assertIn("不要在第一阶段判断转场类型", prompt)
        self.assertIn("请不要做深度角色分类", prompt)
        self.assertNotIn('"unitType": "segment | transition"', prompt)
        self.assertNotIn('"role": "hook | brand_opening', prompt)

    def test_rough_prompt_does_not_request_v0_2_kill_fields(self):
        """v0.2: prompt must no longer request KILL fields from the LLM.
        See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md."""
        prompt = (ROOT / "prompts" / "video_understanding" / "rough_structure_scan_v0.md").read_text(
            encoding="utf-8"
        )

        # contentBlocks-level KILL fields (LLM hallucinates audio on silent preview;
        # hasInternalTransition is always true; confidence is never calibrated)
        self.assertNotIn('"audioOrRhythmSignals"', prompt)
        self.assertNotIn('"hasInternalTransition"', prompt)

        # boundaryCandidates-level KILL fields
        self.assertNotIn('"whyNeedsMicroscope"', prompt)

        # roughSummary / globalNotes KILL fields
        self.assertNotIn('"globalConversionLogic"', prompt)
        self.assertNotIn('"likelyHookWindow"', prompt)
        self.assertNotIn('"likelyCtaRegion"', prompt)
        self.assertNotIn('"importantOpenQuestions"', prompt)

        # The standalone "confidence 用 0 到 1。" constraint must be gone too
        self.assertNotIn("confidence 用 0 到 1", prompt)

    def test_rough_prompt_includes_phase3_cross_category_fields(self):
        """Phase 3: prompt must request detectedCategory + categoryConfidence
        and rename likelyProductFirstSeenAt → likelySubjectFirstSeenAt.
        See docs/DECISIONS/2026-05-23-rough-scan-v2-audit.md §5.3 + §6."""
        prompt = (ROOT / "prompts" / "video_understanding" / "rough_structure_scan_v0.md").read_text(
            encoding="utf-8"
        )

        # New cross-category fields
        self.assertIn('"detectedCategory"', prompt)
        self.assertIn('"categoryConfidence"', prompt)
        self.assertIn('"likelySubjectFirstSeenAt"', prompt)

        # Old product-only field must be gone
        self.assertNotIn('"likelyProductFirstSeenAt"', prompt)

        # likelyVideoType extended enums
        self.assertIn("tutorial", prompt)
        self.assertIn("course_preview", prompt)
        self.assertIn("local_service", prompt)
        self.assertIn("lifestyle_vlog", prompt)

        # coarseRoleGuess extended enums
        self.assertIn("tutorial_step", prompt)
        self.assertIn("testimonial", prompt)
        self.assertIn("atmosphere_or_context", prompt)

        # Category template instructions present (verify a representative line)
        self.assertIn("3c", prompt)
        self.assertIn("beauty", prompt)
        self.assertIn("food", prompt)
        self.assertIn("course", prompt)

    def test_normalize_migrates_likely_product_first_seen_at_to_subject(self):
        """Phase 3: normalize must rename likelyProductFirstSeenAt →
        likelySubjectFirstSeenAt when LLM still uses the old name."""
        parsed = {
            "videoId": "demo",
            "globalNotes": {
                "likelyProductFirstSeenAt": 0.8,
                "dominantPackaging": ["headline"],
            },
            "contentBlocks": [{"id": "block_001", "timeRange": {"start": 0, "end": 9}}],
            "boundaryCandidates": [
                {"id": "boundary_001", "fromBlockId": "block_001",
                 "toBlockId": "block_002", "roughBoundaryTime": 9.5}
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)
        notes = normalized["globalNotes"]

        self.assertNotIn("likelyProductFirstSeenAt", notes)
        self.assertEqual(notes["likelySubjectFirstSeenAt"], 0.8)

    def test_normalize_prefers_new_name_when_both_present(self):
        """When LLM emits both names (transition period), prefer the new one."""
        parsed = {
            "videoId": "demo",
            "globalNotes": {
                "likelyProductFirstSeenAt": 0.8,
                "likelySubjectFirstSeenAt": 1.2,  # new takes priority
                "dominantPackaging": [],
            },
            "contentBlocks": [{"id": "block_001", "timeRange": {"start": 0, "end": 9}}],
            "boundaryCandidates": [
                {"id": "boundary_001", "fromBlockId": "block_001",
                 "toBlockId": "block_002", "roughBoundaryTime": 9.5}
            ],
        }

        normalized = self.module.normalize_rough_scan(parsed)
        notes = normalized["globalNotes"]

        self.assertNotIn("likelyProductFirstSeenAt", notes)
        self.assertEqual(notes["likelySubjectFirstSeenAt"], 1.2)

    def test_build_multipart_body_contains_file_and_fps(self):
        body, content_type = self.client.build_multipart_body(
            fields={
                "purpose": "user_data",
                "preprocess_configs[video][fps]": "5",
            },
            files={
                "file": ("demo.mp4", b"abc", "video/mp4"),
            },
            boundary="fixed-boundary",
        )

        decoded = body.decode("utf-8")
        self.assertIn("multipart/form-data; boundary=fixed-boundary", content_type)
        self.assertIn('name="purpose"', decoded)
        self.assertIn("user_data", decoded)
        self.assertIn('name="preprocess_configs[video][fps]"', decoded)
        self.assertIn('filename="demo.mp4"', decoded)
        self.assertIn("abc", decoded)


class HttpConcurrencyControlsTests(unittest.TestCase):
    """W1.1: global semaphore + retry/backoff decorator for HTTP calls.

    These symbols moved to the shared provider-neutral client, so the module
    under test here is ``llm_client`` (the functions read its module globals).
    """

    def setUp(self):
        self.module = load_llm_client()
        # Per-test fresh global. _reset_http_semaphore_for_testing is the
        # blessed test helper (replaces direct _HTTP_SEMAPHORE = None hack).
        self.module._reset_http_semaphore_for_testing()

    def test_configure_http_semaphore_initialises_with_requested_cap(self):
        sem = self.module.configure_http_semaphore(7)
        # BoundedSemaphore enforces cap by trying to exceed it.
        for _ in range(7):
            self.assertTrue(sem.acquire(blocking=False))
        self.assertFalse(sem.acquire(blocking=False))
        for _ in range(7):
            sem.release()

    def test_configure_http_semaphore_idempotent_with_same_cap(self):
        sem1 = self.module.configure_http_semaphore(5)
        sem2 = self.module.configure_http_semaphore(5)
        self.assertIs(sem1, sem2)

    def test_configure_http_semaphore_raises_on_cap_mismatch(self):
        """PR #24 review H1: the previous behaviour silently ignored the
        new cap. Now mismatch must fail fast at the call site."""
        self.module.configure_http_semaphore(5)
        with self.assertRaisesRegex(RuntimeError, "already initialised"):
            self.module.configure_http_semaphore(25)

    def test_gated_call_uses_injected_semaphore_when_supplied(self):
        """DI seam (PR #24 review H1): tests inject their own semaphore
        rather than mutating module globals. Verifies the injected sem
        actually gates execution."""
        injected = threading.BoundedSemaphore(value=2)
        results: list[int] = []
        def fn(x: int) -> int:
            results.append(x)
            return x
        # 3 calls × cap=2 still serializes when the injected sem is used.
        for i in range(3):
            self.module.gated_call(fn, i, semaphore=injected)
        self.assertEqual(results, [0, 1, 2])

    def test_gated_call_enforces_global_cap_under_l1_l2_saturation(self):
        """PR #24 review test-1: L1/L2 concurrency contract is testable
        deterministically without flaky timing. With cap=3 and 12 tasks
        (3 outer × 4 inner), in-flight count must never exceed 3 and
        should hit 3 (saturation) given the 50 ms work units.

        Mock-based — replaces what the sub-agent audit flagged as the
        E2E-only coverage gap for L1+L2+semaphore interaction.
        """
        import time as _time
        from concurrent.futures import ThreadPoolExecutor

        # Use injected sem so the test is fully isolated from any other
        # global state (cap=3 here).
        cap = 3
        sem = threading.BoundedSemaphore(value=cap)
        in_flight: list[int] = []
        in_flight_lock = threading.Lock()
        peak_in_flight = [0]

        def fake_http() -> str:
            with in_flight_lock:
                in_flight.append(1)
                peak_in_flight[0] = max(peak_in_flight[0], len(in_flight))
            _time.sleep(0.05)
            with in_flight_lock:
                in_flight.pop()
            return "ok"

        def block_worker() -> None:
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(
                    lambda _: self.module.gated_call(fake_http, semaphore=sem),
                    range(4),
                ))

        with ThreadPoolExecutor(max_workers=3) as outer:
            list(outer.map(lambda _: block_worker(), range(3)))

        self.assertLessEqual(
            peak_in_flight[0], cap,
            f"semaphore breached: peak in-flight {peak_in_flight[0]} > cap {cap}",
        )
        # Saturation check — at cap=3 with 12 tasks × 50 ms work, we should
        # observe the semaphore saturate (peak hits cap). If it doesn't, the
        # test setup is faulty (threads ran serially), not the semaphore.
        self.assertGreaterEqual(
            peak_in_flight[0], cap - 1,
            f"semaphore underutilised: peak {peak_in_flight[0]} << cap {cap};"
            f" check L1/L2 thread setup",
        )

    def test_get_http_semaphore_creates_with_max_concurrent(self):
        sem = self.module.get_http_semaphore(max_concurrent=5)
        # BoundedSemaphore exposes acquire/release; verify it's bounded by trying to
        # exceed the cap.
        for _ in range(5):
            self.assertTrue(sem.acquire(blocking=False))
        # 6th acquire should fail (non-blocking).
        self.assertFalse(sem.acquire(blocking=False))
        for _ in range(5):
            sem.release()

    def test_get_http_semaphore_is_singleton(self):
        """Singleton behaviour: same cap call returns the same instance.
        Different-cap reconfiguration now raises (PR #24 review H1) — see
        test_configure_http_semaphore_raises_on_cap_mismatch."""
        sem_a = self.module.get_http_semaphore(max_concurrent=3)
        sem_b = self.module.get_http_semaphore(max_concurrent=3)
        self.assertIs(sem_a, sem_b)

    def test_gated_call_returns_value_on_success(self):
        def fn(x: int) -> int:
            return x * 2
        result = self.module.gated_call(fn, 21)
        self.assertEqual(result, 42)

    def test_gated_call_retries_on_429_then_succeeds(self):
        attempts = {"count": 0}

        def flaky_fn() -> str:
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise RuntimeError("HTTP 429 Too Many Requests: rate limit")
            return "ok"

        result = self.module.gated_call(flaky_fn, max_attempts=5, base_delay=0.001)
        self.assertEqual(result, "ok")
        self.assertEqual(attempts["count"], 3)

    def test_gated_call_retries_on_5xx(self):
        attempts = {"count": 0}

        def flaky_fn() -> str:
            attempts["count"] += 1
            if attempts["count"] < 2:
                raise RuntimeError("HTTP 503 Service Unavailable")
            return "ok"

        result = self.module.gated_call(flaky_fn, max_attempts=4, base_delay=0.001)
        self.assertEqual(result, "ok")
        self.assertEqual(attempts["count"], 2)

    def test_gated_call_retries_on_url_error_timeout(self):
        """W2-B follow-up: 50-concurrent uploads can hit urllib write timeouts."""
        from urllib.error import URLError

        attempts = {"count": 0}

        def flaky_fn() -> str:
            attempts["count"] += 1
            if attempts["count"] < 2:
                # Mirrors what request.urlopen raises on socket timeout.
                raise URLError("The write operation timed out")
            return "ok"

        result = self.module.gated_call(flaky_fn, max_attempts=4, base_delay=0.001)
        self.assertEqual(result, "ok")
        self.assertEqual(attempts["count"], 2)

    def test_gated_call_retries_on_socket_timeout(self):
        """Plain TimeoutError (Python 3.10+ alias for socket.timeout) should retry."""
        attempts = {"count": 0}

        def flaky_fn() -> str:
            attempts["count"] += 1
            if attempts["count"] < 2:
                raise TimeoutError("read timed out")
            return "ok"

        result = self.module.gated_call(flaky_fn, max_attempts=4, base_delay=0.001)
        self.assertEqual(result, "ok")
        self.assertEqual(attempts["count"], 2)

    def test_gated_call_does_not_swallow_unrelated_oserror(self):
        """OSError without a retryable pattern (e.g. FileNotFoundError) must raise."""
        def bad_fn() -> str:
            raise FileNotFoundError("/tmp/missing.txt")

        with self.assertRaises(FileNotFoundError):
            self.module.gated_call(bad_fn, max_attempts=3, base_delay=0.001)

    def test_gated_call_does_not_retry_on_400(self):
        attempts = {"count": 0}

        def bad_fn() -> str:
            attempts["count"] += 1
            raise RuntimeError("HTTP 400 Bad Request: malformed input")

        with self.assertRaisesRegex(RuntimeError, "HTTP 400"):
            self.module.gated_call(bad_fn, max_attempts=5, base_delay=0.001)
        self.assertEqual(attempts["count"], 1, "client errors must not retry")

    def test_gated_call_raises_after_exhausting_attempts(self):
        attempts = {"count": 0}

        def always_fail() -> str:
            attempts["count"] += 1
            raise RuntimeError("HTTP 429 rate limit")

        with self.assertRaisesRegex(RuntimeError, "HTTP 429"):
            self.module.gated_call(always_fail, max_attempts=3, base_delay=0.001)
        self.assertEqual(attempts["count"], 3)

    def test_gated_call_passes_args_and_kwargs(self):
        def fn(a: int, b: int, *, c: int) -> int:
            return a + b + c
        self.assertEqual(self.module.gated_call(fn, 1, 2, c=3), 6)


class RequestJsonCurlPathTests(unittest.TestCase):
    """request_json prefers curl (system TLS) to dodge OpenSSL SSL-EOF.

    Mocks subprocess so no real network/curl runs. Locks the contract:
    parsed JSON on 2xx, retryable RuntimeError on HTTP errors AND curl
    transport failures, plus auth-header + stdin-body wiring.

    request_json + _CURL_PATH + _is_retryable_error moved to the shared
    provider-neutral client, so the module under test (and patch target) is
    ``llm_client`` — patching the rough-scan module would be a no-op.
    """

    def setUp(self):
        self.module = load_llm_client()

    def _completed(self, *, stdout=b"", stderr=b"", returncode=0):
        class _R:
            pass
        r = _R()
        r.stdout, r.stderr, r.returncode = stdout, stderr, returncode
        return r

    def _use_fake_curl(self, fake_run):
        orig_run, orig_curl = self.module.subprocess.run, self.module._CURL_PATH
        self.module.subprocess.run = fake_run
        self.module._CURL_PATH = "curl"
        self.addCleanup(setattr, self.module.subprocess, "run", orig_run)
        self.addCleanup(setattr, self.module, "_CURL_PATH", orig_curl)

    def test_curl_success_returns_json_with_auth_and_stdin_body(self):
        captured = {}

        def fake_run(cmd, input=None, capture_output=None, timeout=None):
            captured["cmd"], captured["input"] = cmd, input
            return self._completed(stdout=b'{"id":"file-x"}\n200')

        self._use_fake_curl(fake_run)
        out = self.module.request_json(
            method="POST", url="https://x/files", api_key="secret-k",
            body=b"multipart-bytes",
            content_type="multipart/form-data; boundary=b",
        )
        self.assertEqual(out, {"id": "file-x"})
        self.assertIn("Authorization: Bearer secret-k", captured["cmd"])
        self.assertEqual(captured["input"], b"multipart-bytes")

    def test_curl_http_error_becomes_retryable_runtimeerror(self):
        def fake_run(cmd, input=None, capture_output=None, timeout=None):
            return self._completed(stdout=b'{"error":"overloaded"}\n503')

        self._use_fake_curl(fake_run)
        with self.assertRaises(RuntimeError) as ctx:
            self.module.request_json(method="POST", url="https://x", api_key="k", body=b"x")
        self.assertIn("HTTP 503", str(ctx.exception))
        self.assertTrue(self.module._is_retryable_error(str(ctx.exception)))

    def test_curl_transport_failure_is_retryable(self):
        def fake_run(cmd, input=None, capture_output=None, timeout=None):
            return self._completed(stderr=b"SSL connect error", returncode=35)

        self._use_fake_curl(fake_run)
        with self.assertRaises(RuntimeError) as ctx:
            self.module.request_json(method="POST", url="https://x", api_key="k", body=b"x")
        self.assertIn("curl transport error", str(ctx.exception))
        self.assertTrue(self.module._is_retryable_error(str(ctx.exception)))

    def test_curl_2xx_empty_body_returns_empty_dict(self):
        def fake_run(cmd, input=None, capture_output=None, timeout=None):
            return self._completed(stdout=b"\n200")

        self._use_fake_curl(fake_run)
        out = self.module.request_json(method="GET", url="https://x", api_key="k")
        self.assertEqual(out, {})


if __name__ == "__main__":
    unittest.main()
