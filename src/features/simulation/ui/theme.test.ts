import { describe, expect, it } from 'vitest';

// The look is one file (ui/theme.ts). A component that writes its own corner, its own colour or its
// own gap makes two screens drift apart one number at a time, so those are checked for here rather
// than hoped for in review.

const modules = import.meta.glob<string>(['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts*'], {
  query: '?raw', import: 'default', eager: true,
});

// Files being tidied: none (a file may be listed here while it is, and the list is meant to be empty).
const TEMPORARY: string[] = [];

// Where a colour may be spelled out: the palette itself, and the faces (drawn art, not interface).
const PALETTE = ['./theme.ts', '../week/faces.ts'];

// The tablet is a fixed-resolution screen: it uses plain px (no `px()` scale) for every length, so its
// lengths are not tokens (its colours and corners still are).
const TABLET = '../stage/pad/';

// The opening film and the waiting/pairing screens are sized in vw/clamp() and ignore the `--k` scale
// (ui/uiScale.ts), so their spacing is plain px by design: a space token (which scales) would change them.
const UNSCALED = ['../screens/IntroScreen.tsx', '../screens/IdleScreen.tsx', '../screens/PairScreen.tsx'];

// A spacing that is not a step of the space scale and is used once: kept as it is, on purpose.
const ONE_OFF_SPACING = [
  { file: '../week/ClosingScreen.tsx', text: 'px(96)', why: "the closing page's side margin, used once" },
];

// A font size that is not a step of the type scale and is used once: kept as it is, on purpose.
const ONE_OFF_TYPE = [
  { file: '../week/ReviewScreens.tsx', text: 'px(56)', why: 'the opening quotation mark of a resident quote, used once' },
];

const lines = (skip: (file: string) => boolean = () => false) =>
  Object.entries(modules)
    .filter(([file]) => !skip(file))
    .flatMap(([file, source]) =>
      source.split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .map((line) => ({ file, line })));

const violations = (pattern: RegExp, except?: (line: string) => boolean) =>
  lines()
    .filter(({ line }) => pattern.test(line) && !except?.(line))
    .map(({ file, line }) => `${file}: ${line.trim()}`);

/** Lines matching `pattern` in every file that is neither exempt for this check (`skip`) nor temporary. */
const outside = (skip: (file: string) => boolean, pattern: RegExp) =>
  lines((file) => skip(file) || TEMPORARY.includes(file))
    .filter(({ line }) => pattern.test(line))
    .map(({ file, line }) => `${file}: ${line.trim()}`);

describe('one look', () => {
  it('takes every corner from the radius scale', () => {
    expect(violations(/border-radius:\s*(\d+px|\$\{px\()/)).toEqual([]);
  });

  it('takes the ink, the accent and the shade from the theme, not as rgba literals in styles', () => {
    expect(violations(/rgba\((246, 241, 232|226, 84, 44|0, 0, 0)/, (line) => /['"]|^export const \w+A = /.test(line.trim()))).toEqual([]);
  });

  it('keeps every length on the 4px grid (a 1-2px hairline excepted)', () => {
    const off = (n: number) => n > 2.5 && n % 4 !== 0;
    const found = lines((file) => TEMPORARY.includes(file)).filter(({ line }) =>
      [...line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px\b|\bpx\((\d+(?:\.\d+)?)\)/g)]
        .some((m) => off(Number(m[1] ?? m[2]))));
    expect(found.map(({ file, line }) => `${file}: ${line.trim()}`)).toEqual([]);
  });

  it('writes no hex colour outside the palette', () => {
    expect(outside((file) => PALETTE.includes(file), /#[0-9a-fA-F]{3,8}\b/)).toEqual([]);
  });

  it('writes no rgba() outside the palette (the ink, accent, shade, deep, panel and ground have opacity helpers)', () => {
    expect(outside((file) => PALETTE.includes(file), /\brgba?\(/)).toEqual([]);
  });

  it('takes padding, gap and margin from the space scale, not a px literal', () => {
    const found = lines((file) => TEMPORARY.includes(file) || file.startsWith(TABLET) || UNSCALED.includes(file))
      .filter(({ line }) => /\b(padding|gap|margin)[\w-]*\s*:[^;]*(\d+(\.\d+)?px\b|\bpx\(\d)/.test(line))
      .filter(({ file, line }) => !ONE_OFF_SPACING.some((e) => e.file === file && line.includes(e.text)));
    expect(found.map(({ file, line }) => `${file}: ${line.trim()}`)).toEqual([]);
  });

  it('takes font-size from the type scale, not px(number)', () => {
    const found = lines((file) => TEMPORARY.includes(file) || file.startsWith(TABLET))
      .filter(({ line }) => /font-size\s*:[^;]*\bpx\(\d/.test(line))
      .filter(({ file, line }) => !ONE_OFF_TYPE.some((e) => e.file === file && line.includes(e.text)));
    expect(found.map(({ file, line }) => `${file}: ${line.trim()}`)).toEqual([]);
  });
});
