// Layout audit for the exhibition walk (2026-10-07). Needs the sim record served:
// run-sim (or preview medial-sim + medial-studio on 5173), then
//   node scripts/audit_layout.cjs .run/audit [1280x720,1600x900,1920x1080,1558x1277]
// For every visible text or picture on every screen of the walk it reports what is cut by
// its own box, spills past a box that hides overflow, leaves the screen, or sits under
// something else that is visible. Screenshots land beside the report.
const { chromium } = require(process.cwd() + '/node_modules/playwright');
const out = process.argv[2] || '.run/audit';
require('fs').mkdirSync(out, { recursive: true });
const sizes = (process.argv[3] || '1280x720,1600x900,1920x1080,1558x1277').split(',').map((s) => s.split('x').map(Number));

const AUDIT = () => {
  const issues = [];
  const style = document.createElement('style');
  style.textContent = '* { pointer-events: auto !important; }';
  document.head.appendChild(style);
  const W = innerWidth, H = innerHeight;
  const seen = (el) => {
    const shut = el.closest && el.closest('details:not([open])');
    if (shut && !el.closest('summary')) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const name = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} "${t}"`;
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const all = [...document.querySelectorAll('body *')].filter((el) => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT');
  for (const el of all) {
    const isText = ownText(el) || el.tagName === 'text';
    const isPic = el.tagName === 'IMG' && !el.closest('[data-who]');
    if (!isText && !isPic) continue;
    if (!seen(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // 1. the element clips its own text
    if (el instanceof HTMLElement && ownText(el)) {
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible')
        issues.push(['clipped-x' + (cs.textOverflow === 'ellipsis' ? ' (…)' : ''), name(el), `${el.scrollWidth}>${el.clientWidth}`]);
      if (el.scrollHeight > el.clientHeight + 2 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip'))
        issues.push(['clipped-y', name(el), `${el.scrollHeight}>${el.clientHeight}`]);
    }
    // 2. outside an ancestor that hides overflow
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      // A box that scrolls shows what is past its edge when scrolled: not cut.
      if (['auto', 'scroll'].includes(acs.overflowY) || ['auto', 'scroll'].includes(acs.overflowX)) break;
      const hides = ['hidden', 'clip'].includes(acs.overflowX) || ['hidden', 'clip'].includes(acs.overflowY);
      const svgRoot = a.tagName === 'svg' && acs.overflow !== 'visible';
      if (!hides && !svgRoot) continue;
      const ar = a.getBoundingClientRect();
      const d = Math.max(ar.left - r.left, r.right - ar.right, ar.top - r.top, r.bottom - ar.bottom);
      if (d > 1.5) issues.push(['outside-box', name(el), `${Math.round(d)}px past ${name(a).slice(0, 50)}`]);
      break;
    }
    // 3. off the screen
    const off = Math.max(-r.left, r.right - W, -r.top, r.bottom - H);
    if (off > 1.5) issues.push(['off-screen', name(el), `${Math.round(off)}px`]);
    // 4. covered: the middle and the four corners (inset 2px) must be this element or its own
    if (isText) {
      // Inside the box, away from rounded corners: the middle and four points 30% in.
      const ix = r.width * 0.3, iy = r.height * 0.3;
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + ix, r.top + iy], [r.right - ix, r.top + iy], [r.left + ix, r.bottom - iy], [r.right - ix, r.bottom - iy]];
      // The topmost thing at a point that can actually be seen (a faded-out layer does not cover).
      const topAt = (x, y) => document.elementsFromPoint(x, y).find((n) => seen(n)) ?? null;
      const covered = pts.filter(([x, y]) => {
        if (x < 0 || y < 0 || x > W || y > H) return false;
        const top = topAt(x, y);
        return top && top !== el && !el.contains(top) && !top.contains(el);
      }).map(([x, y]) => topAt(x, y));
      if (covered.length >= 2) issues.push(['covered', name(el), `by ${name(covered[0]).slice(0, 50)}`]);
    }
  }
  // ---- alignment ----------------------------------------------------------
  // Pretendard's content box: ascent 0.952, descent 0.268 of the font size. A text
  // range's rect is that box, so the baseline sits 0.952/1.22 of the way down it.
  const ASC = 0.952 / 1.22;
  const textRects = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  };
  const union = (rs) => rs.reduce((u, r) => ({ l: Math.min(u.l, r.left), t: Math.min(u.t, r.top), r: Math.max(u.r, r.right), b: Math.max(u.b, r.bottom) }),
    { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
  const boxed = (el, cs) => {
    const bg = cs.backgroundColor.match(/[\d.]+/g);
    const hasBg = bg && (bg.length < 4 || parseFloat(bg[3]) > 0.02);
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none');
    return el.tagName === 'BUTTON' || hasBg || hasBorder;
  };
  for (const el of all) {
    if (!(el instanceof HTMLElement) || !seen(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.height > 56 || r.height < 10) continue;
    if (!boxed(el, cs)) continue;
    const rs = textRects(el);
    if (!rs.length) continue;
    // one line of content only: a wrapped paragraph is not a centred label
    const lines = new Set(rs.map((x) => Math.round(x.top + x.height / 2)));
    if ([...lines].some((y) => Math.abs(y - [...lines][0]) > 4)) continue;
    const u = union(rs);
    const inner = { l: r.left + parseFloat(cs.borderLeftWidth), r: r.right - parseFloat(cs.borderRightWidth),
                    t: r.top + parseFloat(cs.borderTopWidth), b: r.bottom - parseFloat(cs.borderBottomWidth) };
    const dv = (u.t + u.b) / 2 - (inner.t + inner.b) / 2;
    if (Math.abs(dv) > 1.5) issues.push(['v-center', name(el), `text ${dv > 0 ? 'low' : 'high'} by ${Math.abs(dv).toFixed(1)}px (box h ${Math.round(r.height)})`]);
    const pillish = el.tagName === 'BUTTON' || parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 1 || cs.textAlign === 'center';
    if (pillish && r.width < 400) {
      const gl = u.l - inner.l, gr = inner.r - u.r;
      if (Math.abs(gl - gr) > 2) issues.push(['h-center', name(el), `left ${gl.toFixed(1)} / right ${gr.toFixed(1)}`]);
    }
  }
  // Things side by side in one row: their text should share a baseline or a centre.
  const firstLine = (el) => {
    const rs = textRects(el);
    if (!rs.length) return null;
    const f = rs[0];
    return { base: f.top + f.height * ASC, mid: f.top + f.height / 2, t: f.top, b: f.bottom };
  };
  for (const box of all) {
    if (!(box instanceof HTMLElement) || !seen(box)) continue;
    const cs = getComputedStyle(box);
    const rowish = (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')) || cs.display.includes('grid');
    if (!rowish) continue;
    const kids = [...box.children].filter((k) => seen(k) && (k.textContent || '').trim()).map((k) => ({ k, f: firstLine(k), r: k.getBoundingClientRect() }))
      .filter((x) => x.f && x.r.height < 90);
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i], b = kids[j];
        // same row: side by side, boxes overlapping vertically, not stacked
        if (a.r.right > b.r.left + 1 && b.r.right > a.r.left + 1) continue;
        if (Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) < 4) continue;
        // compare their first lines only when those lines face each other
        if (Math.min(a.f.b, b.f.b) - Math.max(a.f.t, b.f.t) < -2) {
          issues.push(['row', `${name(a.k).slice(0, 30)} ↔ ${name(b.k).slice(0, 30)}`, `first lines do not meet (in ${name(box).slice(0, 30)})`]);
          continue;
        }
        const db = Math.abs(a.f.base - b.f.base), dm = Math.abs(a.f.mid - b.f.mid);
        if (db > 1.5 && dm > 1.5) issues.push(['row', `${name(a.k).slice(0, 30)} ↔ ${name(b.k).slice(0, 30)}`, `baseline Δ${db.toFixed(1)} centre Δ${dm.toFixed(1)} (in ${name(box).slice(0, 30)})`]);
      }
    }
  }

  style.remove();
  return issues;
};

(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const [w, h] of sizes) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const shot = async (label) => {
      const issues = await p.evaluate(AUDIT);
      report.push({ size: `${w}x${h}`, label, issues });
      await p.screenshot({ path: `${out}/A-${w}x${h}-${label}.png` });
    };
    await p.goto('http://localhost:5173/');
    // the film: the end of each scene, when everything in it has appeared
    const ends = [5, 10.5, 16, 27.5, 35.5, 44.5];
    const t0 = Date.now();
    for (let i = 0; i < ends.length; i += 1) {
      await p.waitForTimeout(Math.max(0, ends[i] * 1000 - (Date.now() - t0)));
      await shot(`intro${i + 1}`);
    }
    // day one: a scene, then between scenes, then the day's end
    await p.waitForTimeout(12000);
    await shot('day1-scene');
    await p.getByRole('button', { name: '⏸ 정지' }).click();
    const rail = p.getByRole('slider', { name: '시각' });
    const box = await rail.boundingBox();
    await p.mouse.move(box.x + 14, box.y + 30); await p.mouse.down();
    await p.mouse.move(box.x + 14, box.y + box.height * 0.6, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(800);
    await shot('day1-between');
    await p.mouse.move(box.x + 14, box.y + 30); await p.mouse.down();
    await p.mouse.move(box.x + 14, box.y + box.height - 2, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(800);
    await shot('day1-end');
    await p.getByRole('button', { name: /주민 리뷰/ }).click();
    await p.waitForTimeout(1200);
    await shot('evaluations');
    const next = p.getByRole('button', { name: /무엇을 고칠지/ }).first();
    if (await next.count()) { await next.click(); await p.waitForTimeout(1200); await shot('choice'); }
    await p.close();
  }
  await b.close();
  const fs = require('fs');
  fs.writeFileSync(`${out}/audit.json`, JSON.stringify(report, null, 1));
  for (const r of report) {
    console.log(`\n## ${r.size} ${r.label}: ${r.issues.length}`);
    const seen = new Set();
    for (const i of r.issues) { const k = i.join(' | '); if (!seen.has(k)) { seen.add(k); console.log('  ' + k); } }
  }
})();
