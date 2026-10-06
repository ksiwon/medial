import { describe, expect, it } from 'vitest';
import type { VillagePayload } from './api/types';
import { mapFrame } from './mapFrame';
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

describe('map frame', () => {
  const village = (northUpMatrix?: number[]) => ({
    geometry: { viewBox: [0, 0, 490, 1230] },
    mapImage: northUpMatrix ? { northUpMatrix, sourceWidthPx: 1230, sourceHeightPx: 490 } : null,
  }) as unknown as VillagePayload;

  it('keeps every point north-up and turns only the source raster', () => {
    const frame = mapFrame(village([0, -1, 1, 0, 0, 1230]));
    expect(frame.at(100, 0)).toEqual([100, 0]);
    expect(frame.at(100, 1230)).toEqual([100, 1230]);
    expect(frame.viewBox).toEqual([0, 0, 490, 1230]);
    expect(frame.northDeg).toBe(0);
    expect(frame.rasterTransform).toBe('matrix(0 -1 1 0 0 1230)');
  });

  it('draws no raster transform for a village without a source raster', () => {
    const frame = mapFrame(village());
    expect(frame.at(12, 34)).toEqual([12, 34]);
    expect(frame.viewBox).toEqual([0, 0, 490, 1230]);
    expect(frame.rasterTransform).toBeNull();
  });
});
