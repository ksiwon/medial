import { createGlobalStyle } from 'styled-components';
import { font, color } from './tokens';

export const GlobalStyle = createGlobalStyle`
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
  }

  button {
    font-family: ${font.family};
    cursor: pointer;
    border: none;
    background: none;
  }

  input {
    font-family: ${font.family};
  }

  * {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* 스크롤바 글로벌 */
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(54,99,72,0.25); border-radius: 1px; }
`;
