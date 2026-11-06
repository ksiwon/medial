import sys, cv2, numpy as np
M = 'docs/presentations/2026-11-exhibition-mockup'
base_path, people_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
src = lambda n: cv2.imread(f'{M}/src/{n}.png')
S = 2
base = cv2.imread(base_path); img = cv2.imread(people_path)
f = 3072 / base.shape[1]
if abs(f - 1) > 1e-3:
    base = cv2.resize(base, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC); img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
H, W = base.shape[:2]
b, g, r = [base[:, :, i].astype(int) for i in range(3)]
def mk(cond): return (cond.astype(np.uint8) * 255)
masks = {
  'screen': mk((g > 190) & (r < 90) & (b < 90)),
  'pad':    mk((r > 190) & (b > 190) & (g < 90)),
  'red':    mk((r > 180) & (g < 70) & (b < 70)),
  'yellow': mk((r > 200) & (g > 180) & (b < 90)),
}
def quad(m):
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    for eps in np.linspace(0.01, 0.1, 40):
        ap = cv2.approxPolyDP(hull, eps * cv2.arcLength(hull, True), True)
        if len(ap) == 4: break
    else:
        ap = cv2.boxPoints(cv2.minAreaRect(hull)).reshape(-1, 1, 2)
    p = ap.reshape(4, 2).astype(np.float32)
    s = p.sum(1); d = p[:, 0] - p[:, 1]
    return np.array([p[np.argmin(s)], p[np.argmax(d)], p[np.argmax(s)], p[np.argmin(d)]], np.float32)  # tl tr br bl
Q = {k: quad(masks[k]) for k in ('screen', 'pad', 'red', 'yellow')}
for k, v in Q.items(): print(k, v.round(0).tolist())

# visible placeholder pixels in the people image (people occlude some of them)
ib, ig, ir = [img[:, :, i].astype(int) for i in range(3)]
vis = {
  'screen': (ig > 170) & (ir < 110) & (ib < 110),
  'pad': (ir > 170) & (ib > 170) & (ig < 110),
  'red': (ir > 160) & (ig < 90) & (ib < 90),
  'yellow': (ir > 190) & (ig > 160) & (ib < 110),
}
out_img = img.copy().astype(np.float32)
claimed = np.zeros((H, W), np.uint8)

def paste(name, content, strength=0.6):
    q = Q[name]
    h, w = content.shape[:2]
    Hm = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), q)
    warped = cv2.warpPerspective(content, Hm, (W, H), flags=cv2.INTER_AREA if min(h, w) > 900 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    region = np.zeros((H, W), np.uint8); cv2.fillConvexPoly(region, q.astype(np.int32), 255)
    region = cv2.dilate(region, np.ones((2 * S + 3, 2 * S + 3), np.uint8))  # eat the colored fringe
    m = (vis[name].astype(np.uint8) * 255) & region
    m = cv2.dilate(m, np.ones((2 * S + 1, 2 * S + 1), np.uint8)) & region
    m = cv2.GaussianBlur(m, (0, 0), 0.8 * S).astype(np.float32)[..., None] / 255
    # keep the room's light on the object: shading from the original placeholder luminance
    lum = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY).astype(np.float32)
    inside = masks[{'screen': 'screen', 'pad': 'pad', 'red': 'red', 'yellow': 'yellow'}[name]] > 0
    ref = np.median(lum[inside]); shade = np.clip(lum / ref, 0.8, 1.2)
    shade = cv2.GaussianBlur(shade, (0, 0), 6 * S)[..., None]
    shade = 1 + (shade - 1) * strength
    comp = warped.astype(np.float32) * shade
    out_img[:] = out_img * (1 - m) + np.clip(comp, 0, 255) * m
    near = cv2.dilate(region, np.ones((6 * S, 6 * S), np.uint8))
    claimed[:] = claimed | near
    spill = (m[..., 0] < 0.5) & (near > 0)
    B_, G_, R_ = out_img[..., 0].copy(), out_img[..., 1].copy(), out_img[..., 2].copy()
    if name == 'screen':
        ex = np.clip(G_ - np.maximum(R_, B_), 0, None) * spill; out_img[..., 1] = G_ - ex
    elif name == 'pad':
        ex = np.clip(np.minimum(R_, B_) - G_, 0, None) * spill; out_img[..., 0] = B_ - ex; out_img[..., 2] = R_ - ex
    elif name == 'red':
        ex = np.clip(R_ - np.maximum(G_, B_), 0, None) * spill * (R_ > 120); out_img[..., 2] = R_ - ex
    else:
        ex = np.clip(np.minimum(R_, G_) - B_, 0, None) * spill; out_img[..., 2] = R_ - ex; out_img[..., 1] = G_ - ex

