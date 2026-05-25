// src/components/companion/HealthPanel.tsx
// companion 모드 우측 패널 — IoT 라이브 바이탈 + 식사 + escalation 상태 + 전시 시연 컨트롤.
import styled from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { useCompanion } from './CompanionContext';
import { ESCALATION } from '../../types/health';
import { AnomalyKind } from '../../hooks/useVitalsSim';

const Panel = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F4F1;
  border-left: 1px solid rgba(0,0,0,0.10);
  overflow-y: auto;
`;
const Header = styled.div`
  flex-shrink: 0;
  background: ${color.sage[900]};
  padding: 10px 16px;
`;
const HTitle = styled.div`
  font-size: 11.5px; font-weight: ${font.weight.bold}; color: white;
`;
const HSub = styled.div`
  font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0;
`;
const Section = styled.div`padding: 14px 16px; border-bottom: ${border.rule};`;
const SecLabel = styled.div`
  font-size: 11px; font-weight: ${font.weight.bold}; letter-spacing: 0.02em;
  color: ${color.text.muted}; margin-bottom: 10px;
`;
const VitalGrid = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 10px;`;
const VitalCard = styled.div<{ $alert: boolean }>`
  background: ${({ $alert }) => ($alert ? color.terra.pale : color.white)};
  border: 1px solid ${({ $alert }) => ($alert ? color.terra.mid : 'rgba(0,0,0,0.07)')};
  border-radius: 10px;
  padding: 10px 12px;
`;
const VLabel = styled.div`font-size: 11px; color: ${color.ink[300]};`;
const VValue = styled.div<{ $alert: boolean }>`
  font-size: 22px; font-weight: ${font.weight.bold};
  color: ${({ $alert }) => ($alert ? color.terra.dark : color.ink[700])};
  font-family: ${font.mono};
`;
const VUnit = styled.span`font-size: 11px; font-weight: ${font.weight.medium}; margin-left: 3px;`;

type ModeKind = 'companion' | 'triage' | 'suggest' | 'emergency';
const ModeBadge = styled.div<{ $kind: ModeKind }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: ${font.weight.bold};
  background: ${({ $kind }) => ($kind === 'emergency' ? color.role.dangerBg : $kind === 'triage' ? color.healthBlueDim : $kind === 'suggest' ? color.amber.pale : color.sage[100])};
  color: ${({ $kind }) => ($kind === 'emergency' ? color.role.danger : $kind === 'triage' ? color.healthBlue : $kind === 'suggest' ? color.amber.dark : color.sage[700])};
`;
const Reason = styled.div`font-size: 11px; color: ${color.ink[500]}; margin-top: 6px; line-height: 1.5;`;

const MealRow = styled.div`
  background: ${color.white}; border: 1px solid rgba(0,0,0,0.07);
  border-radius: 10px; padding: 10px 12px; font-size: 12px; color: ${color.ink[700]};
`;
const FlagChip = styled.span<{ $ok: boolean }>`
  display: inline-block; margin: 4px 4px 0 0; padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: ${font.weight.semiBold};
  background: ${({ $ok }) => ($ok ? color.sage[100] : color.amber.pale)};
  color: ${({ $ok }) => ($ok ? color.sage[700] : color.amber.dark)};
`;
const Empty = styled.div`font-size: 12px; color: ${color.ink[300]};`;
const GpsRow = styled.div`
  margin-top: 8px; font-size: 12px; color: ${color.text.muted};
  display: flex; align-items: center; gap: 5px;
`;
const LogList = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const LogRow = styled.div`
  display: flex; align-items: baseline; gap: 8px;
  font-size: 11px; font-family: ${font.mono}; color: ${color.text.body};
