// What the screens read from the local API besides the week (week/types.ts): the one thing a recording says.

/** The village as the scene's map column draws it (server assets.village_map). North is up; units are the map's. */
export interface Village {
  available: boolean;
  viewBox?: [number, number, number, number];
  /** The source's own map raster and the matrix that stands it north-up; null when the file is missing. */
  raster?: { width: number; height: number; matrix: number[] } | null;
  places?: Record<string, { x: number; y: number }>;
  homes?: Record<string, { x: number; y: number }>;
  patrol?: [number, number][];
}

/** One spoken line: its recording and how long it runs (seconds). */
export interface VoiceClip {
  file: string;
  seconds: number;
}
