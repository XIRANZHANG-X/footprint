"""画 App 图标并生成安卓各尺寸、启动画面和网页图标（决策 0017 第 3 条）。

图标是一张 17×17 的像素画：一左一右两只脚印加一颗小星星，配色取自 src/index.css 的马卡龙色（决策 0010）。
每个像素放大成整数倍的方块，不做插值缩放，边缘保持锐利。

用法：python scripts/make_icons.py [--preview 输出的预览图路径]
"""

import math
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
RES = REPO / "android" / "app" / "src" / "main" / "res"

# 像素画：. 透明，k 深紫黑的实心脚印，y 星星（柠檬黄）。一左一右两只脚印错开，读作"足迹"。
# 星星的描边和右下的硬阴影由程序加；脚印本身就是深色，不加描边
ART = """
.................
....y.....kk.k...
...yyy....kk..k..
....y..........k.
...........kkkk..
..........kkkkkk.
..........kkkkkk.
...k.kk....kkkkk.
..k..kk....kkkk..
.k..........kk...
..kkkk...........
.kkkkkk..........
.kkkkkk..........
.kkkkk...........
..kkkk...........
...kk............
.................
"""


def oklch_to_hex(l: float, c: float, h: float) -> str:
    a = c * math.cos(math.radians(h))
    b = c * math.sin(math.radians(h))
    l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )

    def gamma(x: float) -> int:
        x = min(max(x, 0.0), 1.0)
        x = 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
        return round(x * 255)

    return "#" + "".join(f"{gamma(v):02x}" for v in rgb)


# 和 src/index.css 的 @theme 一致
COLORS = {
    "ink": oklch_to_hex(0.27, 0.035, 315),
    "paper": oklch_to_hex(0.988, 0.012, 80),
    "berry": oklch_to_hex(0.90, 0.055, 355),
    "lemon": oklch_to_hex(0.95, 0.10, 100),
    "card": "#ffffff",
}
FILL = {"k": COLORS["ink"], "y": COLORS["lemon"]}
BACKGROUND = COLORS["berry"]


def parse_art() -> list[list[str | None]]:
    rows = [r for r in ART.strip("\n").split("\n")]
    size = len(rows)
    assert all(len(r) == size for r in rows), "像素画必须是正方形"
    return [[FILL.get(ch) for ch in row] for row in rows]


def with_outline(art: list[list[str | None]]) -> list[list[str | None]]:
    """浅色部分加 1 像素描边（上下左右相邻），再往右下错开 1 像素加硬阴影，和界面上卡片的阴影一致"""
    n = len(art)
    out = [row[:] for row in art]
    ink = COLORS["ink"]
    filled = {(x, y) for y in range(n) for x in range(n) if art[y][x] and art[y][x] != ink}
    outline = set()
    for x, y in filled:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p = (x + dx, y + dy)
            if p not in filled and 0 <= p[0] < n and 0 <= p[1] < n:
                outline.add(p)
    for x, y in outline:
        out[y][x] = ink
    for x, y in filled | outline:
        p = (x + 1, y + 1)
        if 0 <= p[0] < n and 0 <= p[1] < n and out[p[1]][p[0]] is None:
            out[p[1]][p[0]] = ink
    return out


def render(grid: list[list[str | None]], cell: int, background: str | None) -> Image.Image:
    n = len(grid)
    img = Image.new("RGBA", (n * cell, n * cell), background or (0, 0, 0, 0))
    for y, row in enumerate(grid):
        for x, color in enumerate(row):
            if color:
                img.paste(color, (x * cell, y * cell, (x + 1) * cell, (y + 1) * cell))
    return img


def pad(grid, total: int, fill=None):
    """把 n×n 的像素画放在 total×total 的格子中间"""
    n = len(grid)
    off = (total - n) // 2
    out = [[fill] * total for _ in range(total)]
    for y in range(n):
        for x in range(n):
            if grid[y][x]:
                out[y + off][x + off] = grid[y][x]
    return out


def circle_mask(img: Image.Image, cells: int) -> Image.Image:
    """圆形图标：按格子判断，圆边也是台阶状的像素"""
    cell = img.width // cells
    mask = Image.new("L", img.size, 0)
    r = cells / 2
    for y in range(cells):
        for x in range(cells):
            if (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r:
                mask.paste(255, (x * cell, y * cell, (x + 1) * cell, (y + 1) * cell))
    img = img.copy()
    img.putalpha(mask)
    return img


def svg(grid, background: str) -> str:
    n = len(grid)
    rects = [f'<rect width="{n}" height="{n}" fill="{background}"/>']
    for y, row in enumerate(grid):
        for x, color in enumerate(row):
            if color:
                rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{color}"/>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
        + "".join(rects)
        + "</svg>\n"
    )


def main() -> None:
    art = with_outline(parse_art())
    n = len(art)  # 17

    if "--preview" in sys.argv:
        path = Path(sys.argv[sys.argv.index("--preview") + 1])
        render(pad(art, 27), 16, BACKGROUND).save(path)
        print(f"预览：{path}")
        return

    # 自适应图标（安卓 8+）：前景画布 108dp，用 27 格，每格 4dp；中间 66dp（约 16.5 格）是安全区，
    # 17 格的画正好放在里面。27 格让每种密度的像素都是整数倍：108/162/216/324/432 = 27 × 4/6/8/12/16
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    fg = pad(art, 27)
    mono = [[COLORS["ink"] if c else None for c in row] for row in fg]
    for d, k in densities.items():
        folder = RES / f"mipmap-{d}"
        cell = int(4 * k)
        render(fg, cell, None).save(folder / "ic_launcher_foreground.png")
        render(mono, cell, None).save(folder / "ic_launcher_monochrome.png")
        # 老版本安卓的方形和圆形图标：48dp，用 24 格，每格 2dp
        legacy = render(pad(art, 24), int(2 * k), BACKGROUND)
        legacy.save(folder / "ic_launcher.png")
        circle_mask(legacy, 24).save(folder / "ic_launcher_round.png")

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{BACKGROUND.upper()}</color>\n'
        f'    <color name="splash_background">{COLORS["paper"].upper()}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (RES / "mipmap-anydpi-v26" / name).write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n'
            "</adaptive-icon>\n",
            encoding="utf-8",
        )

    # 启动画面（安卓 11 及以下用这些图；12 起系统用图标加底色，见 styles.xml）：奶油底，图标居中
    for f in sorted(RES.glob("drawable*/splash.png")):
        w, h = Image.open(f).size
        cell = max(1, min(w, h) // (n * 3))
        icon = render(pad(art, n + 2), cell, BACKGROUND)
        canvas = Image.new("RGBA", (w, h), COLORS["paper"])
        canvas.paste(icon, ((w - icon.width) // 2, (h - icon.height) // 2))
        canvas.convert("RGB").save(f)

    # 网页：矢量图标，另存一份 512 像素的 PNG 备用（以后做"添加到主屏幕"时用）
    web = pad(art, 19)
    (REPO / "public" / "favicon.svg").write_text(svg(web, BACKGROUND), encoding="utf-8")
    render(web, 27, BACKGROUND).resize((512, 512), Image.NEAREST).save(REPO / "public" / "icon-512.png")
    print("图标已生成", COLORS)


if __name__ == "__main__":
    main()
