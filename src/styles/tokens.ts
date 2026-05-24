// src/styles/tokens.ts

export const color = {
  sage: {
    900: '#192B20',
    800: '#21392C',
    700: '#2B4D3A',
    600: '#366348',
    500: '#447A5A',
    400: '#5E9470',
    300: '#89B59A',
    200: '#B5D2BF',
    100: '#D8EBE1',
    50:  '#EDF5F0',
  },
  cream: {
    dark:  '#D4CBB8',
    mid:   '#E8DFD0',
    base:  '#F2EBE0',
    light: '#F7F3EC',
  },
  terra: {
    dark:  '#7A2618',
    base:  '#B03020',
    mid:   '#CC5040',
    pale:  '#EDD8D4',
  },
  amber: {
    dark:  '#8C6120',
    base:  '#B5853E',
    mid:   '#D4A055',
    pale:  '#FDF3D0',
    dim:   '#FBE8B8',
  },
  ink: {
    900: '#0F1A12',
    700: '#243320',
    500: '#47604A',
    300: '#7A9480',
    100: '#B2C8B8',
  },
  white: '#FFFFFF',
  emergency: '#AA1F10',
  emergencyDim: '#F0DDD9',
  healthBlue: '#1D5296',
  healthBlueDim: '#D6E5F5',
  yellow: '#D4960A',
  yellowDim: '#FDF3D6',

  // ── MEDial 3.0: AA 통과 텍스트 색 (cream/white 위 4.5:1+) ──
  // 기존 ink[300](#7A9480)은 본문 대비 미달 → 본문/보조엔 아래를 사용.
  text: {
    strong: '#16241A',   // 제목/강조 (cream 위 ~13:1)
    body:   '#2B3F30',   // 본문 (cream 위 ~9:1)
    muted:  '#4C6151',   // 보조 (cream 위 ~5.4:1, AA 통과)
    onDark: '#FFFFFF',
    onDarkMuted: 'rgba(255,255,255,0.82)',
  },
  // ── 의미(semantic) 역할색 — 위계를 색으로 ──
  role: {
    positive:    '#2B4D3A',  // 평상/긍정 (sage 700)
    positiveBg:  '#D8EBE1',
    info:        '#1A4E8F',  // 정보·소식·영상 (AA on white)
    infoBg:      '#D6E5F5',
    warn:        '#8C6120',  // 주의(경계 신호)
    warnBg:      '#FDF3D0',
    danger:      '#AA1F10',  // 응급
    dangerBg:    '#F0DDD9',
  },
};

export const font = {
  family: "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
  mono:   "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
  weight: {
    regular: 400,
    medium: 500,
    semiBold: 600,
    bold: 700,
  },
  size: {
    appXs:  '10px',
    appSm:  '11px',
    appMd:  '13px',
    appLg:  '16px',
    appXl:  '20px',
    appXxl: '24px',
    label:  '10px',
    body:   '13px',
    title:  '20px',
  },
};

/**
 * MEDial 3.0 고령자 타입 스케일 (px). companion(어르신) 화면 전용.
 * 전역 글자 확대: CSS 변수 `--ts`(1 / 1.15 / 1.3)를 곱해 적용한다.
 * 사용: font-size: ${ts(17)};  → calc(17px * var(--ts, 1))
 * 근거: WCAG 본문 + 노인 가독(16pt+), 시야 30–50cm.
 */
export const typeScale = {
  caption:  15,
  body:     17,
  bodyLg:   19,
  title:    24,
  headline: 30,
  display:  38,
} as const;

/** 전역 글자 확대 변수를 곱한 font-size 문자열 */
export const ts = (px: number): string => `calc(${px}px * var(--ts, 1))`;

/** 최소 터치 타깃(px) — WCAG 2.2 SC2.5.8(24px) + 노화 운동저하 가산 */
export const touch = { min: 48, gap: 8 } as const;

export const space = {
  2:  '2px',
  4:  '4px',
  6:  '6px',
  8:  '8px',
  10: '10px',
  12: '12px',
  14: '14px',
  16: '16px',
  20: '20px',
  24: '24px',
  28: '28px',
  32: '32px',
};

export const radius = {
  sm:       '2px',
  md:       '4px',
  lg:       '6px',
  xl:       '8px',
  xxl:      '12px',
  portrait: '14px',
  mic:      '18px',
  round:    '50%',
};

export const border = {
  thin:   `1px solid rgba(54,99,72,0.14)`,
  mid:    `1px solid rgba(54,99,72,0.24)`,
  strong: `1.5px solid rgba(54,99,72,0.38)`,
  rule:   `1px solid rgba(54,99,72,0.10)`,
  amber:  `1.5px solid rgba(181,133,62,0.55)`,
};

export const shadow = {
  cta:     '0 2px 6px rgba(0,0,0,0.14)',
  terra:   '0 2px 6px rgba(176,48,32,0.20)',
  waxSeal: '0 2px 6px rgba(197,86,61,0.18)',
  card:    '0 1px 4px rgba(0,0,0,0.08)',
  float:   '0 4px 16px rgba(0,0,0,0.10)',
};
