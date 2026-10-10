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

/** The exhibition's night palette (2026-10-07): the opening film and the observe
 *  screen share it, so watching the village reads as one piece with the film
 *  rather than a dark player beside a light admin panel. The village map is the
 *  one light object on it. `accent` is "now" everywhere - the lit timeline line,
 *  the ring on the map where the stage is, the open request. */
export const night = {
  ground: '#121310',
  panel: '#1b1c18',
  raised: '#25261f',
  line: 'rgba(246, 241, 232, 0.10)',
  ink: '#f6f1e8',
  mute: 'rgba(246, 241, 232, 0.66)',
  faint: 'rgba(246, 241, 232, 0.40)',
  /** The opening film's ground, and the black of the one thing to press next. */
  deep: '#15150f',
  accent: '#e2542c',
  accentSoft: 'rgba(226, 84, 44, 0.16)',
} as const;

const K = 'var(--k, 1)';

/** The type scale's multiplier: 1 on a laptop, larger on a wall screen
 *  (useUiScale sets --k on the page). Every type size and every rounded label
 *  is written through it, so a bigger screen reads bigger without a second layout. */
export const px = (n: number) => `calc(${n}px * ${K})`;

/** One font stack: Pretendard, shipped with the build.
 *
 *  An earlier stack named 'Pretendard' without loading it, so every screen was
 *  really the system font. The @font-face now comes from the `pretendard`
 *  package imported in main.tsx, and the platform fonts after it are only a
 *  fallback for a glyph the subset does not carry. */
export const font = {
  family:
    '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", Roboto, sans-serif',
  page: `calc(24px * ${K})`,
  section: `calc(20px * ${K})`,
  brand: `calc(20px * ${K})`,
  body: `calc(16px * ${K})`,
  small: `calc(12px * ${K})`,
  /** Map place names and required attribution only. Never primary information. */
  micro: `calc(12px * ${K})`,
} as const;

/** The scale every gap, padding and margin on the reading pages is picked from.
 *  Named steps, not numbers, so two pages that mean "a little" or "a section apart"
 *  cannot drift to 14 and 16. Each goes through the type scale (`px`). */
export const space = {
  xs: px(4),
  sm: px(8),
  md: px(12),
  lg: px(16),
  xl: px(24),
  xxl: px(32),
  huge: px(48),
} as const;

/** The corner scale. A thing that is a control, a panel of the observe screen, or a
 *  card of a reading page has one radius, and these are the only ones. */
export const radius = {
  xs: px(4),
  control: px(8),
  panel: px(16),
  card: px(24),
  pill: '1000px',
  round: '50%',
} as const;

/** Light on the night ground: the cream of the ink and the orange of the accent at an
 *  opacity, and the black under a raised thing. One place for every "a bit see-through". */
export const inkA = (a: number) => `rgba(246, 241, 232, ${a})`;
export const accentA = (a: number) => `rgba(226, 84, 44, ${a})`;
export const shadeA = (a: number) => `rgba(0, 0, 0, ${a})`;

/** What a raised card and the one thing to press sit on. */
export const shadow = {
  card: `0 ${px(20)} ${px(40)} ${shadeA(0.35)}`,
  cardLit: `0 ${px(24)} ${px(48)} ${accentA(0.22)}`,
  button: `0 ${px(12)} ${px(28)} ${accentA(0.35)}`,
  buttonLit: `0 ${px(16)} ${px(32)} ${accentA(0.45)}`,
} as const;

/** A card of the reading pages: raised at the top, settling into the panel. */
export const cardGround = `linear-gradient(180deg, ${night.raised} 0%, ${night.panel} 50%)`;
