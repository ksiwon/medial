import { describe, expect, it } from 'vitest';
import { LINE_RATE, lineMs } from './voice';

const voices = {
  'AI|길게 말하는 줄': { file: 'a.wav', seconds: 6 },
  'P1|네.': { file: 'b.wav', seconds: 0.8 },
};

describe('how long a line stays', () => {
  it('follows its recording and a short breath, not a fixed pace', () => {
    expect(lineMs(voices, 'AI', '길게 말하는 줄', 4500)).toBe(Math.round((6 / LINE_RATE + 0.3) * 1000));
  });

  it('never goes faster than it can be read', () => {
    expect(lineMs(voices, 'P1', '네.', 4500)).toBe(1200);
  });

  it('holds a line without a recording for the screen pace', () => {
    expect(lineMs(voices, 'AI', '녹음이 없는 줄', 4500)).toBe(4500);
  });
});
