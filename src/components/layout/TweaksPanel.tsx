// src/components/layout/TweaksPanel.tsx
import styled from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { cases } from '../../data/mockData';
import { ScreenId, LiveScreenId } from '../../types';

/* ── 스타일 ──────────────────────────────────── */
const Panel = styled.div`
  width: 200px;
  height: 100%;
  overflow-y: auto;
  background: #E0DAD0;
  border-left: 1px solid rgba(0,0,0,0.10);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 12px 20px;
  gap: 14px;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 1px; }
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const SectionLabel = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: rgba(0,0,0,0.36);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: ${font.mono};
  margin-bottom: 2px;
`;

/* ── 케이스 버튼 ──────────────────────────────── */
const CaseBtn = styled.button<{ $active: boolean }>`
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  background: ${({ $active }) => $active ? color.sage[600] : 'rgba(0,0,0,0.06)'};
  border: 1px solid ${({ $active }) => $active ? color.sage[500] : 'transparent'};
  font-size: 11px;
  font-weight: ${({ $active }) => $active ? font.weight.semiBold : font.weight.regular};
  color: ${({ $active }) => $active ? 'white' : color.ink[700]};
  transition: all 0.15s;
  &:hover { background: ${({ $active }) => $active ? color.sage[600] : 'rgba(0,0,0,0.10)'}; }
`;

/* ── 환자 정보 ──────────────────────────────────── */
const PatientCard = styled.div`
  background: rgba(255,255,255,0.55);
  border-radius: 6px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const PName = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[900]};
`;

const PMeta = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  font-family: ${font.mono};
`;

/* ── 화면 점프 드롭다운 ──────────────────────── */
const JumpSelect = styled.select`
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0,0,0,0.14);
  background: white;
  font-size: 11px;
  color: ${color.ink[700]};
  cursor: pointer;
  font-family: ${font.family};
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M 0 0 L 5 6 L 10 0' stroke='%237A9480' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  &:focus { outline: 2px solid ${color.sage[400]}; }
`;

/* ── 토글 ──────────────────────────────────────── */
const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
`;

const ToggleLabel = styled.div`
  font-size: 11px;
  color: ${color.ink[700]};
`;

const ToggleTrack = styled.div<{ $on: boolean }>`
  width: 30px;
  height: 17px;
  border-radius: 9px;
  background: ${({ $on }) => $on ? color.sage[500] : 'rgba(0,0,0,0.15)'};
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
`;

const ToggleThumb = styled.div<{ $on: boolean }>`
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: ${({ $on }) => $on ? '15px' : '2px'};
  transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
`;

/* ── 글자 크기 슬라이더 ──────────────────────── */
const ScaleOptions = styled.div`
  display: flex;
  gap: 3px;
`;

const ScaleBtn = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 5px 2px;
  border-radius: 4px;
  font-size: 10px;
  font-family: ${font.mono};
  font-weight: ${({ $active }) => $active ? 700 : 400};
  background: ${({ $active }) => $active ? color.sage[600] : 'rgba(0,0,0,0.07)'};
  color: ${({ $active }) => $active ? 'white' : color.ink[500]};
  border: 1px solid ${({ $active }) => $active ? color.sage[500] : 'transparent'};
  transition: all 0.12s;
`;

/* ── 구분선 ──────────────────────────────────────── */
const Divider = styled.div`
  height: 1px;
  background: rgba(0,0,0,0.10);
`;

/* ── 컴포넌트 ─────────────────────────────────────── */
const SCREEN_OPTIONS: Array<{ id: ScreenId; label: string }> = [
  { id: 'home',         label: '01 홈' },
  { id: 'chat',         label: '02 아바타 대화' },
  { id: 'analyzing',   label: '03 AI 분석 중' },
  { id: 'photo',        label: '04 멀티모달 촬영' },
  { id: 'decision',     label: '05 판단 분기' },
  { id: 'emergency',    label: '06 응급 119' },
  { id: 'healthCenter', label: '07 보건소 연결' },
  { id: 'selfCare',     label: '08 자가 치료' },
  { id: 'report',       label: '09 리포트' },
];

const SCALE_OPTIONS = [0.9, 1.0, 1.1, 1.2, 1.4];

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <ToggleTrack $on={on} onClick={onToggle} role="switch" aria-checked={on}>
      <ToggleThumb $on={on} />
    </ToggleTrack>
  );
}

const WsInput = styled.input`
  width: 100%;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid rgba(0,0,0,0.14);
  background: white;
  font-size: 10px;
  font-family: ${font.mono};
  color: ${color.ink[700]};
  &:focus { outline: 2px solid ${color.sage[400]}; }
`;

const StatusDot = styled.div<{ $ok: boolean }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${({ $ok }) => $ok ? color.sage[500] : color.terra.mid};
  flex-shrink: 0;
`;
const StatusRow = styled.div`
  display: flex; align-items: center; gap: 5px;
  font-size: 10px; font-family: ${font.mono};
  color: ${color.ink[300]};
`;
const LiveJumpBtn = styled.button<{ $active: boolean }>`
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 5px;
  background: ${({ $active }) => $active ? color.sage[600] : 'rgba(0,0,0,0.06)'};
  color: ${({ $active }) => $active ? 'white' : color.ink[700]};
  border: 1px solid ${({ $active }) => $active ? color.sage[500] : 'transparent'};
  font-size: 10.5px;
  font-weight: ${({ $active }) => $active ? 700 : 400};
  transition: all 0.12s;
`;

