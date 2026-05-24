// src/screens/companion/MyHealthTab.tsx
// 내 건강 — 어르신이 자기 데이터를 직접 봄(존엄·통제, Frontiers 2025; 동기, JMIR 2025).
// 큰 카드(행 스캔, 노인 가독), 데이터 흐름 투명성, 모니터링 동의 토글.
import styled from 'styled-components';
import { color, font, ts, touch } from '../../styles/tokens';
import { ESCALATION } from '../../types/health';
import { useAppStore } from '../../store/useAppStore';
import { useCompanion } from '../../components/companion/CompanionContext';
import MealCapture from '../../components/companion/MealCapture';

const Wrap = styled.div`
  padding: 18px 16px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;
const H1 = styled.h1`
  font-size: ${ts(26)};
  font-weight: ${font.weight.bold};
  color: ${color.text.strong};
`;
const Card = styled.div<{ $alert?: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 16px;
  background: ${({ $alert }) => ($alert ? color.role.dangerBg : color.white)};
  border: 1px solid ${({ $alert }) => ($alert ? color.role.danger : 'rgba(0,0,0,0.07)')};
`;
const IconCircle = styled.div`
  width: 48px; height: 48px; flex-shrink: 0;
  border-radius: 50%;
  background: ${color.role.positiveBg};
  display: flex; align-items: center; justify-content: center;
  font-size: 24px;
`;
const CardBody = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const CLabel = styled.div`font-size: ${ts(15)}; color: ${color.text.muted};`;
const CValue = styled.div<{ $alert?: boolean }>`
  font-size: ${ts(24)};
  font-weight: ${font.weight.bold};
  color: ${({ $alert }) => ($alert ? color.role.danger : color.text.strong)};
`;
const CUnit = styled.span`font-size: ${ts(15)}; font-weight: ${font.weight.medium}; margin-left: 4px;`;
const Status = styled.div<{ $tone: 'ok' | 'warn' | 'info' }>`
  margin-top: 3px;
  font-size: ${ts(14)};
  font-weight: ${font.weight.semiBold};
  color: ${({ $tone }) => ($tone === 'warn' ? color.role.warn : $tone === 'info' ? color.role.info : color.role.positive)};
`;

function Glyph({ name }: { name: 'steps' | 'bp' | 'heart' | 'sleep' | 'lock' }) {
  const c = color.role.positive;
  const p = { fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'steps') return <svg width="26" height="26" viewBox="0 0 24 24"><path {...p} d="M8 4c1.5 0 2.5 1.2 2.5 3.5S9.5 13 8 13.5 5 12 5 9 6.5 4 8 4Zm8 6c1.3 0 2 1 2 3s-1 4-2.2 4.4S14 16.5 14 14.5 14.7 10 16 10Z"/><path {...p} d="M7 16c-1 .5-1.5 1.5-1 2.5M15 20c1 0 1.7-.7 1.8-1.7"/></svg>;
  if (name === 'bp') return <svg width="26" height="26" viewBox="0 0 24 24"><path {...p} d="M4 13h3l2-5 3 9 2-4h6"/></svg>;
  if (name === 'heart') return <svg width="26" height="26" viewBox="0 0 24 24"><path {...p} d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.5 12 20 12 20Z"/></svg>;
  if (name === 'sleep') return <svg width="26" height="26" viewBox="0 0 24 24"><path {...p} d="M20 14.5A7.5 7.5 0 0 1 9.5 4 7.5 7.5 0 1 0 20 14.5Z"/></svg>;
  return <svg width="22" height="22" viewBox="0 0 24 24"><rect {...p} x="5" y="10.5" width="14" height="9" rx="2"/><path {...p} d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>;
}

const SecTitle = styled.h2`
  font-size: ${ts(19)}; font-weight: ${font.weight.bold};
  color: ${color.text.strong}; margin: 6px 0 -2px;
`;
const MealSummary = styled.div`
  font-size: ${ts(17)}; color: ${color.text.body}; line-height: 1.5;
`;
const Trust = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
  padding: 14px 16px; border-radius: 14px;
  background: ${color.role.infoBg};
`;
const TrustText = styled.div`font-size: ${ts(15)}; color: ${color.role.info}; line-height: 1.55;`;

const ConsentRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-radius: 14px; background: ${color.white};
  border: 1px solid rgba(0,0,0,0.07);
`;
const ConsentLabel = styled.div`font-size: ${ts(17)}; color: ${color.text.body};`;
const Toggle = styled.button<{ $on: boolean }>`
  width: 58px; height: ${touch.min}px; flex-shrink: 0;
  display: flex; align-items: center;
  padding: 0 4px;
  border-radius: 999px;
  background: ${({ $on }) => ($on ? color.role.positive : 'rgba(0,0,0,0.18)')};
  justify-content: ${({ $on }) => ($on ? 'flex-end' : 'flex-start')};
  transition: background 0.2s;
  & > span { width: 26px; height: 26px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }
`;
const Empty = styled.div`font-size: ${ts(17)}; color: ${color.text.muted};`;
const Seg = styled.div`display: flex; gap: 8px;`;
const SegBtn = styled.button<{ $on: boolean }>`
  flex: 1; min-height: ${touch.min}px; border-radius: 12px;
  font-size: ${ts(17)}; font-weight: ${font.weight.bold};
  background: ${({ $on }) => ($on ? color.role.positive : color.white)};
  color: ${({ $on }) => ($on ? '#fff' : color.text.body)};
  border: 1px solid ${({ $on }) => ($on ? color.role.positive : color.cream.dark)};
  &:active { transform: scale(0.98); }
`;

