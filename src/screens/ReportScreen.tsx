// src/screens/ReportScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { PrintIcon, ShareIcon, FileTextIcon, AlertIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const slideIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  min-height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
`;

/* 리포트 헤더 — 의료 기록 스타일 */
const ReportHeader = styled.div`
  background: ${color.sage[800]};
  padding: 13px 16px;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
`;

const ReportTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
`;

const ReportTitle = styled.div`
  font-size: ${font.size.appLg};
  font-weight: ${font.weight.bold};
  color: white;
`;

const ReportMeta = styled.div`
  font-size: 10px;
  color: rgba(255,255,255,0.45);
  margin-top: 3px;
`;

const ConfidentialBadge = styled.div`
  padding: 3px 8px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: ${radius.md};
  font-size: 10px;
  color: rgba(255,255,255,0.45);
  font-weight: ${font.weight.medium};
  letter-spacing: 0.04em;
`;

/* 바디 */
const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  &::-webkit-scrollbar { width: 2px; }
`;

/* 섹션 */
const Section = styled.div`
  background: ${color.white};
  border: ${border.thin};
  border-radius: ${radius.xl};
  overflow: hidden;
  animation: ${slideIn} 0.3s ease;
`;

const SecHead = styled.div`
  padding: 8px 13px;
  background: ${color.sage[50]};
  border-bottom: ${border.thin};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SecLabel = styled.span`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[700]};
  letter-spacing: 0.07em;
  text-transform: uppercase;
`;

const SecBody = styled.div`
  padding: 2px 0;
`;

const DataRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 7px 13px;
  border-bottom: ${border.rule};

  &:last-child { border-bottom: none; }
`;

const DataKey = styled.span`
  font-size: ${font.size.appSm};
  color: ${color.ink[300]};
  flex-shrink: 0;
  margin-right: 8px;
  min-width: 72px;
`;

const DataVal = styled.span`
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  text-align: right;
  flex: 1;
`;

const SummaryRow = styled.div`
  font-size: ${font.size.appSm};
  color: ${color.ink[700]};
  line-height: 1.55;
  padding: 7px 13px;
  border-bottom: ${border.rule};
  display: flex;
  gap: 7px;
  align-items: flex-start;

  &:last-child { border-bottom: none; }

  &::before {
    content: '·';
    color: ${color.sage[400]};
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1.3;
  }
`;

/* 통증 바 */
const PainRow = styled.div`
  padding: 8px 13px 10px;
  border-top: ${border.rule};
`;

const PainTopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 7px;
`;

const PainLabel = styled.span`
  font-size: ${font.size.appXs};
  color: ${color.ink[300]};
`;

const PainScore = styled.span`
  font-size: 18px;
  font-weight: ${font.weight.bold};
  color: ${color.terra.base};
`;

const PainTrack = styled.div`
  height: 5px;
  background: rgba(54,99,72,0.1);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 5px;
`;

const PainFill = styled.div<{ $level: number }>`
  height: 100%;
  width: ${({ $level }) => $level * 10}%;
  background: ${({ $level }) => $level >= 8 ? color.emergency : $level >= 5 ? color.terra.base : color.sage[500]};
  border-radius: 2px;
  transition: width 0.5s ease;
`;

const PainNote = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  font-style: italic;
`;

/* 약 경고 */
const WarnRow = styled.div`
  padding: 10px 13px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
`;

const WarnText = styled.div`
  font-size: ${font.size.appSm};
  color: ${color.emergency};
  line-height: 1.5;
`;

/* 하단 버튼 — 스크롤 시 화면 아래 고정 */
const Footer = styled.div`
  padding: 8px 12px 13px;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  border-top: ${border.thin};
  background: ${color.white};
  position: sticky;
  bottom: 0;
  z-index: 5;
`;

const FootBtn = styled.button`
  flex: 1;
  padding: 10px 8px;
  border-radius: ${radius.xl};
  border: ${border.thin};
  background: white;
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.medium};
  color: ${color.ink[500]};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: background 0.1s;
  &:active { background: ${color.cream.base}; }
