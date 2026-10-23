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
  /** White: text and marks laid on the accent, a pin's ring, a speech bubble. */
  white: '#ffffff',
  /** The warning amber (a cost, an emergency day). */
  warn: '#e8c46a',
  /** A request that was answered. */
  info: '#3d6ea8',
  /** The faintest accent: a card that is the one in force. */
  accentWash: '#fff6f2',
  /** The deep end of the accent: the shade of an orange note, a lifted corner. */
  /** A sticky note on a picture: the lit strip, the paper, the shade, and the lifted corner's. */
  noteLight: '#f8e58f',
} as const;

/** The speech bubble of a line already told (the one now is `night.white`) and its small label. */
export const bubble = { past: '#e9e5dd', label: '#6b675f' } as const;

/** The scene's photo frame, and the ground shown while its picture has not loaded. */
export const photo = { frame: '#2a2b28', empty: '#34352f' } as const;

/** The opening film's map: the far land (Korea) and the near land (the county). */
export const land = { far: '#3a3b33', near: '#55574b' } as const;

/** A drawn villager: skin of a portrait, and the four shirts a figure is dressed from. */
export const skin = '#d9a877';
export const shirts = ['#557f79', '#7b7895', '#b38b57', '#63819b'] as const;

/** What a resident's claim was: one tone and one mark per kind, so it never rests on colour alone. `wish` takes the
 *  accent because a wish is what becomes a request. */
export const claimTone = {
  good: { mark: '＋', label: '좋았던 점', color: '#8fbf8a' },
  bad: { mark: '－', label: '불편했던 점', color: '#e08a6a' },
  neutral: { mark: '○', label: '어느 쪽도 아님', color: 'rgba(246, 241, 232, 0.66)' },
  unknown: { mark: '？', label: '알 수 없었던 점', color: '#8fa9c4' },
  wish: { mark: '→', label: '고치고 싶은 점', color: '#e2542c' },
} as const;

/** How a request moved a resident's trouble: one tone and one mark per way, as with claims. */
export const changeTone = {
  resolved: { mark: '✓', label: '풀린 불편', color: claimTone.good.color },
  remaining: { mark: '＝', label: '남은 불편', color: night.warn },
  new: { mark: '！', label: '새로 생긴 불편', color: claimTone.bad.color },
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

/** The font sizes in use, and no other: a caption, the reading size, a lead, a title, a heading, a display and a
 *  hero. Through `px`, so a wall screen reads them bigger. */
export const type = {
  caption: px(12),
  body: px(16),
  lead: px(20),
  title: px(24),
  heading: px(28),
  display: px(32),
  hero: px(48),
} as const;

/** The scale every gap, padding and margin on the reading pages is picked from.
 *  Named steps, not numbers, so two pages that mean "a little" or "a section apart"
 *  cannot drift to 14 and 16. Each goes through the type scale (`px`). */
export const space = {
  /** A hairline gap, between two things that touch (a row of pins). */
  hair: px(2),
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
/** White at an opacity: a name tag set on a picture. */
export const whiteA = (a: number) => `rgba(255, 255, 255, ${a})`;
/** The same for the night ground's own blacks: the opening film's ground (`night.deep`), the panel and the ground. */
export const deepA = (a: number) => `rgba(21, 21, 15, ${a})`;
export const panelA = (a: number) => `rgba(27, 28, 24, ${a})`;
export const groundA = (a: number) => `rgba(18, 19, 16, ${a})`;
