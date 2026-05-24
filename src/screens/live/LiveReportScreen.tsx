// src/screens/live/LiveReportScreen.tsx — SCREEN 05 (Report generation)
import styled, { keyframes } from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.cream.light};
  overflow: hidden;
`;

const Header = styled.div`
  flex-shrink: 0;
  background: ${color.sage[900]};
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Spinner = styled.div`
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: ${color.sage[300]};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const HeaderText = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.semiBold};
  color: white;
`;

const Sending = styled.div`
  display: flex; align-items: center; gap: 3px;
  margin-left: auto;
`;
const SendDot = styled.div<{ $d: string }>`
  width: 4px; height: 4px; border-radius: 50%;
  background: ${color.sage[400]};
  animation: ${dotBlink} 1s ease-in-out infinite;
  animation-delay: ${({ $d }) => $d};
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

const Section = styled.div<{ $delay?: number }>`
  background: ${color.white};
  border: ${border.thin};
  border-radius: 10px;
  padding: 12px 14px;
  animation: ${slideUp} 0.35s ease both;
  animation-delay: ${({ $delay }) => ($delay ?? 0) * 0.12}s;
`;

const SectionLabel = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[500]};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: ${font.mono};
  margin-bottom: 6px;
`;

const SectionValue = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[900]};
  line-height: 1.4;
`;

const TagRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px;
`;

const Tag = styled.div<{ $red?: boolean }>`
  font-size: 10.5px;
  font-weight: ${font.weight.medium};
  padding: 2px 8px;
  border-radius: 4px;
  background: ${({ $red }) => $red ? color.terra.pale : color.sage[50]};
  color: ${({ $red }) => $red ? color.terra.base : color.sage[700]};
  border: 1px solid ${({ $red }) => $red ? 'rgba(176,48,32,0.2)' : 'rgba(54,99,72,0.15)'};
`;

const DdxRow = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid ${color.cream.mid};
  &:last-child { border-bottom: none; }
`;
const DdxName = styled.div`
  font-size: 12px; color: ${color.ink[700]};
`;
const DdxBar = styled.div<{ $pct: number }>`
  display: flex; align-items: center; gap: 6px;
`;
const BarTrack = styled.div`
  width: 60px; height: 5px; border-radius: 3px;
  background: ${color.cream.mid};
  overflow: hidden;
`;
const BarFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${color.sage[500]};
  border-radius: 3px;
`;
const PctLabel = styled.div`
  font-size: 10px; color: ${color.ink[300]};
  font-family: ${font.mono};
`;

const TriageBadge = styled.div<{ $triage: string }>`
  display: inline-block;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: ${font.weight.semiBold};
  background: ${({ $triage }) =>
    $triage === 'emergency' ? color.terra.pale :
    $triage === 'urgent'    ? '#FFF3E0' :
    color.sage[50]};
  color: ${({ $triage }) =>
    $triage === 'emergency' ? color.terra.base :
    $triage === 'urgent'    ? '#E65100' :
    color.sage[700]};
  border: 1px solid ${({ $triage }) =>
    $triage === 'emergency' ? 'rgba(176,48,32,0.3)' :
    $triage === 'urgent'    ? 'rgba(230,81,0,0.3)' :
    'rgba(54,99,72,0.2)'};
`;

const Footer = styled.div`
  flex-shrink: 0;
  padding: 12px 14px 16px;
  border-top: 1px solid ${color.cream.dark};
`;

const SendBtn = styled.button`
  width: 100%;
  padding: 13px;
  background: ${color.sage[600]};
  border: 2px solid ${color.sage[700]};
  border-radius: 10px;
  font-size: 14px;
  font-weight: ${font.weight.semiBold};
  color: white;
  box-shadow: 0 2px 8px rgba(54,99,72,0.25);
  &:active { transform: scale(0.98); }
`;

import { LiveReport } from '../../types';

const MockReport: LiveReport = {
  chief_complaint: '3일째 지속되는 두통',
  symptoms: ['두통', '어지러움', '구역감', '수면 장애'],
  ddx: [
    { name: '긴장성 두통', probability: 62 },
    { name: '편두통', probability: 24 },
    { name: '고혈압성 두통', probability: 14 },
  ],
  medications: ['혈압약 복용 중'],
  self_care: ['타이레놀 2알 복용', '관자놀이 마사지'],
  triage: 'routine',
  questions: [],
  notes_for_clinician: '환자가 약 바꾸신 시점과 두통 시작 시점이 비슷합니다. 약물 부작용 확인이 필요해 보여요.',
  timestamp: Date.now(),
  sessionCode: 'DEMO-1',
};

export default function LiveReportScreen() {
  const { liveReport, setLiveScreen, commitSession } = useAppStore();
  const report = liveReport ?? MockReport;

  const handleSend = () => {
    commitSession();
    setLiveScreen('live-complete');
  };

  return (
    <Screen>
      <Header>
        <Spinner />
        <HeaderText>보건소 선생님께 전달 중...</HeaderText>
        <Sending>
          <SendDot $d="0s" />
          <SendDot $d="0.2s" />
          <SendDot $d="0.4s" />
        </Sending>
      </Header>

      <Content>
        <Section $delay={0}>
          <SectionLabel>주호소 (Chief Complaint)</SectionLabel>
          <SectionValue>{report.chief_complaint}</SectionValue>
        </Section>

        {report.symptoms.length > 0 && (
          <Section $delay={1}>
            <SectionLabel>수집된 증상</SectionLabel>
            <TagRow>
              {report.symptoms.map((s) => <Tag key={s}>{s}</Tag>)}
            </TagRow>
          </Section>
        )}

        {report.ddx.length > 0 && (
          <Section $delay={2}>
            <SectionLabel>의심 질환 TOP {report.ddx.length} (DDXPlus)</SectionLabel>
            {report.ddx.map((d) => (
              <DdxRow key={d.name}>
                <DdxName>{d.name}</DdxName>
                <DdxBar $pct={d.probability}>
                  <BarTrack>
                    <BarFill $pct={d.probability} />
                  </BarTrack>
                  <PctLabel>{d.probability}%</PctLabel>
                </DdxBar>
              </DdxRow>
            ))}
          </Section>
        )}

        {report.medications.length > 0 && (
          <Section $delay={3}>
            <SectionLabel>복용 약물</SectionLabel>
            <TagRow>
              {report.medications.map((m) => <Tag key={m} $red>{m}</Tag>)}
            </TagRow>
          </Section>
        )}

        {report.self_care && report.self_care.length > 0 && (
          <Section $delay={3}>
            <SectionLabel>자가 치료 시도</SectionLabel>
            <TagRow>
              {report.self_care.map((s) => <Tag key={s}>{s}</Tag>)}
            </TagRow>
          </Section>
        )}

        <Section $delay={4}>
          <SectionLabel>권고 조치</SectionLabel>
          <TriageBadge $triage={report.triage}>
            {report.triage === 'emergency' ? '즉시 응급실 방문'
             : report.triage === 'urgent'  ? '당일 내 보건소 방문'
             : '보건소 예약 방문 권장'}
          </TriageBadge>
        </Section>

        {report.notes_for_clinician && (
          <Section $delay={5}>
            <SectionLabel>임상의에게 전하는 말</SectionLabel>
            <div style={{ fontSize: 12, color: '#3A3A5A', lineHeight: 1.55, fontStyle: 'italic' }}>
              {report.notes_for_clinician}
            </div>
          </Section>
        )}
      </Content>

      <Footer>
        <SendBtn onClick={handleSend}>전달 완료 확인</SendBtn>
      </Footer>
    </Screen>
  );
}
