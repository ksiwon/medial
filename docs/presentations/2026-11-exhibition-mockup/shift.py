import sys, cv2, numpy as np
ref = cv2.imread(sys.argv[1]); img = cv2.imread(sys.argv[2]); dx = int(sys.argv[4])
d = np.abs(img.astype(int) - ref.astype(int)).max(2)
m = ((d > 45) * 255).astype(np.uint8); m[:, :int(0.55 * m.shape[1])] = 0
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); m = ((lab == keep) * 255).astype(np.uint8)
cnt, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); f = np.zeros_like(m); cv2.drawContours(f, cnt, -1, 255, -1)
f = cv2.dilate(f, np.ones((5, 5), np.uint8))
a = cv2.GaussianBlur(f, (0, 0), 1.6).astype(np.float32)[..., None] / 255
M = np.float32([[1, 0, dx], [0, 1, 0]]); h, w = f.shape
sa = cv2.warpAffine(a[..., 0], M, (w, h))[..., None]; si = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
out = ref.astype(np.float32) * (1 - sa) + si.astype(np.float32) * sa
x, y, ww, hh = cv2.boundingRect(f); print('person box', x, y, ww, hh, '-> right edge', x + ww + dx, 'of', w)
cv2.imwrite(sys.argv[3], np.clip(out, 0, 255).astype(np.uint8))
