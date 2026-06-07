"""Tests for the shared LLM transport (scripts/llm_client.py).

Includes PR #44's invariant: file-status polling must respect the global HTTP
semaphore. In our refactor wait_for_file/retrieve_file live in llm_client (not in
the per-script doubao_* modules PR #44 targeted), so the test lives here.
"""
import importlib.util
import sys
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location(
        "llm_client", ROOT / "scripts" / "llm_client.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class WaitForFilePollGatingTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.module._reset_http_semaphore_for_testing()

    def tearDown(self):
        self.module._reset_http_semaphore_for_testing()

    def test_wait_for_file_poll_requests_are_gated_by_global_semaphore(self):
        """PR #44 lowers the poll interval and raises block concurrency, so an
        ungated retrieve_file would bypass --max-concurrent-http and create an
        unbounded GET poll stream. Hold the only semaphore slot and verify the
        poll does not start until the slot is released."""
        sem = self.module.configure_http_semaphore(1)
        self.assertTrue(sem.acquire(blocking=False))

        called = threading.Event()
        result: dict[str, object] = {}
        original_retrieve_file = self.module.retrieve_file

        def fake_retrieve_file(**kwargs):
            called.set()
            return {"status": "processed", "id": kwargs["file_id"]}

        def worker() -> None:
            result["value"] = self.module.wait_for_file(
                base_url="https://example.invalid/api/v3",
                api_key="dummy",
                file_id="file-001",
                poll_interval=0.001,
                max_wait_seconds=1,
            )

        self.module.retrieve_file = fake_retrieve_file
        thread = threading.Thread(target=worker)
        thread.start()
        try:
            self.assertFalse(
                called.wait(0.05),
                "wait_for_file called retrieve_file while the global semaphore was held",
            )
            sem.release()
            thread.join(timeout=1)
            self.assertTrue(called.is_set())
            self.assertEqual(result["value"]["status"], "processed")
        finally:
            self.module.retrieve_file = original_retrieve_file


if __name__ == "__main__":
    unittest.main()
