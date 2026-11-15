#!/usr/bin/env python3
"""Builds every app icon from assets/logo/source.jpg (the cat-on-globe logo).
   Needs: pip install pillow numpy opencv-python-headless
   Outputs: PWA icons (any / maskable / monochrome), favicon, Android adaptive + legacy launcher icons."""
import cv2, numpy as np, os, random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/logo/source.jpg')
RES = os.path.join(ROOT, 'android/app/src/main/res')
im = cv2.imread(SRC); H, W = im.shape[:2]

# ---- 1. the rounded-square art (the logo as drawn) -----------------------------------------
X0, Y0, S = 73, 73, 877                      # measured: art spans x 73..950; trimmed to a square
art = im[Y0:Y0 + S, X0:X0 + S]
def rounded_mask(size, radius_frac=0.19, inset=2):
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([inset * 4, inset * 4, size * 4 - inset * 4 - 1, size * 4 - inset * 4 - 1], radius=int(size * 4 * radius_frac), fill=255)
    return m.resize((size, size), Image.LANCZOS)
def to_pil(bgr): return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
art_pil = to_pil(art).resize((1024, 1024), Image.LANCZOS)
logo_any = art_pil.convert('RGBA'); logo_any.putalpha(rounded_mask(1024, inset=3))

# ---- 2. subject (cat + globe + rings) segmentation -----------------------------------------
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
sure = ((h >= 5) & (h <= 22) & (s > 150) & (v > 170)) | ((h >= 40) & (h <= 75) & (s > 110) & (v > 140)) | ((h >= 95) & (h <= 108) & (s > 110) & (v > 190))
x0, y0, x1, y1 = 190, 125, 860, 895
m = np.full(im.shape[:2], cv2.GC_BGD, np.uint8); m[y0:y1, x0:x1] = cv2.GC_PR_BGD
sure[:y0] = False; sure[y1:] = False; sure[:, :x0] = False; sure[:, x1:] = False
m[sure] = cv2.GC_FGD
cv2.grabCut(im, m, None, np.zeros((1, 65)), np.zeros((1, 65)), 6, cv2.GC_INIT_WITH_MASK)
a = np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(a)
a = np.where(np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 800]), 255, 0).astype(np.uint8)
a = cv2.morphologyEx(a, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
# fill the small holes (eyes, nose, continent outlines) but keep big gaps (between orbit ring and globe)
cnts, hier = cv2.findContours(a, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
for i, c in enumerate(cnts):
    if hier[0][i][3] != -1 and cv2.contourArea(c) < 9000: cv2.drawContours(a, [c], -1, 255, -1)
a = cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))          # recovers the dark outline at the edge
a = cv2.GaussianBlur(a, (0, 0), 1.4)
rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
subj = np.dstack([rgb, a])
ys, xs = np.where(a > 8); bx0, by0, bx1, by1 = xs.min() - 6, ys.min() - 6, xs.max() + 6, ys.max() + 6
subject = Image.fromarray(subj).crop((bx0, by0, bx1, by1))                      # RGBA, tight
sw, sh = subject.size

# ---- 3. clean background (gradient from the art, corners/subject inpainted + new stars) -----
bgsrc = cv2.resize(cv2.cvtColor(np.array(art_pil.convert('RGB')), cv2.COLOR_RGB2BGR), (256, 256), interpolation=cv2.INTER_AREA)
hole = np.zeros((1024, 1024), np.uint8)
hole[(np.array(logo_any)[..., 3] < 250)] = 255
sa = np.zeros((1024, 1024), np.uint8); sa[:, :] = 0
# subject alpha in art coordinates
full_a = a[Y0:Y0 + S, X0:X0 + S]; full_a = cv2.resize(full_a, (1024, 1024)); hole[cv2.dilate(full_a, np.ones((31, 31), np.uint8)) > 8] = 255
hole = cv2.dilate(hole, np.ones((9, 9), np.uint8))
small_hole = cv2.resize(hole, (256, 256), interpolation=cv2.INTER_NEAREST)
filled = cv2.inpaint(bgsrc, small_hole, 9, cv2.INPAINT_TELEA)
for _ in range(3): filled = cv2.GaussianBlur(filled, (0, 0), 6)
bg_base = Image.fromarray(cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)).resize((1024, 1024), Image.BICUBIC)
def sprinkle(img, seed=7):
    rnd = random.Random(seed); d = ImageDraw.Draw(img, 'RGBA'); S_ = img.size[0]
    for _ in range(int(S_ * 0.12)):
        x, y = rnd.randrange(S_), rnd.randrange(S_); r = rnd.choice([1, 1, 1, 2, 2, 3]) * S_ / 1024
        col = rnd.choice([(255, 255, 255, 190), (200, 190, 255, 150), (140, 220, 255, 150), (255, 160, 230, 120)])
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    return img
bg_art = sprinkle(bg_base.copy())

