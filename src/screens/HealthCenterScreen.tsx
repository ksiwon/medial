// src/screens/HealthCenterScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, border, shadow } from '../styles/tokens';
import { useAppStore } from '../store/useAppStore';
import VirtualDoctor from '../components/phone/VirtualDoctor';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
`;

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
`;

const checkDraw = keyframes`
  from { stroke-dashoffset: 60; }
  to   { stroke-dashoffset: 0; }
`;

/* ── 레이아웃 ─────────────────────────────────── */
const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.cream.light};
  overflow: hidden;
`;

const TopLabel = styled.div`
  flex-shrink: 0;
  padding: 7px 14px;
  border-bottom: 1px solid ${color.cream.dark};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const TopText = styled.div`
  font-family: ${font.mono};
  font-size: 9.5px;
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  flex: 1;
`;

const ConnectedDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${color.sage[400]};
  animation: ${blink} 1.5s ease-in-out infinite;
`;

const ConnectedLabel = styled.div`
  font-size: 10px;
  color: ${color.sage[500]};
  font-weight: ${font.weight.semiBold};
`;

/* ── 스크롤 바디 ──────────────────────────────── */
const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(54,99,72,0.18); }
`;

/* ── 확인 아이콘 카드 ──────────────────────────── */
const ConfirmCard = styled.div`
  background: ${color.healthBlueDim};
  border: 1.5px solid ${color.healthBlue};
  border-radius: 12px;
  padding: 16px 14px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  animation: ${fadeIn} 0.4s ease both;
`;

const ConfirmCircle = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: ${color.healthBlue};
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 10px rgba(29,82,150,0.28);
`;

const CheckSvg = styled.svg`
  path {
    stroke-dasharray: 60;
    stroke-dashoffset: 0;
    animation: ${checkDraw} 0.6s ease 0.3s both;
  }
`;

const ConfirmTitle = styled.div`
  font-size: 15px;
  font-weight: ${font.weight.bold};
  color: ${color.healthBlue};
  text-align: center;
`;

const ConfirmSub = styled.div`
  font-size: 12px;
  color: ${color.ink[500]};
  text-align: center;
  line-height: 1.5;
`;

/* ── 예상 시간 카드 ──────────────────────────── */
const TimeCard = styled.div`
  background: ${color.white};
  border: ${border.thin};
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: ${fadeIn} 0.3s ease 0.2s both;
  box-shadow: ${shadow.card};
`;

const TimeIcon = styled.div`
  font-size: 22px;
  flex-shrink: 0;
`;

const TimeContent = styled.div``;

const TimeLabel = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  font-family: ${font.mono};
  letter-spacing: 0.04em;
  margin-bottom: 2px;
`;

const TimeValue = styled.div`
  font-family: ${font.mono};
  font-size: 16px;
  font-weight: 700;
  color: ${color.ink[900]};
`;

/* ── 의사 정보 ──────────────────────────────────── */
const DoctorCard = styled.div`
  background: ${color.white};
  border: ${border.thin};
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: ${slideIn} 0.3s ease 0.3s both;
  box-shadow: ${shadow.card};
`;

const DoctorAvatar = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${color.healthBlueDim};
  border: 1.5px solid ${color.healthBlue};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
`;

const DoctorInfo = styled.div`
  flex: 1;
`;

const DoctorName = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
`;

const DoctorRole = styled.div`
  font-size: 10.5px;
  color: ${color.ink[300]};
  margin-top: 1px;
`;

/* ── 환자 정보 요약 ──────────────────────────── */
const PatientInfo = styled.div`
  background: ${color.cream.base};
  border: ${border.thin};
  border-radius: 10px;
  padding: 12px 14px;
  animation: ${slideIn} 0.3s ease 0.4s both;
`;

const InfoTitle = styled.div`
  font-size: 10px;
  font-family: ${font.mono};
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 8px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 3px 0;
  border-bottom: 1px solid ${color.cream.mid};
  &:last-child { border-bottom: none; }
`;

const InfoKey = styled.div`
  font-size: 11px;
  color: ${color.ink[300]};
`;

