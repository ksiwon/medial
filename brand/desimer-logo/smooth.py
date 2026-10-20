"""Smooths the traced contours of desimer-logo.original.svg (letters e s i m e) without changing their design.

The tracing left tiny wobbles along every edge. Each closed contour is sampled densely, low-pass filtered along its length
(corners are kept), then refitted with far fewer cubic Bezier nodes. Writes desimer-logo.svg; the original is untouched.
  python brand/desimer-logo/smooth.py [sigma]
"""
import re, sys, math
import numpy as np

SIGMA = float(sys.argv[1]) if len(sys.argv) > 1 else 7.0   # smoothing length along the edge, px
STEP = 0.4                                                   # sampling step, px
NODE = float(sys.argv[2]) if len(sys.argv) > 2 else 2.5   # node spacing, px
CORNER_DEG = 62                                              # sharper than this stays a corner
# Narrower m (2026-10-20): the r half's counter is 6 px tighter, the n moves 26 px toward the r and its counter is 6 px
# tighter, so the r-to-n gap goes 66 -> 46 px (the counters are ~49) and the m is 32 px narrower in all; e and r follow.
# Each table maps old x -> new x, piecewise linear, per subpath of the traced m.
M_WARP = {0: [(0, 0), (816, 816), (871, 865), (4000, 3994)],
          1: [(0, -12), (1020, 1008), (1073, 1055), (4000, 3982)],
          2: [(0, -12), (1020, 1008), (1073, 1055), (4000, 3982)]}
M_SAVED = 18
TRACED = ('letters-es', 'letter-i', 'approved-m', 'letter-e-final')

src = open('desimer-logo.original.svg', encoding='utf-8').read()

def sample_subpath(d):
    nums = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:e-?\d+)?', d)]
    pts = [(nums[0], nums[1])]
    i = 2
    cur = np.array(pts[0])
    out = [cur.copy()]
    while i + 5 < len(nums) + 0 and i + 5 <= len(nums) - 1 + 0:
        p1, p2, p3 = (np.array(nums[i + k:i + k + 2]) for k in (0, 2, 4))
        n = max(8, int(np.linalg.norm(p1 - cur) + np.linalg.norm(p2 - p1) + np.linalg.norm(p3 - p2)) * 2)
        t = np.linspace(0, 1, n + 1)[1:, None]
        out.extend((1 - t) ** 3 * cur + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3)
        cur = p3
        i += 6
    return np.array(out)

def resample(P, step):
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    n = max(int(seg[-1] / step), 8)
    s = np.linspace(0, seg[-1], n, endpoint=False)
    return np.c_[np.interp(s, seg, P[:, 0]), np.interp(s, seg, P[:, 1])]

def gauss(P, sigma_samples, closed_ring=True):
    k = int(sigma_samples * 3)
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma_samples) ** 2); w /= w.sum()
    pad = np.r_[P[-k:], P, P[:k]] if closed_ring else P
    return np.c_[np.convolve(pad[:, 0], w, 'valid'), np.convolve(pad[:, 1], w, 'valid')]

def corners(P, window):
    n = len(P); idx = []
    a = P - np.roll(P, window, 0); b = np.roll(P, -window, 0) - P
    ang = np.degrees(np.abs(np.arctan2(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0], (a * b).sum(1))))
    for i in range(n):
        if ang[i] > CORNER_DEG and ang[i] == ang[(np.arange(i - window, i + window + 1) % n)].max(): idx.append(i)
    return idx

def fit_ring(P):
    """Closed contour -> cubic Beziers through evenly spaced nodes (uniform Catmull-Rom)."""
    per = max(int(NODE / STEP), 2)
    Q = P[::per]; m = len(Q)
    d = f'M{Q[0][0]:.2f} {Q[0][1]:.2f}'
    for i in range(m):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[(i + 1) % m], Q[(i + 2) % m]
        c1 = p1 + (p2 - p0) / 6; c2 = p2 - (p3 - p1) / 6
        d += f'C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}'
    return d + 'Z'

def gauss(P, sigma_samples):
    k = int(sigma_samples * 3)
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma_samples) ** 2); w /= w.sum()
    pad = np.r_[P[-k:], P, P[:k]]
    return np.c_[np.convolve(pad[:, 0], w, 'valid'), np.convolve(pad[:, 1], w, 'valid')]

def corners(P, window):
    n = len(P); idx = []
    a = P - np.roll(P, window, 0); b = np.roll(P, -window, 0) - P
    ang = np.degrees(np.abs(np.arctan2(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0], (a * b).sum(1))))
    for i in range(n):
        if ang[i] > CORNER_DEG and ang[i] == ang[(np.arange(i - window, i + window + 1) % n)].max(): idx.append(i)
    return idx

def smooth_path(d, tr, pid=''):
    tx, ty, sc = tr
    out = ''
    for k, sub in enumerate([s for s in re.split(r'(?=M)', d) if s.strip()]):
        P = sample_subpath(sub) * sc + np.array([tx, ty])
        if pid == 'approved-m':
            a = np.array(M_WARP[k]); P[:, 0] = np.interp(P[:, 0], a[:, 0], a[:, 1])
        elif pid == 'letter-e-final':
            P[:, 0] -= M_SAVED
        P = resample(P[:-1] if np.allclose(P[0], P[-1]) else P, STEP)
        S = gauss(P, SIGMA / STEP)
        for c in corners(P, int(3 / STEP)):   # a real corner stays where it was
            lo = np.arange(c - int(SIGMA / STEP) * 2, c + int(SIGMA / STEP) * 2 + 1) % len(P)
            w = np.exp(-0.5 * ((np.arange(len(lo)) - len(lo) // 2) / (SIGMA / STEP)) ** 2)[:, None]
            S[lo] = S[lo] * (1 - w) + P[lo] * w
        out += fit_ring(S)
    return out

def tr_of(attr):
    t = re.search(r'translate\(([-\d. ]+)\)', attr); s = re.search(r'scale\(([-\d.]+)\)', attr)
    a = [float(x) for x in t.group(1).split()]
    return a[0], a[1], float(s.group(1)) if s else 1.0

def swap(m):
    pid, attrs, d = m.group(1), m.group(2), m.group(3)
    if pid not in TRACED: return m.group(0)
    new = smooth_path(d, tr_of(attrs), pid)
    attrs = re.sub(r'\s*transform="[^"]*"', '', attrs)
    return f'<path id="{pid}"{attrs} d="{new}"'

out = re.sub(r'<path id="([^"]+)"([^>]*?) d="([^"]*)"', swap, src)
out = out.replace('translate(1411 97)', f'translate({1411 - M_SAVED} 97)')
out = out.replace('width="1549" height="322" viewBox="-2 -2 1549 322"', f'width="{1549 - M_SAVED}" height="322" viewBox="-2 -2 {1549 - M_SAVED} 322"')
out = out.replace('Orange Desimer wordmark.', 'Orange Desimer wordmark (traced contours smoothed).')
open('desimer-logo.svg', 'w', encoding='utf-8').write(out)
print('sigma', SIGMA, 'bytes', len(src), '->', len(out))
