// The single palette and scale for the research workspace, from doc 15 section 7.
//
// One file rather than colours inlined per component: the whole point of the
// screen is that "measured", "simulated" and "unknown" look different from each
// other and the same everywhere. That stops being true the moment two panels
// pick their own green.

export const colour = {
  app: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1D2935',
  secondary: '#596775',
  border: '#DDE3E8',
  primary: '#25665B',
  selected: '#EAF3F0',
  warn: '#9A651D',
  warnSurface: '#FBF4E7',
  error: '#B23A35',
  errorSurface: '#FBEDEC',
  /** Anything the run did not establish. Deliberately neutral: "no basis to
   *  judge" is not a bad result and must not be coloured as one. */
  unknown: '#8B96A1',
} as const;

/** One font stack: Pretendard, shipped with the build.
 *
 *  An earlier stack named 'Pretendard' without loading it, so every screen was
 *  really the system font. The @font-face now comes from the `pretendard`
 *  package imported in main.tsx, and the platform fonts after it are only a
 *  fallback for a glyph the subset does not carry. */
export const font = {
  family:
    '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", Roboto, sans-serif',
  page: '24px',
  section: '18px',
  brand: '18px',
  body: '14px',
  small: '12px',
  /** Map place names and required attribution only. Never primary information. */
  micro: '10px',
} as const;

export const space = [4, 8, 12, 16, 24, 32] as const;

export const radius = { panel: '10px', control: '6px' } as const;
