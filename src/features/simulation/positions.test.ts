import { describe, expect, it } from 'vitest';
import { spreadOverlaps } from './positions';

describe('map marker collision regression', () => {
  it('separates distinct groups at an identical coordinate without changing their anchors', () => {
    const groups = ['one', 'two', 'three'].map(key => ({ key, left: 100, top: 100 }));
    const layout = [...spreadOverlaps(groups, 46).values()];
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        expect(Math.hypot(layout[i].left - layout[j].left, layout[i].top - layout[j].top)).toBeGreaterThanOrEqual(46);
      }
    }
    expect(groups.every(g => g.left === 100 && g.top === 100)).toBe(true);
    expect(layout.filter(p => p.moved)).toHaveLength(2);
  });
});