paste('screen', src('wall_3_scene'), 0.5)
paste('pad', src('pad_3_scene'), 0.5)
paste('red', src('cover_draft'), 0.9)
paste('yellow', src('cover_revised'), 0.9)

# leftovers of the flat placeholder colours at the objects' edges: inpaint them from their neighbours
def zone(names, pad_px):
    z = np.zeros((H, W), np.uint8)
    for n in names:
        q = Q[n].astype(np.int32); cv2.fillConvexPoly(z, q, 255)
    return cv2.dilate(z, np.ones((pad_px, pad_px), np.uint8))
o8 = np.clip(out_img, 0, 255).astype(np.uint8)
ob, og, orr = [o8[..., i].astype(int) for i in range(3)]
mag = ((orr > 120) & (ob > 120) & (og < 0.55 * np.minimum(orr, ob))) & (zone(['pad'], 14 * S) > 0)
red = ((orr > 150) & (og < 0.55 * orr) & (ob < 0.55 * orr)) & (zone(['red', 'yellow'], 14 * S) > 0)
yel = ((orr > 170) & (og > 150) & (ob < 0.5 * og)) & (zone(['red', 'yellow'], 14 * S) > 0)
rem = cv2.dilate(((mag | red | yel).astype(np.uint8)) * 255, np.ones((3, 3), np.uint8))
print('placeholder leftovers inpainted:', int((rem > 0).sum()), 'px')
o8 = cv2.inpaint(o8, rem, 3, cv2.INPAINT_TELEA); out_img = o8.astype(np.float32)

