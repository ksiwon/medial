// src/screens/HomeScreen.tsx
import { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { MicIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

/* ── 애니메이션 ───────────────────────────────────────── */
const ripple = keyframes`
  0%   { transform: scale(1);   opacity: 0.5; }
  100% { transform: scale(2.6); opacity: 0; }
`;

const recPulse = keyframes`
  0%, 100% { transform: scale(1);    opacity: 1; }
  50%       { transform: scale(1.08); opacity: 0.7; }
`;

const recRipple = keyframes`
  0%   { transform: scale(1);   opacity: 0.4; }
  100% { transform: scale(2.8); opacity: 0; }
`;

const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
`;

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ── 레이아웃 ─────────────────────────────────────────── */
const Screen = styled.div`
  min-height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  padding: 14px 16px 12px;
  border-bottom: ${border.thin};
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
`;

const LogoText = styled.div`
  font-size: 15px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[700]};
  letter-spacing: -0.01em;
`;

const LogoSub = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  margin-top: 1px;
`;

const PatientChip = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px 5px 5px;
  border: ${border.mid};
  border-radius: ${radius.xxl};
  background: ${color.white};
`;

const InitialCircle = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: ${color.sage[600]};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: ${font.weight.bold};
  color: white;
  flex-shrink: 0;
`;

const PatientName = styled.div`
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  line-height: 1.2;
`;

const PatientMeta = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
`;

/* ── 보이스 영역 ──────────────────────────────────────── */
const VoiceZone = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 20px 10px;
`;

const DayLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[500]};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 8px;
`;

const GreetingText = styled.p`
  font-size: 19px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
  text-align: center;
  line-height: 1.35;
  margin-bottom: 4px;
`;

const SubText = styled.p<{ $recording?: boolean }>`
  font-size: ${font.size.appMd};
  color: ${({ $recording }) => $recording ? color.terra.base : color.ink[300]};
  text-align: center;
  line-height: 1.6;
  margin-bottom: 18px;
  transition: color 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
`;

const RecDot = styled.div`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${color.terra.base};
  animation: ${dotBlink} 0.9s ease-in-out infinite;
`;

/* ── 마이크 버튼 ──────────────────────────────────────── */
const MicArea = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;
  margin-bottom: 8px;
`;

const Ripple = styled.div<{ $delay: string; $recording?: boolean }>`
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 1.5px solid ${({ $recording }) => $recording ? color.terra.mid : color.sage[400]};
  animation: ${({ $recording }) => $recording ? recRipple : ripple} 2.2s ease-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

const MicBtn = styled.button<{ $recording?: boolean }>`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: ${({ $recording }) => $recording ? color.terra.base : color.sage[600]};
  border: 3px solid ${({ $recording }) => $recording ? color.terra.dark : color.sage[700]};
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 2;
  cursor: pointer;
  transition: background 0.25s, border-color 0.25s, transform 0.08s;
  box-shadow: 0 4px 14px ${({ $recording }) => $recording
    ? 'rgba(176,48,32,0.32)'
    : 'rgba(54,99,72,0.28)'};
  animation: ${({ $recording }) => $recording ? recPulse : 'none'} 1s ease-in-out infinite;

  &:active {
    transform: scale(0.93);
  }
`;

const MicLabel = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  text-align: center;
  margin-bottom: 14px;
`;

const ModalBadges = styled.div`
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: center;
`;

const Badge = styled.div`
  font-size: 10px;
  color: ${color.sage[600]};
  border: ${border.thin};
  border-radius: ${radius.md};
  padding: 3px 8px;
  background: ${color.cream.base};
  font-weight: ${font.weight.medium};
`;

/* ── 이전 대화 기록 ──────────────────────────────────── */
const HistorySection = styled.div`
  flex-shrink: 0;
  border-top: 2px solid ${color.cream.mid};
  display: flex;
  flex-direction: column;
`;

const HistoryHead = styled.div`
  padding: 10px 16px 6px;
`;

