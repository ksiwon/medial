import type { VillagePayload } from './api/types';

// Which way the village lies on screen. Every coordinate the server sends is
// north-up; the screen draws 은점마을 the way its source map was drawn, with the
// 1.15 km north-south run lying along the screen and north to the right - the
// exhibition wall's layout (2026-09-30). A north-up strip left half of a wide
// screen empty.
//
// This is the one place that turns coordinates for the screen. Positions,
// clustering and the server stay north-up. Without a raster (the synthetic
// village) there is no source drawing to follow and nothing turns.

export interface MapFrame {
  /** A north-up point, where it is drawn. */
  at: (x: number, y: number) => [number, number];
  /** The village's viewBox, in drawn coordinates. */
  viewBox: [number, number, number, number];
  /** Rotation of the north arrow, in degrees clockwise from up. */
  northDeg: number;
  /** True when the raster is drawn as it is, without a transform. */
  sourceOriented: boolean;
}

export function mapFrame(village: VillagePayload): MapFrame {
  const [vx, vy, vw, vh] = village.geometry.viewBox;
  const m = village.mapImage?.northUpMatrix;
  if (!m) {
    return { at: (x, y) => [x, y], viewBox: [vx, vy, vw, vh], northDeg: 0, sourceOriented: false };
  }
  // northUpMatrix takes a source pixel to north-up: X = a·sx + c·sy + e,
  // Y = b·sx + d·sy + f. The screen wants the source pixel back.
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1;
  const at = (x: number, y: number): [number, number] => [
    (d * (x - e) - c * (y - f)) / det,
    (-b * (x - e) + a * (y - f)) / det,
  ];
  const corners = [at(vx, vy), at(vx + vw, vy), at(vx, vy + vh), at(vx + vw, vy + vh)];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  // North (0, -1) through the inverse's linear part.
  const [nx, ny] = [c / det, -a / det];
  return {
    at,
    viewBox: [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0],
    northDeg: Math.round((Math.atan2(nx, -ny) * 180) / Math.PI),
    sourceOriented: true,
  };
}
