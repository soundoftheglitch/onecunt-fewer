import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from compact_search_index import FormatError, decode, encode, manifest_json, tokenise  # noqa: E402


FIXTURE = [
    {"id": 10, "threadId": 10, "kind": "thread", "username": "Café Alice", "title": "The record",
     "body": "The record is good", "createdUtc": "2026-08-01Z", "canonicalUrl": "/thread/10"},
    {"id": 11, "threadId": 10, "parentId": None, "kind": "reply", "username": "Bob", "title": "Re: record",
     "body": "The very good record", "createdUtc": "2026-08-02Z", "canonicalUrl": "/thread/10/reply/11"},
    {"id": 12, "threadId": 10, "parentId": 11, "kind": "reply", "username": "Soulisdead", "title": "hidden",
     "body": "private", "createdUtc": "2026-08-03Z", "canonicalUrl": "/thread/10/reply/12"},
    {"id": 13, "threadId": 10, "parentId": 12, "kind": "reply", "username": "Carol", "title": "descendant",
     "body": "also hidden", "createdUtc": "2026-08-04Z", "canonicalUrl": "/thread/10/reply/13"},
]


class CompactIndexTest(unittest.TestCase):
    def test_markup_punctuation_and_diacritics_normalise_to_visible_terms(self):
        self.assertEqual(tokenise("<strong>Café</strong> &amp; déjà-vu"),
                         ["cafe", "deja", "vu"])

    def test_deterministic_round_trip_positions_and_stop_words(self):
        first, manifest = encode(FIXTURE, watermark="2026-08-02Z")
        second, second_manifest = encode(copy.deepcopy(FIXTURE), watermark="2026-08-02Z")
        self.assertEqual(first, second)
        self.assertEqual(manifest_json(manifest), manifest_json(second_manifest))
        decoded = decode(first)
        self.assertEqual([item["id"] for item in decoded["documents"]], [10, 11])
        self.assertEqual(decoded["postings"][("body", "record")], [
            {"documentId": 10, "termFrequency": 1, "positions": [1]},
            {"documentId": 11, "termFrequency": 1, "positions": [3]}])
        self.assertTrue(next(item for item in decoded["lexicon"] if item["term"] == "the")["stop"])

    def test_checksum_detects_corruption(self):
        binary, _ = encode(FIXTURE, watermark="x")
        corrupt = bytearray(binary); corrupt[len(corrupt) // 2] ^= 1
        with self.assertRaisesRegex(FormatError, "checksum mismatch"): decode(bytes(corrupt))
        with self.assertRaises(FormatError): decode(binary[:-10])

    def test_privacy_fails_closed_for_email_and_filters_blocked_subtrees(self):
        with self.assertRaisesRegex(ValueError, "email fields forbidden"):
            encode([dict(FIXTURE[0], email="alice@example.test")], watermark="x")
        binary, manifest = encode(FIXTURE, watermark="x")
        self.assertNotIn(b"Soulisdead", binary)
        self.assertNotIn(b"Carol", binary)
        self.assertFalse(manifest["privacy"]["emails"])
        blocked_root = [dict(FIXTURE[0], id=20, threadId=20, username="MonkeyButler"),
                        dict(FIXTURE[1], id=21, threadId=20, parentId=None)]
        decoded = decode(encode(blocked_root, watermark="x")[0])
        self.assertEqual(decoded["documents"], [], "a blocked root removes its complete thread")

    def test_editable_channel_retains_all_authors_but_never_email_fields(self):
        binary, manifest = encode(FIXTURE, watermark="x", blocked_authors=frozenset())
        self.assertEqual([item["id"] for item in decode(binary)["documents"]], [10, 11, 12, 13])
        self.assertEqual(manifest["privacy"]["blockedAuthors"], [])
        with self.assertRaisesRegex(ValueError, "email fields forbidden"):
            encode([dict(FIXTURE[0], postedByEmail="secret")], watermark="x", blocked_authors=frozenset())


if __name__ == "__main__": unittest.main()
