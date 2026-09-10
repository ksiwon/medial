import { describe, expect, it } from 'vitest';
// The screen's own source, read as text by the bundler: this test is about what
// the stylesheet declares, not about what the component renders.
import SOURCE from './ObserveScreen.tsx?raw';

// This is not a copy of a stylesheet. It asserts that two declarations which
// must agree do agree, and it exists because their disagreement was invisible
// to everything else we run.
//
// The three columns place themselves by name (`grid-area: village`). At a width
// where the container declares columns but no `grid-template-areas`, that name
// is read as a *line* name instead: implicit tracks appear and all three panels
// are painted in the same cell, on top of each other. That is what shipped -
// above 1280px the 1:1:1 screen was three overlapping panels, every one of them
// 1027px wide at the same coordinates. `tsc` cannot see it, jsdom does not lay
// out, and the mount tests passed because all three columns really were in the
// document. Only a browser showed it.

/** The Layout template literal, with comments removed so prose about grid
 *  properties is not mistaken for the properties themselves. */
function layoutCss(): string {
  const start = SOURCE.indexOf('const Layout = styled.div`');
  expect(start).toBeGreaterThan(-1);
  const open = SOURCE.indexOf('`', start) + 1;
  const close = SOURCE.indexOf('`;', open);
  expect(close).toBeGreaterThan(open);
  return SOURCE.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** One entry per width the layout defines: the base rule, then each media
 *  query, each with its own declarations. */
function widthRules(): { name: string; css: string }[] {
  const css = layoutCss();
  const out: { name: string; css: string }[] = [];
  const media = /@media[^{]*\{/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let base = '';
  while ((match = media.exec(css))) {
    base += css.slice(cursor, match.index);
    // Walk to the matching brace so a nested block cannot end the query early.
    let depth = 1;
    let i = media.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ name: match[0].replace(/\s*\{$/, '').trim(), css: css.slice(media.lastIndex, i - 1) });
    cursor = i;
    media.lastIndex = i;
  }
  base += css.slice(cursor);
  return [{ name: 'base (>= 1280px)', css: base }, ...out];
}

/** The area names a `grid-template-areas` value mentions. */
function namesIn(value: string): Set<string> {
  const names = new Set<string>();
  for (const row of value.match(/'[^']*'/g) ?? []) {
    for (const name of row.replace(/'/g, '').trim().split(/\s+/)) {
      if (name && name !== '.') names.add(name);
    }
  }
  return names;
}

describe('마을 관찰 3열 그리드', () => {
  const used = new Set(
    (SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').match(/grid-area:\s*([\w-]+)/g) ?? []).map(
      (declaration: string) => declaration.split(':')[1].trim(),
    ),
  );

  it('places its children by name, so every width must define those names', () => {
    expect(used.size).toBeGreaterThan(1);
    for (const rule of widthRules()) {
      if (!rule.css.includes('grid-template-columns')) continue;
      expect(
        rule.css.includes('grid-template-areas'),
        `${rule.name} declares columns but no grid-template-areas, so ` +
          `[${[...used].join(', ')}] are read as line names and the panels overlap`,
      ).toBe(true);
    }
  });

  it('gives every width a home for every panel', () => {
    for (const rule of widthRules()) {
      const declaration = /grid-template-areas:([\s\S]*?);/.exec(rule.css);
      if (!declaration) continue;
      const declared = namesIn(declaration[1]);
      for (const name of used) {
        expect(declared.has(name), `${rule.name} has no cell for "${name}"`).toBe(true);
      }
    }
  });

  it('lets every stacked column ask for a real height', () => {
    // Stacked, these columns declare min-heights that together already exceed a
    // phone viewport. Any column still carrying `min-height: 0` at that width is
    // handed a 0px track while its children keep drawing full size - which is
    // how the map came to be painted straight over the orchestrator panel.
    for (const name of ['Village', 'Middle', 'RightCol']) {
      const start = SOURCE.indexOf(`const ${name} = styled.div\``);
      expect(start, `${name} not found`).toBeGreaterThan(-1);
      const block = SOURCE.slice(start, SOURCE.indexOf('`;', start));
      const narrow = block.slice(block.indexOf('@media (max-width: 899px)'));
      const declared = /min-height:\s*([^;]+);/.exec(narrow.slice(0, narrow.indexOf('}')));
      expect(declared, `${name} sets no min-height when stacked`).not.toBeNull();
      expect(declared![1].trim()).not.toBe('0');
    }
  });
});