`;
const LogTime = styled.span`color: ${color.text.muted}; flex-shrink: 0;`;
const LogKind = styled.span`font-weight: ${font.weight.bold}; color: ${color.role.positive};`;
const LogDetail = styled.span`color: ${color.text.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;

const DemoBtn = styled.button`
  display: block; width: 100%; text-align: left;
  margin-top: 6px; padding: 8px 11px; border-radius: 8px;
  font-size: 12px; font-weight: ${font.weight.medium};
  background: ${color.white}; border: 1px solid ${color.cream.dark}; color: ${color.ink[700]};
  &:active { transform: scale(0.99); }
`;

const ReportCard = styled.div`
  background: ${color.white};
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 12px;
  padding: 12px 14px;
`;
const TriagePill = styled.span<{ $t: string }>`
  display: inline-block; margin-bottom: 8px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: ${font.weight.bold};
  background: ${({ $t }) => ($t === 'emergency' ? color.emergencyDim : $t === 'urgent' ? color.amber.pale : color.sage[100])};
  color: ${({ $t }) => ($t === 'emergency' ? color.emergency : $t === 'urgent' ? color.amber.dark : color.sage[700])};
`;
const RChief = styled.div`font-size: 14px; font-weight: ${font.weight.bold}; color: ${color.ink[700]}; margin-bottom: 6px;`;
const RRow = styled.div`font-size: 12px; color: ${color.ink[500]}; line-height: 1.55; margin-top: 4px;`;
const RNote = styled.div`
  display: flex; gap: 6px; align-items: flex-start;
  font-size: 12px; color: ${color.text.body}; line-height: 1.55; margin-top: 8px;
  padding: 8px 10px; background: ${color.sage[50]}; border-radius: 8px;
`;

const ANOMALIES: Array<{ kind: AnomalyKind; label: string }> = [
  { kind: 'htn_crisis', label: '혈압 위기 주입 (192/124)' },
  { kind: 'tachycardia', label: '빈맥 주입 (136 bpm)' },
  { kind: 'bradycardia', label: '서맥 주입 (38 bpm)' },
  { kind: 'hypotension', label: '저혈압 주입 (86 mmHg)' },
];

function sysAlert(s?: number) {
  if (s == null) return false;
  return s >= ESCALATION.vital.systolic.warnHigh || s <= ESCALATION.vital.systolic.warnLow;
}
function hrAlert(h?: number) {
  if (h == null) return false;
  return h >= ESCALATION.vital.heartRate.warnHigh || h <= ESCALATION.vital.heartRate.warnLow;
}

export default function HealthPanel() {
  const { healthContext, chatMode, triageSuggested, triageSuggestReason, liveReport, telemetry, emergencyActive } = useAppStore();
  const { injectAnomaly } = useCompanion();
  const triageLabel: Record<string, string> = { emergency: '응급', urgent: '당일 진료', routine: '예약 권장' };
  const v = healthContext.vitals[healthContext.vitals.length - 1];
  const lastMeal = healthContext.meals[healthContext.meals.length - 1];

  const modeKind: ModeKind =
    emergencyActive ? 'emergency'
    : chatMode === 'triage' ? 'triage'
    : triageSuggested ? 'suggest' : 'companion';

  return (
    <Panel>
      <Header>
        <HTitle>MEDial 3.0 · 어르신 건강 모니터</HTitle>
        <HSub>IoT 시뮬 · 오케스트레이터 상태</HSub>
      </Header>

      <Section>
        <SecLabel>현재 상태</SecLabel>
        <ModeBadge $kind={modeKind}>
          {modeKind === 'emergency' ? '응급 — 119 안내'
            : modeKind === 'triage' ? '상담 모드 진입'
            : modeKind === 'suggest' ? '상담 제안 중' : '일상 대화 모드'}
        </ModeBadge>
        {triageSuggestReason && <Reason>판정 근거: {triageSuggestReason}</Reason>}
      </Section>

      <Section>
        <SecLabel>실시간 바이탈</SecLabel>
        {v ? (
          <VitalGrid>
            <VitalCard $alert={hrAlert(v.heartRate)}>
              <VLabel>심박</VLabel>
              <VValue $alert={hrAlert(v.heartRate)}>{v.heartRate}<VUnit>bpm</VUnit></VValue>
            </VitalCard>
            <VitalCard $alert={sysAlert(v.bloodPressure.systolic)}>
              <VLabel>혈압</VLabel>
              <VValue $alert={sysAlert(v.bloodPressure.systolic)}>
                {v.bloodPressure.systolic}/{v.bloodPressure.diastolic}
              </VValue>
            </VitalCard>
            <VitalCard $alert={false}>
              <VLabel>걸음</VLabel>
              <VValue $alert={false}>{v.steps.toLocaleString()}<VUnit>보</VUnit></VValue>
            </VitalCard>
            <VitalCard $alert={false}>
              <VLabel>이동거리</VLabel>
              <VValue $alert={false}>{v.distanceKm}<VUnit>km</VUnit></VValue>
            </VitalCard>
          </VitalGrid>
        ) : <Empty>측정 대기 중…</Empty>}
        {v?.location && (
          <GpsRow>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={color.text.muted} strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.4" stroke={color.text.muted} strokeWidth="1.8" />
            </svg>
            {v.location.label ?? `${v.location.lat.toFixed(3)}, ${v.location.lng.toFixed(3)}`} · GPS 활성
          </GpsRow>
        )}
      </Section>

      <Section>
        <SecLabel>최근 식사</SecLabel>
        {lastMeal ? (
          <MealRow>
            {lastMeal.aiSummary}
            <div>
              {lastMeal.flags.map((f) => (
                <FlagChip key={f} $ok={f === '균형'}>{f}</FlagChip>
              ))}
            </div>
          </MealRow>
        ) : <Empty>아직 기록된 식사가 없어요.</Empty>}
      </Section>

      {liveReport && (
        <Section>
          <SecLabel>보건소 전송 리포트</SecLabel>
          <ReportCard>
            <TriagePill $t={liveReport.triage}>
              {triageLabel[liveReport.triage] ?? liveReport.triage}
            </TriagePill>
            <RChief>{liveReport.chief_complaint}</RChief>
            {liveReport.symptoms?.length > 0 && <RRow>증상: {liveReport.symptoms.join(', ')}</RRow>}
            {liveReport.ddx?.length > 0 && (
              <RRow>의심: {liveReport.ddx.map((d) => `${d.name}(${d.probability}%)`).join(', ')}</RRow>
            )}
            {liveReport.medications?.length > 0 && <RRow>복용약: {liveReport.medications.join(', ')}</RRow>}
            {liveReport.notes_for_clinician && (
              <RNote>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                  <rect x="5" y="3.5" width="14" height="17" rx="2" stroke={color.sage[700]} strokeWidth="1.8" />
                  <path d="M9 3.5h6v3H9z" stroke={color.sage[700]} strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M8.5 11h7M8.5 14.5h7" stroke={color.sage[700]} strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span>{liveReport.notes_for_clinician}</span>
              </RNote>
            )}
          </ReportCard>
        </Section>
      )}

      <Section>
        <SecLabel>전시 시연 — 이상치 주입</SecLabel>
        {ANOMALIES.map(({ kind, label }) => (
          <DemoBtn key={kind} onClick={() => injectAnomaly(kind)}>{label}</DemoBtn>
        ))}
      </Section>

      <Section>
        <SecLabel>세션 로그 (평가용)</SecLabel>
        {telemetry.length === 0 ? <Empty>아직 이벤트가 없어요.</Empty> : (
          <LogList>
            {[...telemetry].reverse().slice(0, 12).map((e, i) => (
              <LogRow key={i}>
                <LogTime>{new Date(e.t).toLocaleTimeString('ko-KR', { hour12: false })}</LogTime>
                <LogKind>{e.kind}</LogKind>
                {e.detail && <LogDetail>{e.detail}</LogDetail>}
              </LogRow>
            ))}
          </LogList>
        )}
      </Section>
    </Panel>
  );
}