const HistoryLabel = styled.span`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[300]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const ConvList = styled.div`
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ConvItem = styled.button<{ $urgent: boolean }>`
  width: 100%;
  text-align: left;
  padding: 8px 11px;
  border-radius: ${radius.lg};
  background: ${color.white};
  border: ${border.thin};
  border-left: 3px solid ${({ $urgent }) => $urgent ? color.terra.base : color.sage[300]};
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  transition: background 0.1s;
  animation: ${fadeUp} 0.25s ease both;

  &:active { background: ${color.cream.base}; }
`;

const ConvTitle = styled.div`
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ConvSub = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  white-space: nowrap;
`;

const ConvDate = styled.div`
  font-size: 10px;
  color: ${color.ink[100]};
  flex-shrink: 0;
`;

const UrgentDot = styled.div`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${color.terra.base};
  flex-shrink: 0;
`;

/* ── 컴포넌트 ─────────────────────────────────────────── */
export default function HomeScreen() {
  const { getCurrentCase, setCurrentScreen, startFromConversation } = useAppStore();
  const caseData = getCurrentCase();
  const { patient, prevConversations } = caseData;

  const [recording, setRecording] = useState(false);

  const handleMicPress = () => {
    if (recording) return;
    setRecording(true);
    // 1.6초 후 chat 화면으로 — 환자 목소리로 시작
    setTimeout(() => {
      useAppStore.getState().resetDialogue();
      setCurrentScreen('chat');
    }, 1600);
  };

  return (
    <Screen>
      <Header>
        <div>
          <LogoText>MEDial</LogoText>
          <LogoSub>AI 의료 문진 서비스</LogoSub>
        </div>
        <PatientChip>
          <InitialCircle>{patient.name.slice(0, 1)}</InitialCircle>
          <div>
            <PatientName>{patient.name} 님</PatientName>
            <PatientMeta>{patient.age}세 · {patient.sessionCount}회 상담</PatientMeta>
          </div>
        </PatientChip>
      </Header>

      <VoiceZone>
        <DayLabel>오늘의 문진</DayLabel>

        {recording ? (
          <GreetingText>말씀해 주세요</GreetingText>
        ) : (
          <GreetingText>어떻게 오셨어요?</GreetingText>
        )}

        <SubText $recording={recording}>
          {recording ? (
            <>
              <RecDot />
              듣고 있어요...
            </>
          ) : (
            '목소리로 말씀해 주시면\nMEDial이 먼저 들을게요'
          )}
        </SubText>

        <MicArea>
          <Ripple $delay="0s"     $recording={recording} />
          <Ripple $delay="0.9s"   $recording={recording} />
          <MicBtn
            $recording={recording}
            onClick={handleMicPress}
            aria-label={recording ? '녹음 중' : '음성 상담 시작'}
          >
            <MicIcon size={28} color="white" />
          </MicBtn>
        </MicArea>

        {!recording && (
          <>
            <MicLabel>마이크를 눌러 상담을 시작하세요</MicLabel>
            <ModalBadges>
              <Badge>음성 분석</Badge>
              <Badge>상처 촬영</Badge>
              <Badge>약 봉투 스캔</Badge>
              <Badge>표정 인식</Badge>
            </ModalBadges>
          </>
        )}
      </VoiceZone>

      <HistorySection>
        <HistoryHead>
          <HistoryLabel>이전 대화 기록</HistoryLabel>
        </HistoryHead>
        <ConvList>
          {prevConversations.map((conv, i) => (
            <ConvItem
              key={i}
              $urgent={conv.urgent}
              onClick={() => startFromConversation(i)}
              style={{ animationDelay: `${i * 0.07}s` }}
            >
              {conv.urgent && <UrgentDot />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <ConvTitle>{conv.title}</ConvTitle>
                <ConvSub>{conv.subtitle}</ConvSub>
              </div>
              <ConvDate>{conv.date}</ConvDate>
            </ConvItem>
          ))}
        </ConvList>
      </HistorySection>
    </Screen>
  );
}