`;

const HomeBtn = styled.button`
  width: 100%;
  padding: 9px;
  border-radius: ${radius.lg};
  border: ${border.thin};
  background: transparent;
  font-size: ${font.size.appSm};
  font-weight: ${font.weight.medium};
  color: ${color.ink[300]};
  margin: 0 12px 4px;
  width: calc(100% - 24px);
  transition: background 0.1s;
  &:active { background: ${color.cream.base}; }
`;

export default function ReportScreen() {
  const { getCurrentCase, setCurrentScreen, setCurrentCase, currentCaseId } = useAppStore();
  const caseData = getCurrentCase();
  const { patient, reportData } = caseData;

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <Screen>
      <ReportHeader>
        <div>
          <ReportTitleRow>
            <FileTextIcon size={15} color="white" />
            <ReportTitle>MEDial 문진 리포트</ReportTitle>
          </ReportTitleRow>
          <ReportMeta>{today} · {patient.name} 님</ReportMeta>
        </div>
        <ConfidentialBadge>비공개</ConfidentialBadge>
      </ReportHeader>

      <Body>
        {/* 기본 정보 */}
        <Section>
          <SecHead><SecLabel>기본 정보</SecLabel></SecHead>
          <SecBody>
            <DataRow>
              <DataKey>이름 / 나이</DataKey>
              <DataVal>{patient.name} · {patient.age}세 {patient.gender}</DataVal>
            </DataRow>
            <DataRow>
              <DataKey>혈액형</DataKey>
              <DataVal>{patient.bloodType}</DataVal>
            </DataRow>
            <DataRow>
              <DataKey>기저질환</DataKey>
              <DataVal>{patient.conditions.join(', ')}</DataVal>
            </DataRow>
            <DataRow>
              <DataKey>알레르기</DataKey>
              <DataVal>{patient.allergies.join(', ')}</DataVal>
            </DataRow>
          </SecBody>
        </Section>

        {/* 현재 투약 */}
        <Section>
          <SecHead><SecLabel>현재 투약</SecLabel></SecHead>
          <SecBody>
            {patient.medications.map((med, i) => (
              <DataRow key={i}>
                <DataKey>{med.name} {med.dose}</DataKey>
                <DataVal>{med.schedule}</DataVal>
              </DataRow>
            ))}
          </SecBody>
        </Section>

        {/* 오늘 증상 */}
        <Section>
          <SecHead><SecLabel>오늘 증상 요약</SecLabel></SecHead>
          <SecBody>
            {reportData.todaySummary.map((line, i) => (
              <SummaryRow key={i}>{line}</SummaryRow>
            ))}
            <PainRow>
              <PainTopRow>
                <PainLabel>통증 강도 (음성 + 표정 분석)</PainLabel>
                <PainScore>{reportData.painLevel}<span style={{ fontSize: 11, fontWeight: 400, color: color.ink[300] }}>/10</span></PainScore>
              </PainTopRow>
              <PainTrack><PainFill $level={reportData.painLevel} /></PainTrack>
              <PainNote>{reportData.analysisNote}</PainNote>
            </PainRow>
          </SecBody>
        </Section>

        {/* 투약 주의 */}
        {reportData.medicationWarning && (
          <Section style={{ borderColor: 'rgba(170,31,16,0.2)' }}>
            <SecHead style={{ background: color.emergencyDim, borderBottomColor: 'rgba(170,31,16,0.12)' }}>
              <AlertIcon size={12} color={color.emergency} />
              <SecLabel style={{ color: color.emergency }}>투약 주의</SecLabel>
            </SecHead>
            <WarnRow>
              <AlertIcon size={14} color={color.emergency} />
              <WarnText>{reportData.medicationWarning}</WarnText>
            </WarnRow>
          </Section>
        )}
      </Body>

      <HomeBtn onClick={() => { setCurrentCase(currentCaseId); }}>
        처음으로 돌아가기
      </HomeBtn>
      <Footer>
        <FootBtn>
          <PrintIcon size={13} color={color.ink[300]} />
          A4 인쇄
        </FootBtn>
        <FootBtn>
          <ShareIcon size={13} color={color.ink[300]} />
          카카오 전송
        </FootBtn>
      </Footer>
    </Screen>
  );
}
