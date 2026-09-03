#!/usr/bin/env python3
"""Run the filtering-engine browser fixture in headless Firefox."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]


def read_png_pixel(path: Path, x: int, y: int) -> tuple[int, int, int, int]:
    """Read one RGBA pixel from the non-interlaced Firefox screenshot."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("Firefox did not produce a PNG screenshot")

    offset = 8
    compressed = bytearray()
    width = height = colour_type = interlace = None
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, colour_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
            if bit_depth != 8 or colour_type != 6 or interlace != 0:
                raise AssertionError("unsupported Firefox screenshot PNG format")
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if width is None or height is None or not (0 <= x < width and 0 <= y < height):
        raise AssertionError("invalid Firefox screenshot dimensions")

    bytes_per_pixel = 4
    stride = width * bytes_per_pixel
    raw = zlib.decompress(compressed)
    rows: list[bytearray] = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        scanline = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        reconstructed = bytearray(stride)
        for index, value in enumerate(scanline):
            left = reconstructed[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            above = previous[index]
            upper_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                estimate = left + above - upper_left
                distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            else:
                raise AssertionError(f"unsupported PNG filter: {filter_type}")
            reconstructed[index] = (value + predictor) & 0xFF
        rows.append(reconstructed)
        previous = reconstructed

    start = x * bytes_per_pixel
    return tuple(rows[y][start : start + bytes_per_pixel])


def main() -> None:
    firefox = shutil.which("firefox") or shutil.which("firefox-esr")
    if not firefox:
        raise SystemExit("Firefox is required for verification")

    with tempfile.TemporaryDirectory(prefix="fewercunts-firefox-") as temporary:
        temporary_path = Path(temporary)
        screenshot = temporary_path / "fixture.png"
        environment = os.environ.copy()
        environment["HOME"] = temporary
        for name in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY"):
            environment.pop(name, None)

        subprocess.run(
            [
                firefox,
                "--headless",
                "--screenshot",
                str(screenshot),
                "--window-size",
                "800,600",
                (ROOT / "tests" / "browser-test.html").as_uri(),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
            env=environment,
        )
        pixel = read_png_pixel(screenshot, 799, 599)
        if pixel[:3] != (0, 255, 0):
            raise AssertionError(f"Firefox browser fixture failed: {pixel}")

    print('{"result":"pass","browser":"Firefox","engineChecks":8}')


if __name__ == "__main__":
    main()
