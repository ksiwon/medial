// src/App.tsx
import { useEffect } from 'react';
import styled from 'styled-components';
import { GlobalStyle } from './styles/GlobalStyle';
import TitleBar from './components/layout/TitleBar';
import PhoneFrame from './components/layout/PhoneFrame';
import DescPanel from './components/layout/DescPanel';
import DashboardPanel from './components/layout/DashboardPanel';
import TweaksPanel from './components/layout/TweaksPanel';
import { useAppStore } from './store/useAppStore';
import { screenDescriptions } from './data/mockData';

// Mock screens
import HomeScreen from './screens/HomeScreen';
import ChatScreen from './screens/ChatScreen';
import AnalyzingScreen from './screens/AnalyzingScreen';
import PhotoScreen from './screens/PhotoScreen';
import DecisionScreen from './screens/DecisionScreen';
import EmergencyScreen from './screens/EmergencyScreen';
import HealthCenterScreen from './screens/HealthCenterScreen';
import SelfCareScreen from './screens/SelfCareScreen';
import ReportScreen from './screens/ReportScreen';

// Live screens
import LiveIdleScreen from './screens/live/LiveIdleScreen';
import LiveChatScreen from './screens/live/LiveChatScreen';
import LiveEmergencyScreen from './screens/live/LiveEmergencyScreen';
import LiveReportScreen from './screens/live/LiveReportScreen';
import LiveCompleteScreen from './screens/live/LiveCompleteScreen';

// Companion (MEDial 2.0)
import CompanionShell from './screens/companion/CompanionShell';
import { CompanionProvider } from './components/companion/CompanionContext';
import HealthPanel from './components/companion/HealthPanel';

import { ScreenId, LiveScreenId } from './types';

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

function renderMockScreen(screen: ScreenId) {
  switch (screen) {
    case 'home':         return <HomeScreen />;
    case 'chat':         return <ChatScreen />;
    case 'analyzing':    return <AnalyzingScreen />;
    case 'photo':        return <PhotoScreen />;
    case 'decision':     return <DecisionScreen />;
    case 'emergency':    return <EmergencyScreen />;
    case 'healthCenter': return <HealthCenterScreen />;
    case 'selfCare':     return <SelfCareScreen />;
    case 'report':       return <ReportScreen />;
  }
}

function renderLiveScreen(screen: LiveScreenId) {
  switch (screen) {
    case 'live-idle':      return <LiveIdleScreen />;
    case 'live-chat':      return <LiveChatScreen />;
    case 'live-emergency': return <LiveEmergencyScreen />;
    case 'live-report':    return <LiveReportScreen />;
    case 'live-complete':  return <LiveCompleteScreen />;
  }
}

export default function App() {
  const { currentScreen, fontScale, appMode, liveScreen } = useAppStore();

  useEffect(() => {
    document.documentElement.style.fontSize = `${15 * fontScale}px`;
  }, [fontScale]);

  const descData =
    screenDescriptions.find((d) => d.screenId === currentScreen) ??
    screenDescriptions.find((d) => d.screenId === 'chat')!;

  return (
    <>
      <GlobalStyle />
      <Root>
        <TitleBar currentScreen={currentScreen} />
        <Main>
          {appMode === 'companion' ? (
            <CompanionProvider>
              <PhoneFrame><CompanionShell /></PhoneFrame>
              <HealthPanel />
            </CompanionProvider>
          ) : (
            <>
              <PhoneFrame>
                {appMode === 'live'
                  ? renderLiveScreen(liveScreen)
                  : renderMockScreen(currentScreen)}
              </PhoneFrame>
              {appMode === 'live'
                ? <DashboardPanel />
                : <DescPanel screen={descData} />}
            </>
          )}

          {/* 개발/연구 컨트롤은 데모 화면을 어지럽히지 않도록 companion(제품)에선 숨김 */}
          {appMode !== 'companion' && <TweaksPanel />}
        </Main>
      </Root>
    </>
  );
}