const InfoVal = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  text-align: right;
  flex: 1;
  margin-left: 8px;
`;

/* ── 하단 고정 버튼 ──────────────────────────── */
const Footer = styled.div`
  flex-shrink: 0;
  padding: 10px 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid ${color.cream.mid};
  background: ${color.cream.light};
`;

const CallBtn = styled.button`
  width: 100%;
  padding: 13px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: ${font.weight.bold};
  color: white;
  background: ${color.healthBlue};
  border: 2px solid #14387A;
  box-shadow: 0 2px 8px rgba(29,82,150,0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  &:active { transform: scale(0.98); }
`;

const ReportBtn = styled.button`
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: ${border.mid};
  background: ${color.white};
  font-size: 12px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  &:active { background: ${color.cream.base}; }
`;

/* ── Doctor Panel ─────────────────────────────── */
const DoctorPanel = styled.div`
  flex-shrink: 0;
  background: ${color.cream.base};
  border-top: 1.5px solid ${color.cream.dark};
  display: flex;
  align-items: flex-start;
  padding: 8px 12px;
  gap: 10px;
`;

const SpeechWrap = styled.div`
  flex: 1;
  padding-top: 4px;
`;

const DoctorSpeech = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[900]};
  line-height: 1.55;
`;

const DoctorLabel = styled.div`
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${color.ink[100]};
  margin-top: 2px;
`;

/* ── 컴포넌트 ─────────────────────────────────────── */
export default function HealthCenterScreen() {
  const { getCurrentCase, setCurrentScreen } = useAppStore();
  const caseData = getCurrentCase();
  const { patient, reportData } = caseData;

  return (
    <Screen>
      <TopLabel>
        <TopText>보건소 연결</TopText>
        <ConnectedDot />
        <ConnectedLabel>연결됨</ConnectedLabel>
      </TopLabel>

      <Body>
        <ConfirmCard>
          <ConfirmCircle>
            <CheckSvg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <path
                d="M 5 15 L 12 22 L 25 8"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </CheckSvg>
          </ConfirmCircle>
          <ConfirmTitle>보건소에 연결됐어요</ConfirmTitle>
          <ConfirmSub>문진 리포트가 자동으로 전달됐어요.</ConfirmSub>
        </ConfirmCard>

        <TimeCard>
          <TimeIcon>⏱</TimeIcon>
          <TimeContent>
            <TimeLabel>예상 대기 시간</TimeLabel>
            <TimeValue>약 3분</TimeValue>
          </TimeContent>
        </TimeCard>

        <DoctorCard>
          <DoctorAvatar>👨‍⚕️</DoctorAvatar>
          <DoctorInfo>
            <DoctorName>김민준 선생님</DoctorName>
            <DoctorRole>남해 보건소 · 진료의</DoctorRole>
          </DoctorInfo>
        </DoctorCard>

        <PatientInfo>
          <InfoTitle>전달된 정보</InfoTitle>
          <InfoRow>
            <InfoKey>환자</InfoKey>
            <InfoVal>{patient.name} · {patient.age}세 {patient.gender}</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>주요 증상</InfoKey>
            <InfoVal>{reportData.todaySummary[0]}</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>통증 강도</InfoKey>
            <InfoVal className="mono">{reportData.painLevel} / 10</InfoVal>
          </InfoRow>
          <InfoRow>
            <InfoKey>기저 질환</InfoKey>
            <InfoVal>{patient.conditions.join(', ')}</InfoVal>
          </InfoRow>
        </PatientInfo>
      </Body>

      <Footer>
        <CallBtn>
          통화 연결
        </CallBtn>
        <ReportBtn onClick={() => setCurrentScreen('report')}>
          리포트 보기
        </ReportBtn>
      </Footer>

      <DoctorPanel>
        <VirtualDoctor state="idle" size={44} showHalo={false} />
        <SpeechWrap>
          <DoctorSpeech>
            김민준 선생님께 전달했어요. 잠시만 기다려 주세요.
          </DoctorSpeech>
          <DoctorLabel>닥터 메디 · MEDial</DoctorLabel>
        </SpeechWrap>
      </DoctorPanel>
    </Screen>
  );
}
