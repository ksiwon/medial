// src/screens/live/LiveEmergencyScreen.tsx — SCREEN 04-E (Emergency 119)
import styled, { keyframes } from 'styled-components';
import { color, font } from '../../styles/tokens';
import VirtualDoctor from '../../components/phone/VirtualDoctor';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../hooks/useWebSocket';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.6; }
`;

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #FFF5F4;
  overflow: hidden;
`;

const RedBanner = styled.div`
  flex-shrink: 0;
  width: 100%;
  background: ${color.emergency};
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const BannerDot = styled.div`
  width: 8px; height: 8px;
  border-radius: 50%;
  background: white;
  animation: ${pulse} 0.7s ease-in-out infinite;
`;

const BannerText = styled.div`
  font-size: 11.5px;
  font-weight: ${font.weight.bold};
  color: white;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 20px;
  gap: 14px;
  animation: ${fadeUp} 0.3s ease both;
`;

const AvatarWrap = styled.div`
  filter: drop-shadow(0 0 16px rgba(176,28,28,0.25));
`;

const Heading = styled.div`
  font-size: 20px;
  font-weight: ${font.weight.bold};
  color: ${color.emergency};
  text-align: center;
  line-height: 1.3;
`;

const Sub = styled.div`
  font-size: 13px;
  color: #6B2020;
  text-align: center;
  line-height: 1.6;
`;

const CallBtn = styled.a`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 16px;
  background: ${color.emergency};
  border-radius: 14px;
  font-size: 18px;
  font-weight: ${font.weight.bold};
  color: white;
  text-decoration: none;
  animation: ${pulse} 1.2s ease-in-out infinite;
  box-shadow: 0 4px 16px rgba(176,28,28,0.35);
`;

const ResetBtn = styled.button`
  font-size: 11px;
  color: #C07070;
  text-decoration: underline;
  text-underline-offset: 2px;
  margin-top: 4px;
`;

export default function LiveEmergencyScreen() {
  const { resetLiveSession } = useAppStore();
  const { reset } = useWebSocket();

  const handleReset = () => {
    reset();
    resetLiveSession();
    useAppStore.getState().setLiveScreen('live-idle');
  };

  return (
    <Screen>
      <RedBanner>
        <BannerDot />
        <BannerText>응급 상황 감지됨</BannerText>
      </RedBanner>

      <Body>
        <AvatarWrap>
          <VirtualDoctor state="emergency" size={72} showHalo={false} />
        </AvatarWrap>

        <Heading>지금 바로<br />119에 전화하세요</Heading>

        <Sub>
          말씀하신 증상이 응급일 수 있어요.<br />
          즉시 119에 연락해 주세요.<br />
          <strong style={{ color: color.emergency }}>절대 혼자 이동하지 마세요.</strong>
        </Sub>

        <CallBtn href="tel:119">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M4 4a2 2 0 0 1 2-2h2.5a1 1 0 0 1 .97.757l1 4A1 1 0 0 1 9.9 7.9L8.3 9.5a12 12 0 0 0 4.2 4.2l1.6-1.6a1 1 0 0 1 1.143-.17l4 1A1 1 0 0 1 20 14v2.5a2 2 0 0 1-2 2C8.059 18.5 3.5 13.941 3.5 8 3.5 5.82 3.73 4 4 4Z" fill="white"/>
          </svg>
          119 전화
        </CallBtn>

        <ResetBtn onClick={handleReset}>연구자 초기화</ResetBtn>
      </Body>
    </Screen>
  );
}
