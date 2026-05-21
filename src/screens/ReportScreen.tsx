// src/screens/ReportScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border, shadow } from '../styles/tokens';
import { PrintIcon, ShareIcon, AlertIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ── 전체 레이아웃 ── */
const Screen = styled.div`
  height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

/* ── 상단 헤더 바 ── */
const TopBar = styled.div`
  flex-shrink: 0;
  background: ${color.sage[800]};
  padding: 12px 16px 10px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
`;

const TopLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const AppMark = styled.div`
  font-size: 9px;
  font-family: ${font.mono};
  letter-spacing: 0.12em;
  color: ${color.sage[400]};
  text-transform: uppercase;
`;

const ReportTitle = styled.div`
  font-size: 16px;
  font-weight: ${font.weight.bold};
  color: white;
  letter-spacing: -0.01em;
`;

const ReportMeta = styled.div`
  font-size: 10px;
  color: rgba(255,255,255,0.48);
  margin-top: 1px;
`;

const StatusBadge = styled.div`
  padding: 3px 10px;
  border: 1px solid rgba(255,255,255,0.20);
  border-radius: ${radius.xl};
  font-size: 9.5px;
  font-family: ${font.mono};
  color: rgba(255,255,255,0.42);
  letter-spacing: 0.05em;
  margin-top: 2px;
`;

/* ── 스크롤 바디 ── */
const Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: ${slideUp} 0.3s ease;
  &::-webkit-scrollbar { width: 2px; }
  &::-webkit-scrollbar-thumb { background: ${color.sage[200]}; border-radius: 2px; }
`;

/* ── 섹션 카드 ── */
const Card = styled.div`
  background: ${color.white};
  border: ${border.thin};
  border-radius: ${radius.xl};
  overflow: hidden;
  box-shadow: ${shadow.card};
`;

const CardHead = styled.div`
  padding: 6px 14px;
  background: ${color.sage[50]};
  border-bottom: ${border.rule};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SectionLabel = styled.span`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  font-family: ${font.mono};
  color: ${color.sage[600]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

/* ── key / value 행 ── */
const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 7px 14px;
  border-bottom: ${border.rule};
  gap: 8px;
  &:last-child { border-bottom: none; }
`;

const RowKey = styled.span`
  font-size: ${font.size.appSm};
  color: ${color.ink[300]};
  flex-shrink: 0;
  min-width: 58px;
`;

const RowVal = styled.span`
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  text-align: right;
  flex: 1;
  word-break: keep-all;
`;

/* ── 증상 bullet ── */
const BulletRow = styled.div`
  font-size: ${font.size.appSm};
  color: ${color.ink[700]};
  line-height: 1.6;
  padding: 7px 14px 7px 26px;
  border-bottom: ${border.rule};
  position: relative;
  word-break: keep-all;
  overflow-wrap: break-word;
  &:last-child { border-bottom: none; }
  &::before {
    content: '–';
    color: ${color.sage[400]};
    font-size: 12px;
    position: absolute;
    left: 14px;
    top: 8px;
  }
`;

/* ── 통증 바 ── */
const PainBlock = styled.div`
  padding: 10px 14px 12px;
  border-top: ${border.rule};
`;

const PainTopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
`;

const PainLbl = styled.span`
  font-size: 10px;
  color: ${color.ink[300]};
`;

const PainScore = styled.span`
  font-size: 20px;
  font-weight: ${font.weight.bold};
  color: ${color.terra.base};
  line-height: 1;
`;

const PainSub = styled.span`
  font-size: 11px;
  font-weight: 400;
  color: ${color.ink[300]};
`;

const PainTrack = styled.div`
  height: 4px;
  background: rgba(54,99,72,0.10);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 6px;
`;

const PainFill = styled.div<{ $level: number }>`
  height: 100%;
  width: ${({ $level }) => $level * 10}%;
  background: ${({ $level }) =>
    $level >= 8 ? color.emergency : $level >= 5 ? color.terra.base : color.sage[500]};
  border-radius: 2px;
  transition: width 0.5s ease;
`;

const PainNote = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  font-style: italic;
`;

/* ── 투약 주의 카드 ── */
const WarnCard = styled(Card)`
  border-color: rgba(170,31,16,0.22);
`;

const WarnBody = styled.div`
  padding: 10px 14px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
`;

const WarnText = styled.div`
  font-size: ${font.size.appSm};
  color: ${color.emergency};
  line-height: 1.55;
`;

/* ── 하단 CTA ── */
const Footer = styled.div`
  flex-shrink: 0;
  padding: 8px 12px 14px;
  background: ${color.white};
  border-top: ${border.rule};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PrimaryRow = styled.div`
  display: flex;
  gap: 7px;
`;

const PrimaryBtn = styled.button`
  flex: 1;
  padding: 11px 6px;
  border-radius: ${radius.lg};
  border: none;
  background: ${color.sage[700]};
  color: white;
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.semiBold};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  box-shadow: ${shadow.cta};
  transition: background 0.12s;
  &:active { background: ${color.sage[800]}; }
`;

const SecondaryBtn = styled.button`
  width: 100%;
  padding: 8px;
  border-radius: ${radius.md};
  border: ${border.thin};
  background: transparent;
  font-size: 11px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[300]};
  transition: background 0.12s;
  &:active { background: ${color.cream.base}; }
`;

export default function ReportScreen() {
  const { getCurrentCase, setCurrentCase, currentCaseId } = useAppStore();
  const caseData = getCurrentCase();
  const { patient, reportData } = caseData;

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <Screen>
      {/* 상단 헤더 */}
      <TopBar>
        <TopLeft>
          <AppMark>MEDial · Report</AppMark>
          <ReportTitle>문진 리포트</ReportTitle>
          <ReportMeta>{today} · {patient.name} 님</ReportMeta>
        </TopLeft>
        <StatusBadge>비공개</StatusBadge>
      </TopBar>

      {/* 스크롤 바디 */}
      <Body>
        {/* 기본 정보 */}
        <Card>
          <CardHead><SectionLabel>기본 정보</SectionLabel></CardHead>
          <Row>
            <RowKey>이름 / 나이</RowKey>
            <RowVal>{patient.name} · {patient.age}세 {patient.gender}</RowVal>
          </Row>
          <Row>
            <RowKey>혈액형</RowKey>
            <RowVal>{patient.bloodType}</RowVal>
          </Row>
          <Row>
            <RowKey>기저질환</RowKey>
            <RowVal>{patient.conditions.join(', ')}</RowVal>
          </Row>
          <Row>
            <RowKey>알레르기</RowKey>
            <RowVal>{patient.allergies.join(', ')}</RowVal>
          </Row>
        </Card>

        {/* 현재 투약 */}
        <Card>
          <CardHead><SectionLabel>현재 투약</SectionLabel></CardHead>
          {patient.medications.map((med, i) => (
            <Row key={i}>
              <RowKey>{med.name} {med.dose}</RowKey>
              <RowVal>{med.schedule}</RowVal>
            </Row>
          ))}
        </Card>

        {/* 오늘 증상 */}
        <Card>
          <CardHead><SectionLabel>오늘 증상 요약</SectionLabel></CardHead>
          {reportData.todaySummary.map((line, i) => (
            <BulletRow key={i}>{line}</BulletRow>
          ))}
          <PainBlock>
            <PainTopRow>
              <PainLbl>통증 강도 (음성·표정 분석)</PainLbl>
              <PainScore>
                {reportData.painLevel}
                <PainSub> / 10</PainSub>
              </PainScore>
            </PainTopRow>
            <PainTrack>
              <PainFill $level={reportData.painLevel} />
            </PainTrack>
            <PainNote>{reportData.analysisNote}</PainNote>
          </PainBlock>
        </Card>

        {/* 투약 주의 */}
        {reportData.medicationWarning && (
          <WarnCard>
            <CardHead style={{ background: color.emergencyDim, borderBottomColor: 'rgba(170,31,16,0.12)' }}>
              <AlertIcon size={11} color={color.emergency} />
              <SectionLabel style={{ color: color.emergency }}>투약 주의</SectionLabel>
            </CardHead>
            <WarnBody>
              <AlertIcon size={14} color={color.emergency} />
              <WarnText>{reportData.medicationWarning}</WarnText>
            </WarnBody>
          </WarnCard>
        )}
      </Body>

      {/* CTA 버튼 */}
      <Footer>
        <PrimaryRow>
          <PrimaryBtn>
            <PrintIcon size={12} color="white" />
            A4 인쇄
          </PrimaryBtn>
          <PrimaryBtn>
            <ShareIcon size={12} color="white" />
            카카오 전송
          </PrimaryBtn>
        </PrimaryRow>
        <SecondaryBtn onClick={() => setCurrentCase(currentCaseId)}>
          처음으로 돌아가기
        </SecondaryBtn>
      </Footer>
    </Screen>
  );
}
