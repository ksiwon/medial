// The single palette and scale of the exhibition.
//
// One file rather than colours inlined per component: a screen that picks its own orange or its own corner makes
// two screens drift apart one number at a time (ui/theme.test.ts checks for exactly that).

/** The exhibition's night palette: the opening film, the week, the scenes and the reading pages share it, so the walk
 *  is one piece from the first frame to the last. `accent` is "now" everywhere - the event being read, the line
 *  being told, the request in force. */
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
  body: `calc(16px * ${K})`,
  small: `calc(12px * ${K})`,
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
} as const;

/** The corner scale. A rectangle (a card, a panel, a bar) is nearly square-cornered -
 *  heavily rounded boxes read as a template - and roundness is kept for what is
 *  small and pressed or named: the pill (a button, a tag) and the round (a face). */
export const radius = {
  xs: px(4),
  control: px(4),
  panel: px(8),
  card: px(8),
  pill: '1000px',
  round: '50%',
} as const;

/** Light on the night ground: the cream of the ink and the orange of the accent at an
 *  opacity, and the black under a raised thing. One place for every "a bit see-through". */
export const inkA = (a: number) => `rgba(246, 241, 232, ${a})`;
export const accentA = (a: number) => `rgba(226, 84, 44, ${a})`;
export const shadeA = (a: number) => `rgba(0, 0, 0, ${a})`;
