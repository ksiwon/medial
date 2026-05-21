// src/screens/EmergencyScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border, shadow } from '../styles/tokens';
import { PhoneIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';
import VirtualDoctor from '../components/phone/VirtualDoctor';

const pulse = keyframes`
  0%   { transform: scale(0.95); opacity: 0.7; }
  50%  { transform: scale(1.18); opacity: 0.25; }
  100% { transform: scale(0.95); opacity: 0.7; }
`;

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
`;

const Screen = styled.div`
  height: 100%;
  background: ${color.emergency};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

/* ── top content area ── */
const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 16px 12px;
  gap: 14px;
  overflow-y: auto;
  &::-webkit-scrollbar { display: none; }
`;

const IconRing = styled.div`
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const PulseRing = styled.div<{ $delay?: string }>`
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  animation: ${pulse} 1.8s ease-in-out infinite;
  animation-delay: ${({ $delay }) => $delay ?? '0s'};
`;

const PhoneCircle = styled.div`
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: rgba(255,255,255,0.16);
  border: 2px solid rgba(255,255,255,0.40);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  box-shadow: ${shadow.terra};
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
`;

const BlinkDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: white;
  animation: ${blink} 1s ease-in-out infinite;
`;

const StatusText = styled.div`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: rgba(255,255,255,0.88);
  letter-spacing: 0.02em;
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: ${font.weight.bold};
  color: white;
  text-align: center;
  line-height: 1.35;
  margin: 0;
`;

/* ── patient card ── */
const PatientCard = styled.div`
  width: 100%;
  padding: 13px 14px;
  background: rgba(255,255,255,0.11);
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: ${radius.xxl};
  backdrop-filter: blur(4px);
`;

const CardLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 9px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  &:last-child { border-bottom: none; }
`;

const InfoKey = styled.span`
  font-size: ${font.size.appSm};
  color: rgba(255,255,255,0.5);
`;

const InfoVal = styled.span`
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.semiBold};
  color: white;
  text-align: right;
  max-width: 62%;
`;

/* ── symptom row ── */
const SympCard = styled.div`
  width: 100%;
  padding: 11px 14px;
  background: rgba(255,255,255,0.09);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: ${radius.xxl};
`;

const SympLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 5px;
`;

const SympText = styled.div`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.medium};
  color: white;
  line-height: 1.5;
`;

/* ── back button ── */
const BackBtn = styled.button`
  width: 100%;
  padding: 10px;
  border-radius: ${radius.xl};
  border: 1px solid rgba(255,255,255,0.25);
  background: transparent;
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.medium};
  color: rgba(255,255,255,0.65);
  transition: background 0.12s;
  &:active { background: rgba(255,255,255,0.08); }
`;

/* ── doctor panel (bottom) ── */
const DoctorPanel = styled.div`
  flex: 0 0 auto;
  background: rgba(0,0,0,0.20);
  border-top: 1px solid rgba(255,255,255,0.12);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 16px 6px;
  gap: 12px;
`;

const DoctorSpeech = styled.div`
  flex: 1;
  padding: 10px 12px;
  background: rgba(255,255,255,0.10);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 10px 10px 10px 2px;
  margin-bottom: 20px;
  font-size: ${font.size.appMd};
  color: rgba(255,255,255,0.92);
  line-height: 1.5;
`;

export default function EmergencyScreen() {
  const { getCurrentCase, setCurrentScreen } = useAppStore();
  const caseData = getCurrentCase();
  const { patient } = caseData;

  return (
    <Screen>
      <ContentArea>
        <IconRing>
          <PulseRing />
          <PulseRing $delay="0.6s" />
          <PhoneCircle><PhoneIcon size={28} color="white" /></PhoneCircle>
        </IconRing>

        <StatusRow>
          <BlinkDot />
          <StatusText>119에 연락 중...</StatusText>
        </StatusRow>

        <Title>구급대원이{'\n'}오고 있어요</Title>

        <PatientCard>
          <CardLabel>구급대원에게 보여주세요</CardLabel>
          <InfoRow>
            <InfoKey>이름</InfoKey>
            <InfoVal>{patient.name} ({patient.age}세 {patient.gender})</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>혈액형</InfoKey>
            <InfoVal>{patient.bloodType}</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>기저질환</InfoKey>
            <InfoVal>{patient.conditions.join(', ')}</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>알레르기</InfoKey>
            <InfoVal>{patient.allergies.join(', ')}</InfoVal>
          </InfoRow>
        </PatientCard>

        <SympCard>
          <SympLabel>현재 증상</SympLabel>
          <SympText>{caseData.reportData.todaySummary[0]}</SympText>
        </SympCard>

        <BackBtn onClick={() => setCurrentScreen('decision')}>← 판단으로 돌아가기</BackBtn>
      </ContentArea>

      <DoctorPanel>
        <VirtualDoctor state="emergency" size={80} />
        <DoctorSpeech>
          걱정 마세요. 구급대원이 곧 도착합니다. 환자 정보를 화면에 띄워 두세요.
        </DoctorSpeech>
      </DoctorPanel>
    </Screen>
  );
}
