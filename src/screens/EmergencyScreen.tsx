// src/screens/EmergencyScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { PhoneIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const pulse = keyframes`
  0%   { transform: scale(0.95); opacity: 0.8; }
  50%  { transform: scale(1.1);  opacity: 0.4; }
  100% { transform: scale(0.95); opacity: 0.8; }
`;

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
`;

const Screen = styled.div`
  min-height: 100%;
  background: ${color.emergency};
  display: flex;
  flex-direction: column;
  overflow-y: auto;
`;

const TopSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 18px;
  gap: 12px;
  flex-shrink: 0;
`;

const IconRing = styled.div`
  position: relative;
  width: 84px;
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const PulseCircle = styled.div`
  position: absolute;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  animation: ${pulse} 1.6s ease-in-out infinite;
`;

const PhoneCircle = styled.div`
  width: 66px;
  height: 66px;
  border-radius: 50%;
  background: rgba(255,255,255,0.18);
  border: 2px solid rgba(255,255,255,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
`;

const BlinkDot = styled.div`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: white;
  animation: ${blink} 1s ease-in-out infinite;
`;

const StatusText = styled.div`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: rgba(255,255,255,0.9);
`;

const Title = styled.h2`
  font-size: 20px;
  font-weight: ${font.weight.bold};
  color: white;
  text-align: center;
  line-height: 1.3;
`;

/* 환자 정보 카드 */
const PatientCard = styled.div`
  margin: 0 14px;
  padding: 14px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: ${radius.xl};
`;

const CardLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: rgba(255,255,255,0.55);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 10px;
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
  font-size: ${font.size.appMd};
  color: rgba(255,255,255,0.5);
`;

const InfoVal = styled.span`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: white;
  text-align: right;
  max-width: 60%;
`;

const SympRow = styled.div`
  margin: 10px 14px;
  padding: 12px 14px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: ${radius.xl};
`;

const SympLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
`;

const SympText = styled.div`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.medium};
  color: white;
  line-height: 1.5;
`;

const BackBtn = styled.button`
  margin: 14px 14px 20px;
  padding: 11px;
  border-radius: ${radius.lg};
  border: 1px solid rgba(255,255,255,0.3);
  background: transparent;
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.medium};
  color: rgba(255,255,255,0.7);
  width: calc(100% - 28px);
  transition: background 0.1s;

  &:active { background: rgba(255,255,255,0.08); }
`;

export default function EmergencyScreen() {
  const { getCurrentCase, setCurrentScreen } = useAppStore();
  const caseData = getCurrentCase();
  const { patient } = caseData;

  return (
    <Screen>
      <TopSection>
        <IconRing>
          <PulseCircle />
          <PhoneCircle><PhoneIcon size={30} color="white" /></PhoneCircle>
        </IconRing>
        <StatusRow>
          <BlinkDot />
          <StatusText>119에 연락 중...</StatusText>
        </StatusRow>
        <Title>구급대원이 오고 있어요</Title>
      </TopSection>

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

      <SympRow>
        <SympLabel>현재 증상</SympLabel>
        <SympText>{caseData.reportData.todaySummary[0]}</SympText>
      </SympRow>

      <BackBtn onClick={() => setCurrentScreen('decision')}>← 돌아가기</BackBtn>
    </Screen>
  );
}
