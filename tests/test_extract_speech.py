"""Tests for scripts/extract_speech.py.

Pure-function tests only — does not invoke ffprobe or the Volcengine API
(network is mocked at the boundary in BuildRequestBodyTests and
NormalizeResponseTests).
"""

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "extract_speech.py"

sys.path.insert(0, str(ROOT / "scripts"))
from path_layout import DEFAULT_VIDEO_ID, analysis_paths  # noqa: E402

_PATHS = analysis_paths(DEFAULT_VIDEO_ID)


def load_module():
    spec = importlib.util.spec_from_file_location("extract_speech", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class BuildRequestBodyTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.audio_meta = {
            "format": "wav",
            "rate": 44100,
            "bits": 16,
            "channels": 1,
            "duration_s": 229.5,
        }

    def test_top_level_shape_matches_volcengine_curl_example(self):
        body = self.module.build_request_body(
            audio_b64="ZmFrZQ==",
            audio_meta=self.audio_meta,
        )
        self.assertIn("user", body)
        self.assertIn("audio", body)
        self.assertIn("request", body)

    def test_audio_data_is_passed_through_as_base64(self):
        body = self.module.build_request_body(
            audio_b64="ZmFrZQ==",
            audio_meta=self.audio_meta,
        )
        self.assertEqual(body["audio"]["data"], "ZmFrZQ==")
        # url field must NOT be set when using data
        self.assertNotIn("url", body["audio"])

    def test_audio_metadata_propagates_to_payload(self):
        body = self.module.build_request_body(
            audio_b64="x",
            audio_meta=self.audio_meta,
        )
        self.assertEqual(body["audio"]["format"], "wav")
        self.assertEqual(body["audio"]["rate"], 44100)
        self.assertEqual(body["audio"]["channel"], 1)
        self.assertEqual(body["audio"]["bits"], 16)
        self.assertEqual(body["audio"]["codec"], "raw")

    def test_show_utterances_default_true_is_mandatory_for_timestamps(self):
        """Without show_utterances=True Volcengine only returns a concatenated
        full-text string with no timing — useless for our downstream."""
        body = self.module.build_request_body(audio_b64="x", audio_meta=self.audio_meta)
        self.assertTrue(body["request"]["show_utterances"])

    def test_default_request_flags_tuned_for_chinese_ecommerce(self):
        body = self.module.build_request_body(audio_b64="x", audio_meta=self.audio_meta)
        # ITN on: "一千两百" -> "1200" (price/quantity readable)
        self.assertTrue(body["request"]["enable_itn"])
        # Punctuation on: readable transcript
        self.assertTrue(body["request"]["enable_punc"])
        # DDC off: don't auto-rewrite disfluencies (preserve raw "嗯啊")
        self.assertFalse(body["request"]["enable_ddc"])
        # Single-speaker assumption for short videos
        self.assertFalse(body["request"]["enable_speaker_info"])
        # No channel split for mono audio
        self.assertFalse(body["request"]["enable_channel_split"])

    def test_user_uid_default_and_override(self):
        default = self.module.build_request_body(audio_b64="x", audio_meta=self.audio_meta)
        self.assertEqual(default["user"]["uid"], "viral-struct-ai")
        custom = self.module.build_request_body(
            audio_b64="x", audio_meta=self.audio_meta, user_id="custom-uid",
        )
        self.assertEqual(custom["user"]["uid"], "custom-uid")

    def test_can_disable_punctuation_when_caller_wants_raw(self):
        body = self.module.build_request_body(
            audio_b64="x", audio_meta=self.audio_meta, enable_punc=False,
        )
        self.assertFalse(body["request"]["enable_punc"])


class NormalizeResponseTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.audio_meta = {
            "format": "wav", "rate": 16000, "bits": 16, "channels": 1,
            "duration_s": 229.5,
        }

    def _build(self, raw, **overrides):
        return self.module.normalize_response(
            raw=raw,
            response_headers=overrides.get("response_headers"),
            video_id=overrides.get("video_id", "demo"),
            audio_source_path=overrides.get("audio_source_path", "test.wav"),
            audio_meta=overrides.get("audio_meta", self.audio_meta),
        )

    def test_basic_two_utterance_response_normalizes_correctly(self):
        raw = {
            "audio_info": {"duration": 229500},
            "result": {
                "text": "今天给大家展示新品 MacBook Neo",
                "utterances": [
                    {"text": "今天给大家展示新品", "start_time": 1230, "end_time": 4560},
                    {"text": "MacBook Neo", "start_time": 4700, "end_time": 6000},
                ],
            },
        }
        out = self._build(raw)

        self.assertEqual(out["schemaVersion"], "speech_transcript_v1")
        self.assertEqual(out["producedBy"], "volcengine-doubao-asr-flash")
        self.assertTrue(out["hasSpeech"])
        self.assertEqual(len(out["segments"]), 2)
        self.assertEqual(out["segments"][0]["id"], "seg_001")
        self.assertEqual(out["segments"][0]["startMs"], 1230)
        self.assertEqual(out["segments"][0]["endMs"], 4560)
        self.assertEqual(out["segments"][1]["id"], "seg_002")
        self.assertEqual(out["fullText"], "今天给大家展示新品 MacBook Neo")

    def test_no_speech_case_yields_has_speech_false(self):
        """macbook_neo-style BGM-only video: Volcengine returns empty utterances + text."""
        raw = {"result": {"text": "", "utterances": []}}
        out = self._build(raw, video_id="bgm_only")

        self.assertFalse(out["hasSpeech"])
        self.assertEqual(out["segments"], [])
        self.assertEqual(out["totalSpeechMs"], 0)
        self.assertEqual(out["speechRatio"], 0.0)
        self.assertEqual(out["fullText"], "")

    def test_speech_ratio_computed_from_segment_durations(self):
        raw = {
            "result": {
                "text": "短句一 短句二",
                "utterances": [
                    {"text": "短句一", "start_time": 0, "end_time": 1000},
                    {"text": "短句二", "start_time": 5000, "end_time": 6300},
                ],
            },
        }
        out = self._build(raw)
        # Total speech = 1000 + 1300 = 2300 ms out of 229500 ms
        self.assertEqual(out["totalSpeechMs"], 2300)
        self.assertAlmostEqual(out["speechRatio"], 2300 / 229500, places=4)

    def test_word_level_timestamps_preserved_when_present(self):
        raw = {
            "result": {
                "text": "你好",
                "utterances": [{
                    "text": "你好", "start_time": 100, "end_time": 500,
                    "words": [
                        {"text": "你", "start_time": 100, "end_time": 300},
                        {"text": "好", "start_time": 300, "end_time": 500},
                    ],
                }],
            },
        }
        out = self._build(raw)
        self.assertIn("words", out["segments"][0])
        self.assertEqual(len(out["segments"][0]["words"]), 2)
        self.assertEqual(out["segments"][0]["words"][0]["text"], "你")
        self.assertEqual(out["segments"][0]["words"][0]["startMs"], 100)
        self.assertEqual(out["segments"][0]["words"][1]["endMs"], 500)

    def test_missing_words_key_does_not_break_normalize(self):
        raw = {
            "result": {
                "text": "嗯",
                "utterances": [{"text": "嗯", "start_time": 0, "end_time": 200}],
            },
        }
        out = self._build(raw)
        self.assertNotIn("words", out["segments"][0])

    def test_defensive_missing_result_envelope(self):
        """If Volcengine returns just an error envelope (no result field), normalize
        must NOT crash — it should emit empty segments + hasSpeech=false."""
        raw = {"code": "20000001", "message": "processing"}
        out = self._build(raw)
        self.assertFalse(out["hasSpeech"])
        self.assertEqual(out["segments"], [])

    def test_defensive_malformed_utterance_entries_skipped(self):
        raw = {
            "result": {
                "text": "你好",
                "utterances": [
                    "not a dict",
                    {"text": "你好", "start_time": 0, "end_time": 200},
                    None,
                ],
            },
        }
        out = self._build(raw)
        self.assertEqual(len(out["segments"]), 1)
        self.assertEqual(out["segments"][0]["text"], "你好")

    def test_provider_request_id_extracted_from_response_headers(self):
        raw = {"result": {"text": "x", "utterances": [{"text": "x", "start_time": 0, "end_time": 100}]}}
        out = self._build(
            raw,
            response_headers={"X-Api-Request-Id": "test-uuid-abc-123"},
        )
        self.assertEqual(out["providerRequestId"], "test-uuid-abc-123")

    def test_provider_request_id_null_when_headers_absent(self):
        raw = {"result": {"text": "x", "utterances": [{"text": "x", "start_time": 0, "end_time": 100}]}}
        out = self._build(raw)
        self.assertIsNone(out["providerRequestId"])

    def test_schema_invariant_fields_always_present(self):
        """Even on empty input, all top-level schema fields must exist."""
        out = self._build({})
        required = {
            "schemaVersion", "producedBy", "videoId", "audioSourcePath",
            "model", "modelResourceId", "language", "hasSpeech",
            "totalAudioMs", "totalSpeechMs", "speechRatio",
            "fullText", "segments", "providerRequestId",
        }
        self.assertSetEqual(set(out.keys()), required)

    def test_zero_duration_audio_does_not_divide_by_zero(self):
        out = self._build({}, audio_meta={**self.audio_meta, "duration_s": 0.0})
        self.assertEqual(out["speechRatio"], 0.0)
        self.assertEqual(out["totalAudioMs"], 0)


class DetectLanguageTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_pure_chinese_text(self):
        self.assertEqual(self.module.detect_language("今天给大家展示新品"), "zh")

    def test_pure_english_text(self):
        self.assertEqual(
            self.module.detect_language("This is MacBook Neo, an amazing all new Mac"),
            "en",
        )

    def test_mixed_text_with_dominant_chinese(self):
        text = "今天给大家展示 MacBook Neo 新色"
        # ~12 CJK, ~10 latin → CJK ratio ~0.55, classify as zh
        result = self.module.detect_language(text)
        self.assertIn(result, ("zh", "mixed"))

    def test_mixed_text_with_dominant_english(self):
        text = "MacBook Neo with new 配色"
        # 2 CJK, ~18 latin → CJK ratio ~0.1, classify as en
        self.assertEqual(self.module.detect_language(text), "en")

    def test_balanced_mixed_returns_mixed(self):
        text = "iPhone 苹果手机 MacBook 笔记本"
        # ~8 CJK, ~13 latin → ratio ~0.38, in [0.15, 0.85] → mixed
        self.assertEqual(self.module.detect_language(text), "mixed")

    def test_empty_text_returns_unknown(self):
        self.assertEqual(self.module.detect_language(""), "unknown")

    def test_punctuation_only_returns_unknown(self):
        self.assertEqual(self.module.detect_language("... !!! ???"), "unknown")


class WordTimestampNoiseFilterTests(unittest.TestCase):
    """Volcengine returns `{text: ' ', start_time: -1, end_time: -1}` placeholders
    between English word tokens. These must be filtered out — they carry no
    timing data and confuse word-level downstream consumers."""

    def setUp(self):
        self.module = load_module()
        self.audio_meta = {
            "format": "wav", "rate": 16000, "bits": 16, "channels": 1, "duration_s": 1.0,
        }

    def test_filters_separator_placeholders(self):
        raw = {
            "result": {
                "text": "This is MacBook",
                "utterances": [{
                    "text": "This is MacBook",
                    "start_time": 0, "end_time": 3000,
                    "words": [
                        {"text": "This", "start_time": 100, "end_time": 500},
                        {"text": " ", "start_time": -1, "end_time": -1},
                        {"text": "is", "start_time": 600, "end_time": 800},
                        {"text": " ", "start_time": -1, "end_time": -1},
                        {"text": "MacBook", "start_time": 900, "end_time": 2500},
                    ],
                }],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        words = out["segments"][0]["words"]
        self.assertEqual(len(words), 3)
        self.assertEqual([w["text"] for w in words], ["This", "is", "MacBook"])
        # No placeholder timing leaks through
        for w in words:
            self.assertGreaterEqual(w["startMs"], 0)
            self.assertGreaterEqual(w["endMs"], 0)

    def test_filters_standalone_punctuation_words(self):
        """Volcengine emits ':' (or ',' / '。') as standalone words with valid
        timestamps. They have no semantic content — filter them out.
        Observed real-world in macbook_neo seg_012: "colors:" produced a
        separate ':' word with startMs=104910, endMs=105470."""
        raw = {
            "result": {
                "text": "Neo comes in four colors: silver",
                "utterances": [{
                    "text": "Neo comes in four colors: silver",
                    "start_time": 0, "end_time": 3000,
                    "words": [
                        {"text": "Neo", "start_time": 0, "end_time": 200},
                        {"text": "comes", "start_time": 250, "end_time": 500},
                        {"text": "in", "start_time": 550, "end_time": 700},
                        {"text": "four", "start_time": 750, "end_time": 1000},
                        {"text": "colors", "start_time": 1050, "end_time": 1400},
                        {"text": ":", "start_time": 1400, "end_time": 1900},
                        {"text": "silver", "start_time": 1950, "end_time": 2500},
                    ],
                }],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        words = out["segments"][0]["words"]
        self.assertEqual(len(words), 6)  # ":" filtered, 6 real words kept
        self.assertEqual([w["text"] for w in words],
                         ["Neo", "comes", "in", "four", "colors", "silver"])

    def test_filters_chinese_punctuation_words(self):
        """Chinese punctuation (。 , 、 ! ?) must also be filtered."""
        raw = {
            "result": {
                "text": "你好，世界！",
                "utterances": [{
                    "text": "你好，世界！",
                    "start_time": 0, "end_time": 1000,
                    "words": [
                        {"text": "你", "start_time": 0, "end_time": 100},
                        {"text": "好", "start_time": 100, "end_time": 200},
                        {"text": "，", "start_time": 200, "end_time": 300},
                        {"text": "世", "start_time": 300, "end_time": 500},
                        {"text": "界", "start_time": 500, "end_time": 700},
                        {"text": "！", "start_time": 700, "end_time": 1000},
                    ],
                }],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        words = out["segments"][0]["words"]
        self.assertEqual([w["text"] for w in words], ["你", "好", "世", "界"])

    def test_preserves_words_with_internal_punctuation(self):
        """Words like ``it's`` / ``1080P`` / ``MacBook`` contain a digit or
        alpha char alongside punctuation — must NOT be filtered."""
        raw = {
            "result": {
                "text": "it's a 1080P MacBook",
                "utterances": [{
                    "text": "it's a 1080P MacBook",
                    "start_time": 0, "end_time": 2000,
                    "words": [
                        {"text": "it's", "start_time": 0, "end_time": 300},
                        {"text": "a", "start_time": 400, "end_time": 500},
                        {"text": "1080P", "start_time": 600, "end_time": 1000},
                        {"text": "MacBook", "start_time": 1100, "end_time": 2000},
                    ],
                }],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        words = out["segments"][0]["words"]
        self.assertEqual(len(words), 4)
        self.assertEqual([w["text"] for w in words], ["it's", "a", "1080P", "MacBook"])

    def test_words_key_omitted_if_all_filtered(self):
        raw = {
            "result": {
                "text": "x",
                "utterances": [{
                    "text": "x", "start_time": 0, "end_time": 100,
                    "words": [
                        {"text": " ", "start_time": -1, "end_time": -1},
                        {"text": "", "start_time": -1, "end_time": -1},
                    ],
                }],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        self.assertNotIn("words", out["segments"][0])


class LanguageInferredFromTranscriptTests(unittest.TestCase):
    """The `language` field must reflect the actual transcript content,
    not be hardcoded. Crucial for the surprise-finding that macbook_neo
    is an English Apple-style TVC, not Chinese."""

    def setUp(self):
        self.module = load_module()
        self.audio_meta = {
            "format": "wav", "rate": 16000, "bits": 16, "channels": 1, "duration_s": 1.0,
        }

    def test_english_transcript_yields_en(self):
        raw = {
            "result": {
                "text": "This is MacBook Neo, an amazing all new Mac at a surprising price.",
                "utterances": [{"text": "This is MacBook Neo", "start_time": 0, "end_time": 3000}],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        self.assertEqual(out["language"], "en")

    def test_chinese_transcript_yields_zh(self):
        raw = {
            "result": {
                "text": "今天给大家展示新品笔记本",
                "utterances": [{"text": "今天给大家展示新品笔记本", "start_time": 0, "end_time": 3000}],
            },
        }
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        self.assertEqual(out["language"], "zh")

    def test_empty_transcript_yields_unknown(self):
        raw = {"result": {"text": "", "utterances": []}}
        out = self.module.normalize_response(
            raw=raw, response_headers=None, video_id="x",
            audio_source_path="x.wav", audio_meta=self.audio_meta,
        )
        self.assertEqual(out["language"], "unknown")


class FfprobeMetadataParsingTests(unittest.TestCase):
    """Indirectly tests the format/extension mapping. ffprobe subprocess
    is not invoked here — we'd need a fixture audio file to test the
    full call path, which is covered by manual e2e runs."""

    def setUp(self):
        self.module = load_module()

    def test_audio_meta_dict_has_correct_keys_for_volcengine_body(self):
        """Sanity: build_request_body reads these exact keys."""
        meta = {"format": "wav", "rate": 44100, "bits": 16, "channels": 1, "duration_s": 1.0}
        body = self.module.build_request_body(audio_b64="x", audio_meta=meta)
        self.assertIn("format", body["audio"])
        self.assertIn("rate", body["audio"])
        self.assertIn("bits", body["audio"])
        self.assertIn("channel", body["audio"])  # NOTE: singular in Volcengine API


class ApiKeyResolutionTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_resolves_from_asr_access_token(self):
        env = {"ASR_ACCESS_TOKEN": "abc-123"}
        self.assertEqual(self.module.resolve_api_key(env), "abc-123")

    def test_resolves_from_asr_api_key_when_token_absent(self):
        env = {"ASR_API_KEY": "fallback-456"}
        self.assertEqual(self.module.resolve_api_key(env), "fallback-456")

    def test_prefers_access_token_over_api_key_when_both_set(self):
        env = {"ASR_ACCESS_TOKEN": "first", "ASR_API_KEY": "second"}
        self.assertEqual(self.module.resolve_api_key(env), "first")

    def test_raises_when_both_unset(self):
        with self.assertRaises(SystemExit):
            self.module.resolve_api_key({})


class ParserDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_defaults_point_to_macbook_neo_stage1_media(self):
        args = self.module.build_parser().parse_args([])
        self.assertEqual(args.audio, str(_PATHS.audio_beat_wav))
        self.assertEqual(args.out, str(_PATHS.speech_transcript))
        self.assertEqual(args.video_id, DEFAULT_VIDEO_ID)
        self.assertEqual(args.resource_id, "volc.bigasr.auc_turbo")
        self.assertEqual(args.model, "bigmodel")


if __name__ == "__main__":
    unittest.main()
