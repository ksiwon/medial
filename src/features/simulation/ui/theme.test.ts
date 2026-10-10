import { describe, expect, it } from 'vitest';

// The look is one file (ui/theme.ts). A component that writes its own corner or its
// own cream/orange at some opacity makes two screens drift apart one number at a time,
// so those are checked for here rather than hoped for in review.

const modules = import.meta.glob<string>(['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts*'], {
  query: '?raw', import: 'default', eager: true,
});

const lines = () =>
  Object.entries(modules).flatMap(([file, source]) =>
    source.split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map((line) => ({ file, line })));

const violations = (pattern: RegExp, except?: (line: string) => boolean) =>
  lines()
    .filter(({ line }) => pattern.test(line) && !except?.(line))
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
    const found = lines().filter(({ line }) =>
      [...line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px\b|\bpx\((\d+(?:\.\d+)?)\)/g)]
        .some((m) => off(Number(m[1] ?? m[2]))));
    expect(found.map(({ file, line }) => `${file}: ${line.trim()}`)).toEqual([]);
  });
});