function sysAlert(s?: number) {
  if (s == null) return false;
  return s >= ESCALATION.vital.systolic.warnHigh || s <= ESCALATION.vital.systolic.warnLow;
}
function hrAlert(h?: number) {
  if (h == null) return false;
  return h >= ESCALATION.vital.heartRate.warnHigh || h <= ESCALATION.vital.heartRate.warnLow;
}

export default function MyHealthTab() {
  const { healthContext, monitoringConsent, setMonitoringConsent, ttsSpeed, setTtsSpeed, logEvent } = useAppStore();
  const { ws } = useCompanion();
  const v = healthContext.vitals[healthContext.vitals.length - 1];
  const meal = healthContext.meals[healthContext.meals.length - 1];

  const chooseSpeed = (s: number) => { setTtsSpeed(s); ws.setTtsSpeed(s); };

  const toggleConsent = () => {
    const next = !monitoringConsent;
    setMonitoringConsent(next);
    logEvent('consent', next ? 'monitoring_on' : 'monitoring_off');
  };

  return (
    <Wrap>
      <H1>오늘의 내 건강</H1>

      {!monitoringConsent ? (
        <Empty>건강 신호 받기를 꺼두셨어요. 아래에서 켜시면 오늘 기록을 보여드려요.</Empty>
      ) : v ? (
        <>
          <Card>
            <IconCircle><Glyph name="steps" /></IconCircle>
            <CardBody><CLabel>오늘 걸음</CLabel>
              <CValue>{v.steps.toLocaleString()}<CUnit>보</CUnit></CValue>
              <Status $tone="ok">{v.steps >= 3000 ? '잘 걸으셨어요' : '조금 더 걸어볼까요?'}</Status>
            </CardBody>
          </Card>
          <Card $alert={sysAlert(v.bloodPressure.systolic)}>
            <IconCircle><Glyph name="bp" /></IconCircle>
            <CardBody><CLabel>혈압</CLabel>
              <CValue $alert={sysAlert(v.bloodPressure.systolic)}>
                {v.bloodPressure.systolic}/{v.bloodPressure.diastolic}<CUnit>mmHg</CUnit>
              </CValue>
              <Status $tone={sysAlert(v.bloodPressure.systolic) ? 'warn' : 'ok'}>
                {sysAlert(v.bloodPressure.systolic) ? '평소보다 조금 높아요' : '정상 범위예요'}
              </Status>
            </CardBody>
          </Card>
          <Card $alert={hrAlert(v.heartRate)}>
            <IconCircle><Glyph name="heart" /></IconCircle>
            <CardBody><CLabel>심박</CLabel>
              <CValue $alert={hrAlert(v.heartRate)}>{v.heartRate}<CUnit>bpm</CUnit></CValue>
              <Status $tone={hrAlert(v.heartRate) ? 'warn' : 'ok'}>
                {hrAlert(v.heartRate) ? '조금 살펴볼게요' : '정상 범위예요'}
              </Status>
            </CardBody>
          </Card>
          <Card>
            <IconCircle><Glyph name="sleep" /></IconCircle>
            <CardBody><CLabel>어젯밤 수면</CLabel>
              <CValue>7<CUnit>시간</CUnit> 20<CUnit>분</CUnit></CValue>
              <Status $tone="ok">푹 주무셨어요</Status>
            </CardBody>
          </Card>
        </>
      ) : (
        <Empty>밴드에서 신호를 기다리고 있어요…</Empty>
      )}

      <SecTitle>식사</SecTitle>
      {meal ? <MealSummary>{meal.aiSummary}</MealSummary>
            : <Empty>오늘 드신 식사를 사진으로 남겨 주세요.</Empty>}
      <MealCapture large />

      <SecTitle>내 정보는 안전해요</SecTitle>
      <Trust>
        <div style={{ flexShrink: 0, marginTop: 1 }}><Glyph name="lock" /></div>
        <TrustText>
          맥박·혈압 같은 건강 신호는 <b>남해보건소 담당 선생님</b>만 봐요.
          나눈 음성은 저장하지 않아요. 참고용이며 진단은 선생님이 하세요.
        </TrustText>
      </Trust>

      <ConsentRow>
        <ConsentLabel>건강 신호 받기 {monitoringConsent ? '(켜짐)' : '(꺼짐)'}</ConsentLabel>
        <Toggle $on={monitoringConsent} onClick={toggleConsent}
          role="switch" aria-checked={monitoringConsent} aria-label="건강 신호 받기">
          <span />
        </Toggle>
      </ConsentRow>

      <SecTitle>메디 말 속도</SecTitle>
      <Seg>
        <SegBtn $on={ttsSpeed <= 0.85} onClick={() => chooseSpeed(0.8)}>천천히</SegBtn>
        <SegBtn $on={ttsSpeed > 0.85} onClick={() => chooseSpeed(1.0)}>보통</SegBtn>
      </Seg>
    </Wrap>
  );
}
