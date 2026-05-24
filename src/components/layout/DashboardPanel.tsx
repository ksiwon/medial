// src/components/layout/DashboardPanel.tsx — 보건소 AI 문진 대시보드
import styled, { keyframes } from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { LiveSession, LiveReport } from '../../types';

/* ── animations ───────────────────────────────── */
const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
`;

const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
`;

/* ── layout ───────────────────────────────────── */
const Panel = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F4F1;
  border-left: 1px solid rgba(0,0,0,0.10);
  overflow: hidden;
`;

const PanelHeader = styled.div`
  flex-shrink: 0;
  background: #1A1A2E;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const HeaderLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const HeaderTitle = styled.div`
  font-size: 11.5px;
  font-weight: ${font.weight.bold};
  color: white;
  letter-spacing: 0.01em;
`;

const HeaderSub = styled.div`
  font-size: 9.5px;
  color: rgba(255,255,255,0.4);
  font-family: ${font.mono};
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const LiveBadge = styled.div<{ $on: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  background: ${({ $on }) => $on ? 'rgba(233,69,96,0.2)' : 'rgba(255,255,255,0.08)'};
  border: 1px solid ${({ $on }) => $on ? 'rgba(233,69,96,0.4)' : 'rgba(255,255,255,0.1)'};
  padding: 2px 8px;
  border-radius: 10px;
`;
const LiveDot = styled.div<{ $on: boolean }>`
  width: 5px; height: 5px;
  border-radius: 50%;
  background: ${({ $on }) => $on ? '#E94560' : 'rgba(255,255,255,0.25)'};
  animation: ${({ $on }) => $on ? `${dotBlink} 0.9s ease-in-out infinite` : 'none'};
`;
const LiveText = styled.div<{ $on: boolean }>`
  font-size: 9px;
  font-weight: ${font.weight.bold};
  letter-spacing: 0.1em;
  color: ${({ $on }) => $on ? '#E94560' : 'rgba(255,255,255,0.3)'};
`;

const CountBadge = styled.div`
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.15);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: rgba(255,255,255,0.6);
  font-family: ${font.mono};
`;

/* ── body split ───────────────────────────────── */
const Body = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
`;

/* left list */
const SessionList = styled.div`
  width: 148px;
  flex-shrink: 0;
  border-right: 1px solid rgba(0,0,0,0.08);
  overflow-y: auto;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: #EFEDE9;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

const ListLabel = styled.div`
  font-size: 9px;
  font-weight: ${font.weight.bold};
  color: rgba(0,0,0,0.35);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: ${font.mono};
  padding: 2px 4px;
  margin-bottom: 2px;
`;

const SessionCard = styled.button<{ $active: boolean }>`
  width: 100%;
  text-align: left;
  padding: 8px 9px;
  border-radius: 8px;
  background: ${({ $active }) => $active ? 'white' : 'transparent'};
  border: 1px solid ${({ $active }) => $active ? 'rgba(26,26,46,0.15)' : 'transparent'};
  display: flex;
  flex-direction: column;
  gap: 3px;
  animation: ${slideIn} 0.25s ease both;
  transition: background 0.12s;
  &:hover { background: white; }
`;

const SCardCode = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: #1A1A2E;
  font-family: ${font.mono};
`;
const SCardCC = styled.div`
  font-size: 10.5px;
  color: #4A4A6A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
`;
const SCardTime = styled.div`
  font-size: 9px;
  color: rgba(0,0,0,0.3);
  font-family: ${font.mono};
`;

const EmptyList = styled.div`
  padding: 12px 6px;
  font-size: 10.5px;
  color: rgba(0,0,0,0.3);
  text-align: center;
  line-height: 1.6;
`;

/* right detail */
const Detail = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

const NoSelect = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  color: rgba(0,0,0,0.25);
  text-align: center;
  line-height: 1.7;
  padding: 20px;
`;

/* detail cards */
const DCard = styled.div`
  background: white;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 8px;
  padding: 10px 12px;
`;
const DLabel = styled.div`
  font-size: 8.5px;
  font-weight: ${font.weight.bold};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #1A1A2E;
  opacity: 0.5;
  font-family: ${font.mono};
  margin-bottom: 5px;
`;
const DValue = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.semiBold};
  color: #1A1A2E;
  line-height: 1.4;
`;

const TagRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
`;
const DTag = styled.div<{ $red?: boolean }>`
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  background: ${({ $red }) => $red ? '#FDE8E8' : '#EDF5F0'};
  color: ${({ $red }) => $red ? '#B03020' : '#2B4D3A'};
  border: 1px solid ${({ $red }) => $red ? 'rgba(176,48,32,0.2)' : 'rgba(54,99,72,0.15)'};
`;

const DdxRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid #F2F0ED;
  &:last-child { border-bottom: none; }
`;
const DdxName = styled.div`
  font-size: 11.5px; color: #2A2A40;
`;
const DdxPct = styled.div`
  font-size: 10.5px; font-weight: ${font.weight.semiBold};
  color: #1A4A8C; font-family: ${font.mono};
`;

const QAItem = styled.div`
  padding: 5px 0;
  border-bottom: 1px solid #F2F0ED;
  &:last-child { border-bottom: none; }
`;
const QText = styled.div`
  font-size: 10.5px; font-weight: ${font.weight.semiBold}; color: #1A4A8C;
  margin-bottom: 2px;
`;
const AText = styled.div`
  font-size: 10.5px; color: #3A3A5A;
`;