def compose(size, subj_h_frac, bg=bg_art, shadow=True):
    can = bg.resize((size, size), Image.LANCZOS).convert('RGBA')
    k = size * subj_h_frac / sh; sub = subject.resize((max(1, int(sw * k)), int(sh * k)), Image.LANCZOS)
    pos = ((size - sub.size[0]) // 2, (size - sub.size[1]) // 2)
    if shadow:
        sh_a = sub.split()[3].filter(ImageFilter.GaussianBlur(size * 0.012)).point(lambda p: int(p * .35))
        black = Image.new('RGBA', sub.size, (10, 6, 40, 255)); black.putalpha(sh_a)
        can.alpha_composite(black, (pos[0], pos[1] + int(size * 0.012)))
    can.alpha_composite(sub, pos); return can

# ---- 4. monochrome (Material You / Pixel themed icon): tone encoded in alpha ---------------
def mono_layer(size, h_frac):
    k = size * h_frac / sh; sub = subject.resize((max(1, int(sw * k)), int(sh * k)), Image.LANCZOS)
    arr = np.array(sub).astype(np.float32); L = (arr[..., 0] * .299 + arr[..., 1] * .587 + arr[..., 2] * .114) / 255
    tone = np.clip((L - 0.16) / 0.42, 0.14, 1.0)                  # outlines/pupils → faint, land/cat/eyes → solid
    al = (arr[..., 3] / 255) * tone
    out = np.zeros(arr.shape, np.uint8); out[..., :3] = 255; out[..., 3] = (al * 255).astype(np.uint8)
    can = Image.new('RGBA', (size, size), (255, 255, 255, 0)); can.alpha_composite(Image.fromarray(out), ((size - sub.size[0]) // 2, (size - sub.size[1]) // 2)); return can

# ---- 5. write everything ---------------------------------------------------------------------
def save(img, rel, size=None):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    (img.resize((size, size), Image.LANCZOS) if size else img).save(p, optimize=True); print('wrote', rel)
# PWA
for n in (192, 512): save(logo_any, f'icon-{n}.png', n)
save(logo_any, 'assets/logo/logo-1024.png'); save(logo_any, 'assets/logo/logo-96.png', 96)
save(logo_any, 'favicon-48.png', 48); save(logo_any, 'favicon-32.png', 32)
save(compose(512, 0.70), 'icon-maskable-512.png')
save(mono_layer(512, 0.70), 'icon-monochrome-512.png')
# Android adaptive (108dp canvas @ xxxhdpi = 432px; subject inside the 66dp safe zone)
save(bg_art.convert('RGBA').resize((432, 432), Image.LANCZOS), 'android/app/src/main/res/drawable-nodpi/ic_launcher_background.png')
fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0)); k = 432 * 0.62 / sh; sub = subject.resize((int(sw * k), int(sh * k)), Image.LANCZOS)
sha = sub.split()[3].filter(ImageFilter.GaussianBlur(5)).point(lambda p: int(p * .35)); blk = Image.new('RGBA', sub.size, (10, 6, 40, 255)); blk.putalpha(sha)
pos = ((432 - sub.size[0]) // 2, (432 - sub.size[1]) // 2); fg.alpha_composite(blk, (pos[0], pos[1] + 5)); fg.alpha_composite(sub, pos)
save(fg, 'android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png')
save(mono_layer(432, 0.62), 'android/app/src/main/res/drawable-nodpi/ic_launcher_monochrome.png')
# legacy (API 24-25) square-ish launcher icons
for d, px in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
    save(logo_any, f'android/app/src/main/res/mipmap-{d}/ic_launcher.png', px); save(logo_any, f'android/app/src/main/res/mipmap-{d}/ic_launcher_round.png', px)
os.makedirs(os.path.join(RES, 'mipmap-anydpi-v26'), exist_ok=True)
xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
'''
for n in ('ic_launcher', 'ic_launcher_round'): open(os.path.join(RES, 'mipmap-anydpi-v26', n + '.xml'), 'w').write(xml)
# previews for review
prev = Image.new('RGBA', (1500, 520), (30, 30, 36, 255))
prev.alpha_composite(logo_any.resize((480, 480)), (10, 20))
mk = compose(512, 0.70).resize((480, 480)); mm = Image.new('L', (480, 480), 0); ImageDraw.Draw(mm).ellipse([0, 0, 479, 479], fill=255); mk.putalpha(mm); prev.alpha_composite(mk, (510, 20))
tint = Image.new('RGBA', (480, 480), (190, 215, 255, 255)); tint.putalpha(Image.new('L', (480, 480), 255)); ring = Image.new('RGBA', (480, 480), (45, 55, 80, 255)); ring.putalpha(mm)
mono = mono_layer(480, 0.70); col = Image.new('RGBA', (480, 480), (190, 215, 255, 255)); col.putalpha(mono.split()[3]); ring.alpha_composite(col); prev.alpha_composite(ring, (1010, 20))
prev.convert('RGB').save('/tmp/claude-0/logo/preview.png')
