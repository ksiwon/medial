// src/screens/DecisionScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, border, shadow } from '../styles/tokens';
import { useAppStore } from '../store/useAppStore';
import VirtualDoctor from '../components/phone/VirtualDoctor';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const cardIn = keyframes`
  from { opacity: 0; transform: scale(0.96) translateY(10px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
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

const AiBadge = styled.div`
  font-size: 9px;
  font-family: ${font.mono};
  font-weight: 600;
  color: ${color.sage[600]};
  background: ${color.sage[50]};
  padding: 2px 7px;
  border-radius: 3px;
  letter-spacing: 0.04em;
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
  &::-webkit-scrollbar-thumb { background: rgba(54,99,72,0.20); }
`;

/* ── AI 권고 카드 ──────────────────────────────── */
const RecommendCard = styled.div<{ $outcome: string }>`
  padding: 14px;
  border-radius: 10px;
  background: ${({ $outcome }) =>
    $outcome === 'emergency' ? color.emergencyDim :
    $outcome === 'healthCenter' ? color.healthBlueDim : color.sage[50]};
  border: 1.5px solid ${({ $outcome }) =>
    $outcome === 'emergency' ? color.emergency :
    $outcome === 'healthCenter' ? color.healthBlue : color.sage[400]};
  animation: ${cardIn} 0.4s ease both;
`;

const RecommendTag = styled.div<{ $outcome: string }>`
  font-family: ${font.mono};
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  color: ${({ $outcome }) =>
    $outcome === 'emergency' ? color.emergency :
    $outcome === 'healthCenter' ? color.healthBlue : color.sage[600]};
`;

const RecommendText = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[900]};
  line-height: 1.6;
`;

/* ── 1차 CTA ──────────────────────────────────── */
const PrimaryBtn = styled.button<{ $outcome: string }>`
  width: 100%;
  padding: 14px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: ${font.weight.bold};
  color: white;
  background: ${({ $outcome }) =>
    $outcome === 'emergency' ? color.emergency :
    $outcome === 'healthCenter' ? color.healthBlue : color.sage[600]};
  border: 2px solid ${({ $outcome }) =>
    $outcome === 'emergency' ? color.terra.dark :
    $outcome === 'healthCenter' ? '#14387A' : color.sage[700]};
  box-shadow: ${shadow.cta};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  animation: ${fadeIn} 0.35s ease 0.2s both;
  &:active { transform: scale(0.98); }
`;

const OutcomeIcon = styled.div<{ $outcome: string }>`
  font-size: 18px;
`;

/* ── 2차 CTA들 ─────────────────────────────────── */
const SecondaryRow = styled.div`
  display: flex;
  gap: 6px;
  animation: ${fadeIn} 0.3s ease 0.35s both;
`;

const SecBtn = styled.button`
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  background: ${color.white};
  border: ${border.mid};
  font-size: 12px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  &:active { background: ${color.cream.base}; }
`;

const ReportLink = styled.button`
  width: 100%;
  padding: 8px;
  text-align: center;
  font-size: 11px;
  color: ${color.ink[300]};
  text-decoration: underline;
  text-underline-offset: 2px;
  animation: ${fadeIn} 0.3s ease 0.45s both;
`;

/* ── Doctor Panel ─────────────────────────────── */
const DoctorPanel = styled.div`
  flex-shrink: 0;
  background: ${color.cream.base};
  border-top: 1.5px solid ${color.cream.dark};
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  gap: 10px;
`;

const SpeechWrap = styled.div`
  flex: 1;
  padding-top: 4px;
`;

const DoctorSpeech = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[900]};
  line-height: 1.55;
`;

const DoctorLabel = styled.div`
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${color.ink[100]};
  margin-top: 3px;
`;

/* ── 데이터 ─────────────────────────────────────── */
const OUTCOME_LABEL: Record<string, string> = {
  emergency: '지금 바로 119 연락',
  healthCenter: '보건소 방문 권고',
  selfCare: '자가 치료 안내',
};

const OUTCOME_ICON: Record<string, string> = {
  emergency: '🚨',
  healthCenter: '🏥',
  selfCare: '🌿',
};

const DOCTOR_MSG: Record<string, string> = {
  emergency: '지금 바로 119에 연락하셔야 해요.',
  healthCenter: '오늘 보건소에 가보시는 게 좋겠어요.',
  selfCare: '집에서 잘 돌봐주시면 될 것 같아요.',
};

/* ── 컴포넌트 ─────────────────────────────────────── */
export default function DecisionScreen() {
  const { getCurrentCase, setCurrentScreen, onTriageSend, showAiRecommendation } = useAppStore();
  const caseData = getCurrentCase();
  const outcome = caseData.decisionOutcome;

  const handlePrimary = () => {
    onTriageSend(outcome);
  };

  return (
    <Screen>
      <TopLabel>
        <TopText>AI 판단 결과</TopText>
        <AiBadge>MEDial AI</AiBadge>
      </TopLabel>

      <Body>
        {showAiRecommendation && (
          <RecommendCard $outcome={outcome}>
            <RecommendTag $outcome={outcome}>AI 권고</RecommendTag>
            <RecommendText>{caseData.decisionRecommendation}</RecommendText>
          </RecommendCard>
        )}

        <PrimaryBtn $outcome={outcome} onClick={handlePrimary}>
          {OUTCOME_LABEL[outcome]}
        </PrimaryBtn>

        <SecondaryRow>
          <SecBtn onClick={() => onTriageSend('dialogue')}>
            다시 들어볼게요
          </SecBtn>
          <SecBtn onClick={() => setCurrentScreen('photo')}>
            사진 다시 보기
          </SecBtn>
        </SecondaryRow>

        <ReportLink onClick={() => setCurrentScreen('report')}>
          상세 리포트 보기
        </ReportLink>
      </Body>

      <DoctorPanel>
        <VirtualDoctor state={outcome === 'emergency' ? 'emergency' : 'idle'} size={52} showHalo={false} />
        <SpeechWrap>
          <DoctorSpeech>{DOCTOR_MSG[outcome]}</DoctorSpeech>
          <DoctorLabel>닥터 메디 · MEDial</DoctorLabel>
        </SpeechWrap>
      </DoctorPanel>
    </Screen>
  );
}
