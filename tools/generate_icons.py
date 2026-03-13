import math
import os
import struct
import zlib
from typing import List, Tuple


Color = Tuple[int, int, int, int]


def write_png(path: str, width: int, height: int, pixels: List[List[Color]]) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            r, g, b, a = pixels[y][x]
            raw.extend((r, g, b, a))

    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    png.extend(chunk(b"IEND", b""))

    with open(path, "wb") as f:
        f.write(png)


def blend(dst: Color, src: Color) -> Color:
    dr, dg, db, da = dst
    sr, sg, sb, sa = src
    a = sa / 255.0
    ia = 1.0 - a
    r = int(sr * a + dr * ia)
    g = int(sg * a + dg * ia)
    b = int(sb * a + db * ia)
    out_a = int(sa + da * ia)
    return (r, g, b, out_a)


def put(pixels: List[List[Color]], x: int, y: int, color: Color) -> None:
    h = len(pixels)
    w = len(pixels[0])
    if x < 0 or y < 0 or x >= w or y >= h:
        return
    pixels[y][x] = blend(pixels[y][x], color)


def fill_rect(pixels: List[List[Color]], x0: int, y0: int, x1: int, y1: int, color: Color) -> None:
    for y in range(y0, y1):
        for x in range(x0, x1):
            put(pixels, x, y, color)


def fill_circle(pixels: List[List[Color]], cx: float, cy: float, r: float, color: Color) -> None:
    x0 = int(cx - r - 1)
    x1 = int(cx + r + 1)
    y0 = int(cy - r - 1)
    y1 = int(cy + r + 1)
    rr = r * r
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            if dx * dx + dy * dy <= rr:
                put(pixels, x, y, color)


def fill_rounded_rect(
    pixels: List[List[Color]], x0: int, y0: int, x1: int, y1: int, radius: int, color_fn
) -> None:
    for y in range(y0, y1):
        for x in range(x0, x1):
            nx = min(x - x0, x1 - 1 - x)
            ny = min(y - y0, y1 - 1 - y)
            if nx >= radius or ny >= radius:
                put(pixels, x, y, color_fn(x, y))
                continue
            dx = radius - nx - 0.5
            dy = radius - ny - 0.5
            if dx * dx + dy * dy <= radius * radius:
                put(pixels, x, y, color_fn(x, y))


def fill_triangle(
    pixels: List[List[Color]], p1: Tuple[float, float], p2: Tuple[float, float], p3: Tuple[float, float], color: Color
) -> None:
    min_x = int(math.floor(min(p1[0], p2[0], p3[0])))
    max_x = int(math.ceil(max(p1[0], p2[0], p3[0])))
    min_y = int(math.floor(min(p1[1], p2[1], p3[1])))
    max_y = int(math.ceil(max(p1[1], p2[1], p3[1])))

    def sign(a, b, c):
        return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])

    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            p = (x + 0.5, y + 0.5)
            b1 = sign(p, p1, p2) < 0.0
            b2 = sign(p, p2, p3) < 0.0
            b3 = sign(p, p3, p1) < 0.0
            if (b1 == b2) and (b2 == b3):
                put(pixels, x, y, color)


def draw_arc(
    pixels: List[List[Color]],
    cx: float,
    cy: float,
    r: float,
    thickness: float,
    start_deg: float,
    end_deg: float,
    color: Color,
) -> None:
    step = 1.0
    ri = max(1.0, r - thickness * 0.5)
    ro = r + thickness * 0.5
    for y in range(int(cy - ro - 1), int(cy + ro + 1)):
        for x in range(int(cx - ro - 1), int(cx + ro + 1)):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = math.hypot(dx, dy)
            if dist < ri or dist > ro:
                continue
            deg = (math.degrees(math.atan2(dy, dx)) + 360.0) % 360.0
            if start_deg <= end_deg:
                ok = start_deg <= deg <= end_deg
            else:
                ok = deg >= start_deg or deg <= end_deg
            if ok:
                put(pixels, x, y, color)


def make_icon(size: int) -> List[List[Color]]:
    px: List[List[Color]] = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]

    pad = int(size * 0.06)
    radius = int(size * 0.22)

    def bg(x: int, y: int) -> Color:
        t = (x + y) / max(1.0, (size - 1) * 2.0)
        r = int(22 + (15 * t))
        g = int(122 + (54 * t))
        b = int(201 + (35 * t))
        return (r, g, b, 255)

    fill_rounded_rect(px, pad, pad, size - pad, size - pad, radius, bg)

    doc_x0 = int(size * 0.30)
    doc_y0 = int(size * 0.20)
    doc_x1 = int(size * 0.74)
    doc_y1 = int(size * 0.74)
    doc_r = max(2, int(size * 0.04))
    fill_rounded_rect(px, doc_x0, doc_y0, doc_x1, doc_y1, doc_r, lambda _x, _y: (250, 252, 255, 255))

    fold = int(size * 0.11)
    fill_triangle(
        px,
        (doc_x1 - fold, doc_y0),
        (doc_x1, doc_y0),
        (doc_x1, doc_y0 + fold),
        (217, 230, 246, 255),
    )

    line_col = (92, 152, 210, 255)
    line_h = max(1, int(size * 0.02))
    gap = max(2, int(size * 0.06))
    ly = int(size * 0.31)
    for _ in range(3):
        fill_rect(px, doc_x0 + int(size * 0.06), ly, doc_x1 - int(size * 0.08), ly + line_h, line_col)
        ly += gap

    cx = size * 0.57
    cy = size * 0.63
    r = size * 0.18
    th = max(2, size * 0.06)
    arc_col = (3, 108, 143, 255)
    draw_arc(px, cx, cy, r, th, 210, 20, arc_col)
    tip = (
        cx + math.cos(math.radians(20)) * r,
        cy + math.sin(math.radians(20)) * r,
    )
    fill_triangle(
        px,
        (tip[0] + size * 0.01, tip[1]),
        (tip[0] - size * 0.07, tip[1] - size * 0.03),
        (tip[0] - size * 0.04, tip[1] + size * 0.05),
        arc_col,
    )

    star_cx = size * 0.28
    star_cy = size * 0.22
    fill_circle(px, star_cx, star_cy, size * 0.02, (255, 232, 120, 255))
    fill_rect(px, int(star_cx - 1), int(star_cy - size * 0.06), int(star_cx + 1), int(star_cy + size * 0.06), (255, 232, 120, 255))
    fill_rect(px, int(star_cx - size * 0.06), int(star_cy - 1), int(star_cx + size * 0.06), int(star_cy + 1), (255, 232, 120, 255))

    return px


def main() -> None:
    out_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "icons")
    os.makedirs(out_dir, exist_ok=True)
    for s in (16, 32, 48, 128):
        pixels = make_icon(s)
        write_png(os.path.join(out_dir, f"icon{s}.png"), s, s, pixels)
    print("Generated icons in", out_dir)


if __name__ == "__main__":
    main()
