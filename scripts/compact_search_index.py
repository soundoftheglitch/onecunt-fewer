#!/usr/bin/env python3
"""Deterministic codec for the privacy-safe NTForum search index v1."""

from __future__ import annotations

from collections import defaultdict
import hashlib
from html.parser import HTMLParser
import json
import struct
import unicodedata

MAGIC = b"NTFSIDX\x00"
VERSION = 1
HEADER = struct.Struct("<8sHHIIIIQQ")
FOOTER_SIZE = 32
FIELDS = ("user", "title", "body")
FIELD_ID = {name: index for index, name in enumerate(FIELDS)}
BLOCKED_AUTHORS = frozenset(("soulisdead", "monkeybutler"))
STOP_WORDS = frozenset(("a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
                        "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "with"))


class FormatError(ValueError):
    """The index is corrupt or incompatible."""


class _VisibleTextParser(HTMLParser):
    """Extract visible text without allowing HTML syntax to become terms."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def visible_text(value: str | None) -> str:
    parser = _VisibleTextParser()
    parser.feed(value or "")
    parser.close()
    return " ".join(parser.parts)


def normalise(value: str | None) -> str:
    value = unicodedata.normalize("NFKD", visible_text(value))
    return "".join(c for c in value if not unicodedata.combining(c)).casefold()


def tokenise(value: str | None) -> list[str]:
    words, current = [], []
    for character in normalise(value):
        if unicodedata.category(character)[:1] in {"L", "N"}:
            current.append(character)
        elif current:
            words.append("".join(current)); current = []
    if current:
        words.append("".join(current))
    return words


def _varint(value: int) -> bytes:
    if value < 0: raise ValueError("varints are unsigned")
    result = bytearray()
    while value >= 0x80:
        result.append((value & 0x7f) | 0x80); value >>= 7
    result.append(value)
    return bytes(result)


def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = shift = 0
    for _ in range(10):
        if offset >= len(data): raise FormatError("truncated varint")
        byte = data[offset]; offset += 1
        value |= (byte & 0x7f) << shift
        if not byte & 0x80: return value, offset
        shift += 7
    raise FormatError("oversized varint")


def _blob(value: bytes) -> bytes:
    return _varint(len(value)) + value


def _read_blob(data: bytes, offset: int) -> tuple[bytes, int]:
    size, offset = _read_varint(data, offset)
    end = offset + size
    if end > len(data): raise FormatError("truncated blob")
    return data[offset:end], end


def privacy_filter(documents: list[dict], *, blocked_authors: frozenset[str] = BLOCKED_AUTHORS) -> list[dict]:
    """Remove blocked roots, blocked replies and descendants; reject email fields."""
    ordered = sorted(documents, key=lambda item: int(item["id"]))
    for document in ordered:
        forbidden = {key for key in document if "email" in key.casefold()}
        if forbidden: raise ValueError(f"email fields forbidden: {sorted(forbidden)}")
    blocked_threads = {int(item.get("threadId", item["id"])) for item in ordered
                       if item.get("kind") != "reply"
                       and normalise(item.get("username")).strip() in blocked_authors}
    blocked_ids = {int(item["id"]) for item in ordered
                   if normalise(item.get("username")).strip() in blocked_authors}
    changed = True
    while changed:
        before = len(blocked_ids)
        blocked_ids.update(int(item["id"]) for item in ordered if item.get("parentId") in blocked_ids)
        changed = len(blocked_ids) != before
    return [item for item in ordered if int(item.get("threadId", item["id"])) not in blocked_threads
            and int(item["id"]) not in blocked_ids]


def encode(documents: list[dict], *, watermark: str, blocked_authors: frozenset[str] = BLOCKED_AUTHORS) -> tuple[bytes, dict]:
    documents = privacy_filter(documents, blocked_authors=blocked_authors)
    docs = sorted(documents, key=lambda item: int(item["id"]))
    postings: dict[tuple[str, str], dict[int, list[int]]] = defaultdict(lambda: defaultdict(list))
    metadata = bytearray()
    previous_id = 0
    for document in docs:
        doc_id = int(document["id"])
        if doc_id <= previous_id: raise ValueError("document IDs must be unique positive integers")
        metadata += _varint(doc_id - previous_id); previous_id = doc_id
        metadata += _varint(int(document.get("threadId", doc_id)))
        metadata += _varint(int(document.get("parentId") or 0))
        metadata += bytes((1 if document.get("kind") == "reply" else 0,))
        for key in ("username", "title", "body", "createdUtc", "canonicalUrl"):
            metadata += _blob(str(document.get(key, "")).encode("utf-8"))
        for field in FIELDS:
            source = "username" if field == "user" else field
            for position, term in enumerate(tokenise(document.get(source))):
                postings[(field, term)][doc_id].append(position)

    lexicon, posting_bytes = bytearray(), bytearray()
    terms = sorted(postings)
    previous_term = ""
    for field, term in terms:
        common = 0
        while common < min(len(previous_term), len(term)) and previous_term[common] == term[common]: common += 1
        suffix = term[common:].encode("utf-8")
        encoded_list = bytearray(); previous_doc = 0
        doc_postings = postings[(field, term)]
        for doc_id in sorted(doc_postings):
            positions = doc_postings[doc_id]
            encoded_list += _varint(doc_id - previous_doc); previous_doc = doc_id
            encoded_list += _varint(len(positions))
            previous_position = 0
            for index, position in enumerate(positions):
                encoded_list += _varint(position if index == 0 else position - previous_position)
                previous_position = position
        lexicon += bytes((FIELD_ID[field], 1 if term in STOP_WORDS else 0))
        lexicon += _varint(common) + _blob(suffix) + _varint(len(doc_postings))
        lexicon += _varint(len(posting_bytes)) + _varint(len(encoded_list))
        posting_bytes += encoded_list; previous_term = term

    watermark_bytes = watermark.encode("utf-8")
    header_size = HEADER.size + len(watermark_bytes)
    metadata_offset = header_size
    lexicon_offset = metadata_offset + len(metadata)
    postings_offset = lexicon_offset + len(lexicon)
    header = HEADER.pack(MAGIC, VERSION, 0, len(docs), len(terms), len(watermark_bytes), 0,
                         metadata_offset, lexicon_offset) + watermark_bytes
    payload = header + metadata + lexicon + posting_bytes
    checksum = hashlib.sha256(payload).digest()
    binary = payload + checksum
    manifest = {"format": "ntforum-compact-search", "schemaVersion": VERSION,
                "documentCount": len(docs), "termCount": len(terms), "watermark": watermark,
                "bytes": len(binary), "sha256": hashlib.sha256(binary).hexdigest(),
                "payloadSha256": checksum.hex(), "privacy": {"emails": False,
                "blockedAuthors": sorted(blocked_authors)}}
    return binary, manifest


def decode(binary: bytes) -> dict:
    if len(binary) < HEADER.size + FOOTER_SIZE: raise FormatError("truncated index")
    payload, checksum = binary[:-FOOTER_SIZE], binary[-FOOTER_SIZE:]
    if hashlib.sha256(payload).digest() != checksum: raise FormatError("checksum mismatch")
    magic, version, flags, doc_count, term_count, watermark_size, reserved, metadata_offset, lexicon_offset = HEADER.unpack_from(payload)
    if magic != MAGIC or version != VERSION or flags or reserved: raise FormatError("unsupported header")
    if metadata_offset != HEADER.size + watermark_size or not metadata_offset <= lexicon_offset <= len(payload):
        raise FormatError("invalid section offsets")
    watermark = payload[HEADER.size:metadata_offset].decode("utf-8")
    docs, offset, previous_id = [], metadata_offset, 0
    for _ in range(doc_count):
        delta, offset = _read_varint(payload, offset); doc_id = previous_id + delta; previous_id = doc_id
        thread_id, offset = _read_varint(payload, offset); parent_id, offset = _read_varint(payload, offset)
        if offset >= lexicon_offset: raise FormatError("truncated metadata")
        kind = "reply" if payload[offset] else "thread"; offset += 1
        values = []
        for _ in range(5):
            value, offset = _read_blob(payload, offset); values.append(value.decode("utf-8"))
        docs.append(dict(zip(("username", "title", "body", "createdUtc", "canonicalUrl"), values),
                         id=doc_id, threadId=thread_id, parentId=parent_id or None, kind=kind))
    if offset != lexicon_offset: raise FormatError("metadata boundary mismatch")
    terms, previous_term = [], ""
    for _ in range(term_count):
        if offset + 2 > len(payload): raise FormatError("truncated lexicon")
        field_id, stop = payload[offset:offset + 2]; offset += 2
        common, offset = _read_varint(payload, offset); suffix, offset = _read_blob(payload, offset)
        df, offset = _read_varint(payload, offset); posting_offset, offset = _read_varint(payload, offset)
        posting_size, offset = _read_varint(payload, offset)
        if field_id >= len(FIELDS) or common > len(previous_term): raise FormatError("invalid lexicon entry")
        term = previous_term[:common] + suffix.decode("utf-8")
        terms.append({"field": FIELDS[field_id], "term": term, "stop": bool(stop), "documentFrequency": df,
                      "postingOffset": posting_offset, "postingBytes": posting_size})
        previous_term = term
    postings_base = offset
    decoded_postings = {}
    for entry in terms:
        start = postings_base + entry["postingOffset"]; end = start + entry["postingBytes"]
        if end > len(payload): raise FormatError("posting outside payload")
        cursor, previous_doc, values = start, 0, []
        for _ in range(entry["documentFrequency"]):
            delta, cursor = _read_varint(payload, cursor); doc_id = previous_doc + delta; previous_doc = doc_id
            tf, cursor = _read_varint(payload, cursor); positions, previous_position = [], 0
            for index in range(tf):
                position_delta, cursor = _read_varint(payload, cursor)
                position = position_delta if index == 0 else previous_position + position_delta
                positions.append(position); previous_position = position
            values.append({"documentId": doc_id, "termFrequency": tf, "positions": positions})
        if cursor != end: raise FormatError("posting boundary mismatch")
        decoded_postings[(entry["field"], entry["term"])] = values
    if max((postings_base + t["postingOffset"] + t["postingBytes"] for t in terms), default=postings_base) != len(payload):
        raise FormatError("trailing or missing posting bytes")
    return {"schemaVersion": version, "watermark": watermark, "documents": docs,
            "lexicon": terms, "postings": decoded_postings}


def manifest_json(manifest: dict) -> bytes:
    return (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