const TriageChip = styled.div<{ $t: string }>`
  display: inline-block;
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: ${font.weight.semiBold};
  background: ${({ $t }) =>
    $t === 'emergency' ? '#FDE8E8' : $t === 'urgent' ? '#FFF3E0' : '#EDF5F0'};
  color: ${({ $t }) =>
    $t === 'emergency' ? '#B03020' : $t === 'urgent' ? '#E65100' : '#2B4D3A'};
`;

/* ── helpers ──────────────────────────────────── */
function timeLabel(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function ReportDetail({ session }: { session: LiveSession }) {
  const r: LiveReport = session.report ?? {
    chief_complaint: '(리포트 없음)',
    symptoms: [],
    ddx: [],
    medications: [],
    self_care: [],
    triage: 'routine',
    questions: session.messages
      .reduce<Array<{ question: string; answer: string }>>((acc, m, i, arr) => {
        if (m.role === 'ai' && arr[i + 1]?.role === 'user') {
          acc.push({ question: m.text, answer: arr[i + 1].text });
        }
        return acc;
      }, []),
    notes_for_clinician: undefined,
    timestamp: session.startedAt,
    sessionCode: session.sessionCode,
  };

  return (
    <>
      <DCard>
        <DLabel>환자 코드 · 접수 시각</DLabel>
        <DValue>{session.sessionCode} · {timeLabel(session.startedAt)}</DValue>
      </DCard>

      <DCard>
        <DLabel>주호소 (Chief Complaint)</DLabel>
        <DValue>{r.chief_complaint}</DValue>
      </DCard>

      {r.symptoms.length > 0 && (
        <DCard>
          <DLabel>수집된 증상</DLabel>
          <TagRow>
            {r.symptoms.map((s) => <DTag key={s}>{s}</DTag>)}
          </TagRow>
        </DCard>
      )}

      {r.ddx.length > 0 && (
        <DCard>
          <DLabel>의심 질환 (DDXPlus)</DLabel>
          {r.ddx.map((d) => (
            <DdxRow key={d.name}>
              <DdxName>{d.name}</DdxName>
              <DdxPct>{d.probability}%</DdxPct>
            </DdxRow>
          ))}
        </DCard>
      )}

      {r.medications.length > 0 && (
        <DCard>
          <DLabel>복용 약물</DLabel>
          <TagRow>
            {r.medications.map((m) => <DTag key={m} $red>{m}</DTag>)}
          </TagRow>
        </DCard>
      )}

      {r.self_care && r.self_care.length > 0 && (
        <DCard>
          <DLabel>자가 치료 시도</DLabel>
          <TagRow>
            {r.self_care.map((s) => <DTag key={s}>{s}</DTag>)}
          </TagRow>
        </DCard>
      )}

      <DCard>
        <DLabel>권고 조치</DLabel>
        <TriageChip $t={r.triage}>
          {r.triage === 'emergency' ? '즉시 응급실'
           : r.triage === 'urgent' ? '당일 보건소 방문'
           : '예약 방문 권장'}
        </TriageChip>
      </DCard>

      {r.notes_for_clinician && (
        <DCard>
          <DLabel>임상의에게</DLabel>
          <div style={{ fontSize: 11.5, color: '#3A3A5A', lineHeight: 1.55, fontStyle: 'italic' }}>
            {r.notes_for_clinician}
          </div>
        </DCard>
      )}

      {r.questions.length > 0 && (
        <DCard>
          <DLabel>AI 질문 이력</DLabel>
          {r.questions.map((q, i) => (
            <QAItem key={i}>
              <QText>Q{i + 1}. {q.question}</QText>
              <AText>→ {q.answer}</AText>
            </QAItem>
          ))}
        </DCard>
      )}
    </>
  );
}

/* ── main component ──────────────────────────── */
export default function DashboardPanel() {
  const { sessions, selectedSessionCode, setSelectedSession, wsConnected, liveScreen } = useAppStore();

  const activeSession = sessions.find((s) => s.sessionCode === selectedSessionCode) ?? null;
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

  return (
    <Panel>
      <PanelHeader>
        <HeaderLeft>
          <HeaderTitle>남해군 보건소 AI 문진 수신함</HeaderTitle>
          <HeaderSub>{today} · 접수 {sessions.length}건</HeaderSub>
        </HeaderLeft>
        <HeaderRight>
          <LiveBadge $on={wsConnected}>
            <LiveDot $on={wsConnected} />
            <LiveText $on={wsConnected}>LIVE</LiveText>
          </LiveBadge>
          <CountBadge>{sessions.length}</CountBadge>
        </HeaderRight>
      </PanelHeader>

      <Body>
        <SessionList>
          <ListLabel>접수 내역</ListLabel>
          {sessions.length === 0 ? (
            <EmptyList>아직 접수된<br />문진이 없어요</EmptyList>
          ) : (
            sessions.map((s) => (
              <SessionCard
                key={s.sessionCode}
                $active={s.sessionCode === selectedSessionCode}
                onClick={() => setSelectedSession(s.sessionCode)}
              >
                <SCardCode>{s.sessionCode}</SCardCode>
                <SCardCC>{s.report?.chief_complaint ?? '(진행 중)'}</SCardCC>
                <SCardTime>{timeLabel(s.startedAt)}</SCardTime>
              </SessionCard>
            ))
          )}
        </SessionList>

        <Detail>
          {activeSession ? (
            <ReportDetail session={activeSession} />
          ) : (
            <NoSelect>
              좌측에서 접수 건을<br />선택하면<br />상세 내용이 표시됩니다
            </NoSelect>
          )}
        </Detail>
      </Body>
    </Panel>
  );
}
