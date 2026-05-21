// src/screens/AnalyzingScreen.tsx (신규)
import { useState, useEffect } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { color, font, border, shadow } from '../styles/tokens';
import VirtualDoctor from '../components/phone/VirtualDoctor';
import { useAppStore } from '../store/useAppStore';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`;

const fillBar = keyframes`
  from { width: 0%; }
  to   { width: 100%; }
`;

const stepIn = keyframes`
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
`;

const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.18; }
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
  padding: 8px 14px;
  border-bottom: 1px solid ${color.cream.dark};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const TopText = styled.div`
  font-family: ${font.mono};
  font-size: 9.5px;
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const SpinnerWrap = styled.div`
  width: 14px;
  height: 14px;
  border: 1.5px solid ${color.sage[200]};
  border-top-color: ${color.sage[500]};
  border-radius: 50%;
  animation: ${spin} 0.9s linear infinite;
`;

/* ── 분석 영역 ──────────────────────────────────── */
const AnalysisArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 20px 10px;
  gap: 20px;
`;

/* ── 진행 단계 ──────────────────────────────────── */
const StepsWrap = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Step = styled.div<{ $active: boolean; $done: boolean; $delay: number }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: ${({ $active, $done }) =>
    $done ? color.sage[50] : $active ? color.cream.base : color.white};
  border: 1px solid ${({ $active, $done }) =>
    $done ? color.sage[300] : $active ? color.sage[200] : color.cream.dark};
  border-radius: 8px;
  opacity: ${({ $active, $done }) => ($active || $done ? 1 : 0.38)};
  transition: all 0.4s ease;
  animation: ${stepIn} 0.3s ease ${({ $delay }) => $delay * 0.15}s both;
`;

const StepIcon = styled.div<{ $done: boolean; $active: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid ${({ $done, $active }) =>
    $done ? color.sage[500] : $active ? color.sage[400] : color.cream.dark};
  background: ${({ $done }) => $done ? color.sage[500] : 'transparent'};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.3s;
`;

const StepNum = styled.div`
  font-family: ${font.mono};
  font-size: 10px;
  font-weight: 600;
  color: ${color.ink[300]};
`;

const StepText = styled.div<{ $active: boolean; $done: boolean }>`
  font-size: 13px;
  font-weight: ${({ $active }) => $active ? font.weight.semiBold : font.weight.regular};
  color: ${({ $active, $done }) =>
    $done ? color.sage[600] : $active ? color.ink[900] : color.ink[100]};
  transition: all 0.3s;
`;

/* ── 진행바 ──────────────────────────────────────── */
const ProgressTrack = styled.div`
  width: 100%;
  height: 4px;
  background: ${color.cream.mid};
  border-radius: 2px;
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  background: linear-gradient(90deg, ${color.sage[400]}, ${color.sage[600]});
  border-radius: 2px;
  width: ${({ $pct }) => $pct}%;
  transition: width 1.5s ease;
`;

/* ── Doctor Panel ─────────────────────────────────── */
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
  animation: ${fadeIn} 0.35s ease both;
`;

const DoctorLabel = styled.div`
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${color.ink[100]};
  margin-top: 3px;
  letter-spacing: 0.05em;
`;

/* ── 컴포넌트 ─────────────────────────────────────── */
const STEPS = [
  { text: '말씀하신 내용 정리하고 있어요' },
  { text: '이전 기록도 함께 살펴볼게요' },
  { text: '결과를 정리하고 있어요' },
];

const DOCTOR_MSGS = [
  '잠깐만요, 말씀 잘 들었어요.',
  '이전 기록도 같이 살펴볼게요.',
  '다 됐어요. 결과 보여드릴게요.',
];

export default function AnalyzingScreen() {
  const { setCurrentScreen } = useAppStore();
  const [step, setStep] = useState(0);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => { setStep(1); setPct(38); }, 1600));
    timers.push(setTimeout(() => { setStep(2); setPct(72); }, 3200));
    timers.push(setTimeout(() => { setPct(100); }, 4400));
    timers.push(setTimeout(() => { setCurrentScreen('decision'); }, 5200));
    return () => timers.forEach(clearTimeout);
  }, [setCurrentScreen]);

  return (
    <Screen>
      <TopLabel>
        <TopText>AI 분석 중</TopText>
        <SpinnerWrap />
      </TopLabel>

      <AnalysisArea>
        <StepsWrap>
          {STEPS.map((s, i) => (
            <Step key={i} $active={step === i} $done={step > i} $delay={i}>
              <StepIcon $done={step > i} $active={step === i}>
                {step > i ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M 2 6 L 5 9 L 10 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <StepNum>{i + 1}</StepNum>
                )}
              </StepIcon>
              <StepText $active={step === i} $done={step > i}>{s.text}</StepText>
            </Step>
          ))}
        </StepsWrap>

        <ProgressTrack>
          <ProgressFill $pct={pct} />
        </ProgressTrack>
      </AnalysisArea>

      <DoctorPanel>
        <VirtualDoctor state="thinking" size={52} showHalo={false} />
        <SpeechWrap>
          <DoctorSpeech key={step}>{DOCTOR_MSGS[step]}</DoctorSpeech>
          <DoctorLabel>닥터 메디 · MEDial</DoctorLabel>
        </SpeechWrap>
      </DoctorPanel>
    </Screen>
  );
}
