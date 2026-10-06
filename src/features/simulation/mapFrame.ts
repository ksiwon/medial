import type { VillagePayload } from './api/types';

// Which way the village lies on screen. Every coordinate the server sends is
// north-up, and the screen now draws it that way too: the 1.15 km north-south
// run stands upright in a tall column beside the stage, north at the top.
//
// History, because it was turned twice. On 2026-09-30 the map was laid down the
// way its source raster was drawn (north to the right) to match the exhibition
// wall. On 2026-10-06 the researcher moved the map into a permanent left column
// beside the stage; a column that tall wants the village upright, so it stands
// again. The raster is the only thing that is not north-up - it is drawn with
// `rasterTransform` (VillageMap) instead of turning every coordinate.
//
// Nothing here turns a point any more. `at` stays so the callers that draw a
// point do not each learn that.

export interface MapFrame {
  /** A north-up point, where it is drawn: itself. */
  at: (x: number, y: number) => [number, number];
  /** The village's viewBox. */
  viewBox: [number, number, number, number];
  /** Rotation of the north arrow, in degrees clockwise from up: always 0. */
  northDeg: number;
  /** SVG `matrix(...)` that puts the source raster upright, or null when the
   *  village has no raster (the synthetic one). */
  rasterTransform: string | null;
}

export function mapFrame(village: VillagePayload): MapFrame {
  const [vx, vy, vw, vh] = village.geometry.viewBox;
  const m = village.mapImage?.northUpMatrix;
  return {
    at: (x, y) => [x, y],
    viewBox: [vx, vy, vw, vh],
    northDeg: 0,
    // northUpMatrix takes a source pixel to north-up: X = a·sx + c·sy + e,
    // Y = b·sx + d·sy + f - SVG's matrix(a b c d e f) exactly.
    rasterTransform: m ? `matrix(${m.join(' ')})` : null,
  };
}
