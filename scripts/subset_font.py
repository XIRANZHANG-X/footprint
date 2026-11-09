"""Subset Fusion Pixel 12px zh_hans to GB2312 level-1 + ASCII + punctuation + every char used in src/.

usage: python -I subset_font.py <full.woff2> <out.woff2> <project_src_dir>
"""
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

src_font, out_font, src_dir = sys.argv[1:4]

chars = set()
# ASCII printable
chars.update(chr(c) for c in range(0x20, 0x7F))
# General punctuation, CJK symbols & punctuation, fullwidth forms
for lo, hi in [(0x2010, 0x2027), (0x2030, 0x203B), (0x3000, 0x303F), (0xFF01, 0xFF5E)]:
    chars.update(chr(c) for c in range(lo, hi + 1))
chars.update('·×÷°←→↑↓★☆♥')

# GB2312 level-1 hanzi: rows 0xB0-0xD7, cells 0xA1-0xFE (0xD7FA-0xD7FE are unassigned)
level1 = 0
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        if hi == 0xD7 and lo > 0xF9:
            continue
        chars.add(bytes([hi, lo]).decode('gb2312'))
        level1 += 1

# Every non-ASCII char in the UI source
ui = set()
for p in pathlib.Path(src_dir).rglob('*'):
    if p.suffix in {'.ts', '.tsx', '.css', '.html'} and p.is_file():
        ui.update(ch for ch in p.read_text(encoding='utf-8') if ord(ch) > 0x7F)
chars |= ui

font = TTFont(src_font)
cmap = font.getBestCmap()
have = {c for c in chars if ord(c) in cmap}
missing_ui = sorted(c for c in ui if ord(c) not in cmap and not c.isspace())

opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.notdef_outline = True
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in have])
sub.subset(font)
font.flavor = 'woff2'
font.save(out_font)

print(f'GB2312 level-1: {level1}; UI chars: {len(ui)}; requested: {len(chars)}; in font: {len(have)}')
print('UI chars not in font:', [f'U+{ord(c):04X}' for c in missing_ui] or '(none)')
print('size:', pathlib.Path(out_font).stat().st_size)
