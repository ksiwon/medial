import { createGlobalStyle } from 'styled-components';
import { font, color } from './tokens';

export const GlobalStyle = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');

  @font-face {
    font-family: 'Pretendard';
    font-weight: 400;
    src: url('/fonts/Pretendard-Regular.otf') format('opentype');
  }
  @font-face {
    font-family: 'Pretendard';
    font-weight: 500;
    src: url('/fonts/Pretendard-Medium.otf') format('opentype');
  }
  @font-face {
    font-family: 'Pretendard';
    font-weight: 600;
    src: url('/fonts/Pretendard-SemiBold.otf') format('opentype');
  }
  @font-face {
    font-family: 'Pretendard';
    font-weight: 700;
    src: url('/fonts/Pretendard-Bold.otf') format('opentype');
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-family: ${font.family};
    font-size: 15px;
    background: #EBE4D9;
    color: ${color.white};
  }

  body {
    min-height: 100vh;
    overflow: hidden;
    /* 한국어 단어 중간 줄바꿈 방지 (가독성·노인 접근성) */
    word-break: keep-all;
    overflow-wrap: break-word;
  }

  button {
    font-family: ${font.family};
    cursor: pointer;
    border: none;
    background: none;
  }

  /* WCAG 2.4.7 Focus Visible — 키보드 포커스 시 명확한 링.
     마우스 클릭에는 보이지 않게(focus-visible only). 어르신 보조 기기 사용 고려. */
  *:focus { outline: none; }
  button:focus-visible,
  a:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  [role="button"]:focus-visible,
  [role="switch"]:focus-visible,
  [role="tab"]:focus-visible {
    outline: 3px solid ${color.sage[400]};
    outline-offset: 2px;
    border-radius: 4px;
  }

  input, select {
    font-family: ${font.family};
  }

  .mono {
    font-family: ${font.mono};
  }

  * {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* 사용자 'reduce motion' 환경설정 존중 (P7·WCAG SC 2.3.3).
     상태 전달용 페이드는 살리되 무한 펄스·할로·waveBar의 강도는 낮춘다. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.06s !important;
      scroll-behavior: auto !important;
    }
  }

  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(54,99,72,0.25); border-radius: 1px; }
`;
