// src/App.tsx
import styled from 'styled-components';
import { GlobalStyle } from './styles/GlobalStyle';
import TitleBar from './components/layout/TitleBar';
import PhoneFrame from './components/layout/PhoneFrame';
import DescPanel from './components/layout/DescPanel';
import TweaksPanel from './components/layout/TweaksPanel';
import { useAppStore } from './store/useAppStore';
import { screenDescriptions } from './data/mockData';

// Screens
import HomeScreen from './screens/HomeScreen';
import ChatScreen from './screens/ChatScreen';
import PhotoScreen from './screens/PhotoScreen';
import DecisionScreen from './screens/DecisionScreen';
import EmergencyScreen from './screens/EmergencyScreen';
import HealthCenterScreen from './screens/HealthCenterScreen';
import SelfCareScreen from './screens/SelfCareScreen';
import ReportScreen from './screens/ReportScreen';

import { ScreenId } from './types';

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

function renderScreen(screen: ScreenId) {
  switch (screen) {
    case 'home': return <HomeScreen />;
    case 'chat': return <ChatScreen />;
    case 'photo': return <PhotoScreen />;
    case 'decision': return <DecisionScreen />;
    case 'emergency': return <EmergencyScreen />;
    case 'healthCenter': return <HealthCenterScreen />;
    case 'selfCare': return <SelfCareScreen />;
    case 'report': return <ReportScreen />;
  }
}

export default function App() {
  const { currentScreen } = useAppStore();

  const descData = screenDescriptions.find((d) => d.screenId === currentScreen)!;

  return (
    <>
      <GlobalStyle />
      <Root>
        <TitleBar currentScreen={currentScreen} />
        <Main>
          <PhoneFrame>
            {renderScreen(currentScreen)}
          </PhoneFrame>
          <DescPanel screen={descData} />
          <TweaksPanel />
        </Main>
      </Root>
    </>
  );
}