export default function TweaksPanel() {
  const {
    currentCaseId, currentScreen,
    setCurrentCase, setCurrentScreen,
    showFaceAnalysis, showEmpathy, showAiRecommendation,
    toggleFaceAnalysis, toggleEmpathy, toggleAiRecommendation,
    fontScale, setFontScale,
    getCurrentCase,
    appMode, wsUrl, setWsUrl, wsConnected,
    liveScreen, setLiveScreen, resetLiveSession,
  } = useAppStore();

  const caseData = getCurrentCase();
  const { patient } = caseData;

  const isCompanion = appMode === 'companion';

  return (
    <Panel>
      {isCompanion && (
        <Section>
          <SectionLabel>MEDial 2.0</SectionLabel>
          <PatientCard>
            <PMeta>AI 동반 + 의료 커뮤니티</PMeta>
            <PMeta>소통 · 정보 · IoT · 식사</PMeta>
          </PatientCard>
        </Section>
      )}

      {!isCompanion && <>
      {/* 케이스 선택 */}
      <Section>
        <SectionLabel>시나리오</SectionLabel>
        {cases.map((c) => (
          <CaseBtn
            key={c.id}
            $active={c.id === currentCaseId}
            onClick={() => setCurrentCase(c.id)}
          >
            {c.label}
          </CaseBtn>
        ))}
      </Section>

      <Divider />

      {/* 환자 정보 */}
      <Section>
        <SectionLabel>현재 환자</SectionLabel>
        <PatientCard>
          <PName>{patient.name} 님</PName>
          <PMeta>{patient.age}세 · {patient.gender} · {patient.bloodType}</PMeta>
          <PMeta>{patient.sessionCount}회 상담</PMeta>
        </PatientCard>
      </Section>

      <Divider />

      {/* 화면 점프 */}
      <Section>
        <SectionLabel>화면 점프</SectionLabel>
        <JumpSelect
          value={currentScreen}
          onChange={(e) => setCurrentScreen(e.target.value as ScreenId)}
        >
          {SCREEN_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </JumpSelect>
      </Section>

      <Divider />

      {/* 표시 설정 */}
      <Section>
        <SectionLabel>표시 설정</SectionLabel>
        <ToggleRow>
          <ToggleLabel>표정 분석 배너</ToggleLabel>
          <Toggle on={showFaceAnalysis} onToggle={toggleFaceAnalysis} />
        </ToggleRow>
        <ToggleRow>
          <ToggleLabel>공감 멘트</ToggleLabel>
          <Toggle on={showEmpathy} onToggle={toggleEmpathy} />
        </ToggleRow>
        <ToggleRow>
          <ToggleLabel>AI 권고</ToggleLabel>
          <Toggle on={showAiRecommendation} onToggle={toggleAiRecommendation} />
        </ToggleRow>
      </Section>

      <Divider />
      </>}

      {/* 글자 크기 */}
      <Section>
        <SectionLabel>글자 크기</SectionLabel>
        <ScaleOptions>
          {SCALE_OPTIONS.map((s) => (
            <ScaleBtn key={s} $active={fontScale === s} onClick={() => setFontScale(s)}>
              {s}x
            </ScaleBtn>
          ))}
        </ScaleOptions>
      </Section>

      <Divider />

      {/* 지역 */}
      <Section>
        <SectionLabel>대상 지역</SectionLabel>
        <PatientCard>
          <PMeta>농촌 (시골 시니어)</PMeta>
          <PMeta>IRB-2026-56 · N=11</PMeta>
        </PatientCard>
      </Section>

      {isCompanion && (
        <>
          <Divider />
          <Section>
            <SectionLabel>서버 (2.0)</SectionLabel>
            <StatusRow>
              <StatusDot $ok={wsConnected} />
              {wsConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </StatusRow>
            <WsInput
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://localhost:8000/ws/consultation"
              spellCheck={false}
            />
          </Section>
        </>
      )}

      {appMode === 'live' && (
        <>
          <Divider />

          {/* Live 서버 설정 */}
          <Section>
            <SectionLabel>서버 (Live)</SectionLabel>
            <StatusRow>
              <StatusDot $ok={wsConnected} />
              {wsConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </StatusRow>
            <WsInput
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://localhost:8000/ws/consultation"
              spellCheck={false}
            />
          </Section>

          <Divider />

          {/* Live 화면 점프 */}
          <Section>
            <SectionLabel>화면 점프 (Live)</SectionLabel>
            {(['live-idle','live-chat','live-emergency','live-report','live-complete'] as const).map((id, i) => (
              <LiveJumpBtn
                key={id}
                $active={liveScreen === id}
                onClick={() => setLiveScreen(id)}
              >
                {`0${i+1} ${['대기','문진 중','응급','리포트','완료'][i]}`}
              </LiveJumpBtn>
            ))}
          </Section>

          <Divider />

          {/* 세션 초기화 */}
          <Section>
            <SectionLabel>연구자 제어</SectionLabel>
            <CaseBtn
              $active={false}
              onClick={resetLiveSession}
              style={{ color: color.terra.base, borderColor: 'rgba(176,48,32,0.3)' }}
            >
              세션 초기화
            </CaseBtn>
          </Section>
        </>
      )}
    </Panel>
  );
}
