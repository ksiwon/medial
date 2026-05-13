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
    light: '#F7F3EC',   // warm off-white — main bg
  },
  terra: {
    dark:  '#7A2618',
    base:  '#B03020',   // warning red
    mid:   '#CC5040',
    pale:  '#EDD8D4',
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
};

export const font = {
  family: "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
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

// Deliberate small radii — avoids "pill" LLM aesthetic
export const radius = {
  sm:  '2px',
  md:  '4px',
  lg:  '6px',
  xl:  '8px',
  xxl: '12px',
  round: '50%',
};

export const border = {
  thin:   `1px solid rgba(54,99,72,0.14)`,
  mid:    `1px solid rgba(54,99,72,0.24)`,
  strong: `1.5px solid rgba(54,99,72,0.38)`,
  rule:   `1px solid rgba(54,99,72,0.10)`,
};