# --- poster: hung on the wall BESIDE the monitor, sized and placed from the floor line ---
sx = np.where(masks['screen'] > 0)
gx0, gx1, gy0 = sx[1].min(), sx[1].max(), sx[0].min()
mon_l, mon_r, mon_top = gx0 - 6 * S, gx1 + 6 * S, gy0 - 6 * S      # outer edge of the monitor
lum = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY).astype(np.float32)
col = cv2.GaussianBlur(lum[:, 60 * S:260 * S].mean(1, keepdims=True), (0, 0), 2)[:, 0]
floor_y = next(y for y in range(H // 3, H) if col[y] < 165)   # wall meets floor (where the monitor plinth stands)
PAD = 520 * S                                   # more wall above, so the whole poster is in the frame
top_row = cv2.GaussianBlur(out_img[0:4 * S].mean(0, keepdims=True), (0, 0), 3 * S)
pad = np.repeat(top_row, PAD, 0) + np.random.default_rng(1).normal(0, 0.7, (PAD, W, 3))
canvas = np.vstack([pad, out_img]); H = canvas.shape[0]
floor_y += PAD
k = (mon_r - mon_l) / 95 * 0.97                # px per cm in the wall plane: the wall is a little farther from the camera than the monitor
pw, ph = int(84 * k), int(119 * k)
gap = int(8 * k)
x0 = mon_r + gap
bottom_cm = 75                                 # poster bottom edge above the floor
yy0 = int(floor_y - (bottom_cm + 119) * k)
print('floor', floor_y, 'k', round(k, 2), 'monitor top is', round((floor_y - mon_top) / k), 'cm above the floor in this picture')
bg = canvas.copy()
poster = cv2.resize(src('poster_H11'), (pw, ph), interpolation=cv2.INTER_AREA).astype(np.float32)
# a hanging poster: it floats ~12 cm off the wall (soft offset shadow), between two thin aluminium hanger rails,
# on two steel wires that go up out of the picture to the ceiling
sh = np.zeros((H, W), np.float32); sh[yy0 + 9 * S:yy0 + ph + 12 * S, x0 + 8 * S:x0 + pw + 9 * S] = 1
sh = cv2.GaussianBlur(sh, (0, 0), 9 * S)[..., None] * 0.30
canvas = canvas * (1 - sh)
gradient = np.linspace(1.02, 0.97, ph)[:, None, None]
canvas[yy0:yy0 + ph, x0:x0 + pw] = np.clip(poster * gradient, 0, 255)
rail = max(8, int(1.2 * k))
for ry in (yy0 - int(rail * 0.7), yy0 + ph - int(rail * 0.3)):
    cv2.rectangle(canvas, (x0 - 3 * S, ry), (x0 + pw + 3 * S, ry + rail), (206, 206, 210), -1)
    cv2.line(canvas, (x0 - 3 * S, ry), (x0 + pw + 3 * S, ry), (244, 244, 246), max(1, S))          # lit top edge
    cv2.line(canvas, (x0 - 3 * S, ry + rail), (x0 + pw + 3 * S, ry + rail), (140, 140, 146), max(1, S))  # shaded bottom edge
wires = (x0 + int(pw * 0.10), x0 + int(pw * 0.90))
wshadow = np.zeros((H, W), np.float32)
for wx in wires: cv2.line(wshadow, (wx + 9 * S, 0), (wx + 9 * S, yy0), 1.0, 2 * S, cv2.LINE_AA)
canvas = canvas * (1 - cv2.GaussianBlur(wshadow, (0, 0), 3 * S)[..., None] * 0.18)
for wx in wires:
    cv2.line(canvas, (wx, 0), (wx, yy0 - int(rail * 0.7)), (92, 92, 98), max(2, int(1.6 * S)), cv2.LINE_AA)
    cv2.line(canvas, (wx - 1, 0), (wx - 1, yy0 - int(rail * 0.7)), (176, 176, 182), 1, cv2.LINE_AA)       # glint on the steel
    cv2.circle(canvas, (wx, yy0 - int(rail * 0.7)), max(4, int(0.5 * k)), (150, 150, 156), -1, cv2.LINE_AA)
print('rail', rail, 'wires x', wires, 'poster top', yy0)
if len(sys.argv) > 4:                          # a visitor standing in front of the poster: found as what changed against the reference picture
    ref = cv2.imread(sys.argv[4])
    if ref.shape[1] != img.shape[1]: ref = cv2.resize(ref, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_CUBIC)
    d = np.abs(img.astype(int) - ref.astype(int)).max(2)
    m = ((d > 45) * 255).astype(np.uint8); m[:, :int(0.55 * m.shape[1])] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((4 * S + 1, 4 * S + 1), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7 * S, 7 * S), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); m = ((lab == keep) * 255).astype(np.uint8)
    cnt, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); filled = np.zeros_like(m); cv2.drawContours(filled, cnt, -1, 255, -1)
    filled = cv2.erode(filled, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4 * S + 1, 4 * S + 1)))   # a little inside the person: no light wall halo on the dark poster
    full = np.zeros((canvas.shape[0], canvas.shape[1]), np.float32); full[PAD:] = cv2.GaussianBlur(filled, (0, 0), 0.9 * S).astype(np.float32) / 255
    cv2.imwrite(out.replace('.png', '_mask.png'), (full * 255).astype(np.uint8))
    canvas = canvas * (1 - full[..., None]) + bg * full[..., None]
cv2.imwrite(out, np.clip(canvas, 0, 255).astype(np.uint8))
print('poster px', pw, ph, 'x', x0, 'top y', yy0, 'canvas', canvas.shape)
