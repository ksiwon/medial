// src/App.tsx
import { useEffect } from 'react';
import styled from 'styled-components';
import { GlobalStyle } from './styles/GlobalStyle';
import TitleBar from './components/layout/TitleBar';
import PhoneFrame from './components/layout/PhoneFrame';
import TweaksPanel from './components/layout/TweaksPanel';
import { useAppStore } from './store/useAppStore';

// Companion (MEDial 3.0) — 유일 제품. Mock/Live 아카이브는 제거됨(git 히스토리 참조).
import CompanionShell from './screens/companion/CompanionShell';
import { CompanionProvider } from './components/companion/CompanionContext';
import HealthPanel from './components/companion/HealthPanel';

const Root = styled.div`
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #EBE4D9;
  overflow: hidden;
`;

const Main = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

// 발표 모드에서는 폰 목업이 가운데 정렬되어 화면이 깔끔.
const CenterStage = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

// 발표 모드 토글 힌트 (우하단). 발표 중 본인만 보는 미세한 가이드.
const PresentationToast = styled.div`
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 50;
  font-size: 10.5px;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.06em;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0,0,0,0.55);
  color: rgba(255,255,255,0.78);
  pointer-events: none;
  opacity: 0;
  animation: toastFade 2.6s ease forwards;
  @keyframes toastFade {
    0%   { opacity: 0; transform: translateY(6px); }
    15%  { opacity: 1; transform: translateY(0); }
    80%  { opacity: 1; }
    100% { opacity: 0; transform: translateY(-2px); }
  }
`;

export default function App() {
  const { fontScale, presentationMode, togglePresentationMode } = useAppStore();

  useEffect(() => {
    document.documentElement.style.fontSize = `${15 * fontScale}px`;
  }, [fontScale]);

  // 'D' 키로 발표 모드 ↔ 연구자 뷰 토글. 입력 필드에 포커스되어 있을 땐 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      togglePresentationMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePresentationMode]);

  // 발표 모드: 폰 목업만 가운데 정렬. 연구자 모드: 폰 + 우측 HealthPanel + TweaksPanel.
  return (
    <>
      <GlobalStyle />
      <Root>
        <TitleBar />
        <Main>
          <CompanionProvider>
            {presentationMode ? (
              <CenterStage>
                <PhoneFrame><CompanionShell /></PhoneFrame>
              </CenterStage>
            ) : (
              <>
                <PhoneFrame><CompanionShell /></PhoneFrame>
                <HealthPanel />
                <TweaksPanel />
              </>
            )}
          </CompanionProvider>
        </Main>

        {/* 발표 모드 진입/해제 시 잠깐 떠올라 사라지는 안내 (본인 확인용) */}
        <PresentationToast key={presentationMode ? 'on' : 'off'}>
          {presentationMode ? '발표 모드' : '연구자 모드'} · D로 전환
        </PresentationToast>
      </Root>
    </>
  );
}
