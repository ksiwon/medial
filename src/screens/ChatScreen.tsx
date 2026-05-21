// src/screens/ChatScreen.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { color, font, radius, border, shadow } from '../styles/tokens';
import { MicIcon, CameraIcon } from '../components/icons';
import VirtualDoctor from '../components/phone/VirtualDoctor';
import { useAppStore } from '../store/useAppStore';
import { DoctorState } from '../types';

/* ── 애니메이션 ─────────────────────────────────────── */
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const chipIn = keyframes`
  from { opacity: 0; transform: scale(0.88) translateY(4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
`;

const waveBounce = keyframes`
  0%, 80%, 100% { transform: scaleY(0.25); }
  40%            { transform: scaleY(1); }
`;

const scanLine = keyframes`
  0%   { top: 15%; }
  100% { top: 82%; }
`;

const recPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(176,48,32,0.4); }
  50%       { box-shadow: 0 0 0 10px rgba(176,48,32,0); }
`;

const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.15; }
`;

const micHalo = keyframes`
  0%   { transform: scale(1); opacity: 0.35; }
  100% { transform: scale(2.2); opacity: 0; }
`;

const bubbleIn = keyframes`
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`;

/* ── 전체 레이아웃 ──────────────────────────────────── */
const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.cream.light};
  overflow: hidden;
`;

/* ── 표정 분석 배너 ──────────────────────────────────── */
const AnalysisBanner = styled.div`
  flex-shrink: 0;
  background: ${color.sage[900]};
  padding: 5px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
`;

const AnalysisDot = styled.div`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${color.sage[400]};
  animation: ${dotBlink} 1.8s ease-in-out infinite;
`;

const AnalysisText = styled.div`
  font-size: 10px;
  color: ${color.sage[200]};
  flex: 1;
  font-family: ${font.mono};
  letter-spacing: 0.02em;
`;

/* ── 상단 컨텍스트 라벨 ──────────────────────────────── */
const ContextLabel = styled.div`
  flex-shrink: 0;
  padding: 5px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid ${color.cream.dark};
`;

const ContextText = styled.div`
  font-family: ${font.mono};
  font-size: 9.5px;
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const TurnBadge = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: ${color.sage[500]};
  background: ${color.sage[50]};
  padding: 2px 6px;
  border-radius: 3px;
`;

/* ── Action Area ──────────────────────────────────────── */
const ActionArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  position: relative;
  overflow: hidden;
  background: ${color.cream.light};
`;

/* ── Doctor Panel ─────────────────────────────────────── */
const DoctorPanel = styled.div`
  flex: 0 0 auto;
  min-height: 88px;
  background: ${color.cream.base};
  border-top: 1.5px solid ${color.cream.dark};
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 10px;
  position: relative;
`;

const DocAvatarWrap = styled.div`
  flex-shrink: 0;
`;

const SpeechWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 2px;
`;

const EmpathyLine = styled.div`
  font-size: 10.5px;
  color: ${color.sage[500]};
  font-style: italic;
  line-height: 1.4;
  animation: ${bubbleIn} 0.3s ease both;
`;

const DoctorSpeech = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[900]};
  line-height: 1.55;
  animation: ${bubbleIn} 0.35s ease 0.1s both;
`;

const DoctorLabel = styled.div`
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${color.ink[100]};
  letter-spacing: 0.06em;
  margin-top: 2px;
`;

/* ── 상태별 Action 컴포넌트들 ──────────────────────────── */

/* -- ActionChips -- */
const ChipsWrap = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Chip = styled.button<{ $delay?: number }>`
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: ${color.white};
  border: ${border.mid};
  border-radius: 8px;
  font-size: 13px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[700]};
  display: flex;
  align-items: center;
  gap: 10px;
  animation: ${chipIn} 0.25s ease both;
  animation-delay: ${({ $delay }) => ($delay ?? 0) * 0.07}s;
  transition: background 0.12s, border-color 0.12s, transform 0.08s;
  box-shadow: ${shadow.card};
  &:hover { background: ${color.cream.base}; border-color: rgba(54,99,72,0.38); }
  &:active { transform: scale(0.98); background: ${color.cream.mid}; }
`;

const ChipLabel = styled.div`
  font-family: ${font.mono};
  font-size: 10px;
  color: ${color.ink[100]};
  flex-shrink: 0;
  width: 16px;
`;

const MicCTA = styled.button`
  width: 100%;
  margin-top: 4px;
  padding: 11px 14px;
  background: ${color.sage[600]};
  border: 2px solid ${color.sage[700]};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: ${font.weight.semiBold};
  color: white;
  box-shadow: ${shadow.cta};
  animation: ${chipIn} 0.25s ease 0.35s both;
  transition: transform 0.08s;
  &:active { transform: scale(0.98); }
`;

const CameraBtn = styled.button`
  width: 100%;
  margin-top: 2px;
  padding: 10px 14px;
  background: ${color.amber.pale};
  border: ${border.amber};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  font-weight: ${font.weight.semiBold};
  color: ${color.amber.dark};
  animation: ${chipIn} 0.25s ease 0.42s both;
  transition: transform 0.08s;
  &:active { transform: scale(0.98); }
`;

/* -- ActionMic -- */
const MicZone = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
`;

const BigMicWrap = styled.div`
  position: relative;
  width: 96px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const MicHaloRing = styled.div<{ $delay: string; $listening?: boolean }>`
  position: absolute;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1.5px solid ${({ $listening }) => $listening ? color.amber.base : color.sage[400]};
  animation: ${micHalo} 1.8s ease-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

const BigMicBtn = styled.button<{ $listening?: boolean }>`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: ${({ $listening }) => $listening ? color.terra.base : color.sage[600]};
  border: 3px solid ${({ $listening }) => $listening ? color.terra.dark : color.sage[700]};
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  box-shadow: 0 3px 12px rgba(54,99,72,0.28);
  animation: ${({ $listening }) => $listening
    ? css`${recPulse} 0.9s ease-in-out infinite`
    : 'none'};
  &:active { transform: scale(0.95); }
`;

const MicZoneHint = styled.div`
  font-size: 12px;
  color: ${color.ink[300]};
  text-align: center;
  line-height: 1.5;
`;

/* -- ActionListening (파형) -- */
const WaveformWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
`;

const WaveRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  height: 50px;
`;

const WaveBar = styled.div<{ $delay: string }>`
  width: 5px;
  height: 100%;
  background: ${color.sage[500]};
  border-radius: 3px;
  transform: scaleY(0.25);
  transform-origin: center;
  animation: ${waveBounce} 0.9s ease-in-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

const WaveLabel = styled.div`
  font-size: 12px;
  color: ${color.ink[300]};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const BlinkDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${color.terra.base};
  animation: ${dotBlink} 0.9s ease-in-out infinite;
`;

/* -- ActionCamera (뷰파인더) -- */
const ViewfinderWrap = styled.div`
  width: 100%;
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`;

const Viewfinder = styled.div`
  width: 100%;
  aspect-ratio: 4/3;
  background: #141414;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  max-height: 130px;
`;

const VFCorner = styled.div<{ $pos: 'tl'|'tr'|'bl'|'br' }>`
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: ${color.amber.base};
  border-style: solid;
  border-width: 0;
  ${({ $pos }) => {
    switch ($pos) {
      case 'tl': return 'top:10px;left:10px;border-top-width:2px;border-left-width:2px;border-radius:2px 0 0 0;';
      case 'tr': return 'top:10px;right:10px;border-top-width:2px;border-right-width:2px;border-radius:0 2px 0 0;';
      case 'bl': return 'bottom:10px;left:10px;border-bottom-width:2px;border-left-width:2px;border-radius:0 0 0 2px;';
      case 'br': return 'bottom:10px;right:10px;border-bottom-width:2px;border-right-width:2px;border-radius:0 0 2px 0;';
    }
  }}
`;

const ScanLineEl = styled.div`
  position: absolute;
  left: 10px;
  right: 10px;
  height: 1.5px;
  background: linear-gradient(90deg, transparent, ${color.amber.base}, transparent);
  animation: ${scanLine} 2s ease-in-out infinite alternate;
  opacity: 0.7;
`;

const ShootBtn = styled.button`
  width: 100%;
  padding: 11px;
  background: ${color.amber.base};
  border: 2px solid ${color.amber.dark};
  border-radius: 10px;
  font-size: 13px;
  font-weight: ${font.weight.semiBold};
  color: white;
  box-shadow: ${shadow.terra};
  &:active { transform: scale(0.98); }
`;

const SkipBtn = styled.button`
  font-size: 11px;
  color: ${color.ink[300]};
  text-decoration: underline;
  text-underline-offset: 2px;
`;

/* -- ActionFinish -- */
const FinishWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
`;

const FinishCircle = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: ${color.sage[600]};
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: ${shadow.cta};
  animation: ${css`${dotBlink} 1.5s ease-in-out infinite`};
`;

const FinishText = styled.div`
  font-size: 13px;
  color: ${color.ink[500]};
  text-align: center;
`;

const FinishDots = styled.div`
  display: flex;
  gap: 5px;
  margin-top: 4px;
`;

const FinishDot = styled.div<{ $delay: string }>`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${color.sage[400]};
  animation: ${dotBlink} 1s ease-in-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

/* ── 컴포넌트 ──────────────────────────────────── */
const LABELS = ['A', 'B', 'C', 'D'];

export default function ChatScreen() {
  const {
    getCurrentCase,
    dialogueIndex,
    incrementDialogueIndex,
    prevConvIndex,
    actionMode,
    setActionMode,
    doctorState,
    setDoctorState,
    setCurrentScreen,
    showFaceAnalysis,
    showEmpathy,
  } = useAppStore();

  const caseData = getCurrentCase();
  const dialogue = prevConvIndex !== null
    ? caseData.prevConversations[prevConvIndex].followUpDialogue
    : caseData.dialogue;

  const [speaking, setSpeaking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const advanceTurnRef = useRef<() => void>(() => {});

  const currentTurn = dialogue[dialogueIndex];

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const advanceTurn = useCallback(() => {
    clearTimer();
    const next = dialogueIndex + 1;
    if (next >= dialogue.length) {
      setActionMode('finish');
      setDoctorState('thinking');
      timerRef.current = setTimeout(() => setCurrentScreen('analyzing'), 2000);
      return;
    }
    incrementDialogueIndex();
    // useEffect([dialogueIndex]) handles all turn setup after increment
  }, [dialogueIndex, dialogue.length, incrementDialogueIndex, setActionMode, setDoctorState, setCurrentScreen, clearTimer]);

  useEffect(() => {
    advanceTurnRef.current = advanceTurn;
  }, [advanceTurn]);

  // All turn setup lives here — runs after every index change
  useEffect(() => {
    if (!currentTurn) return;
    clearTimer();
    if (currentTurn.speaker === 'ai') {
      setSpeaking(true);
      setDoctorState('speaking');
      timerRef.current = setTimeout(() => {
        setSpeaking(false);
        if (currentTurn.options && currentTurn.options.length > 0) {
          // chips mode always when options exist; camera button appears inside chips
          setActionMode('chips');
          setDoctorState('idle');
        } else if (currentTurn.triggerPhotoCapture) {
          setActionMode('camera');
          setDoctorState('idle');
        } else {
          timerRef.current = setTimeout(() => advanceTurnRef.current(), 600);
        }
      }, 1200);
    } else {
      timerRef.current = setTimeout(() => advanceTurnRef.current(), 300);
    }
    return () => clearTimer();
  }, [dialogueIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectOption = (_option: string) => {
    clearTimer();
    if (currentTurn?.nextScreenOnSelect) {
      setCurrentScreen(currentTurn.nextScreenOnSelect);
      return;
    }
    advanceTurn();
  };

  const handleMicTalk = () => {
    clearTimer();
    setActionMode('listening');
    setDoctorState('listening');
    timerRef.current = setTimeout(() => {
      if (currentTurn?.nextScreenOnSelect) {
        setCurrentScreen(currentTurn.nextScreenOnSelect);
        return;
      }
      advanceTurn();
    }, 2200);
  };

  const handleCameraCapture = () => {
    clearTimer();
    setCurrentScreen('photo');
  };

  const handleCameraSkip = () => {
    clearTimer();
    if (currentTurn?.nextScreenOnSelect) {
      setCurrentScreen(currentTurn.nextScreenOnSelect);
    } else {
      setCurrentScreen('decision');
    }
  };

  const displayTurn = (() => {
    // 현재 index의 turn이나 직전 AI 턴 중 최신 것
    for (let i = dialogueIndex; i >= 0; i--) {
      if (dialogue[i].speaker === 'ai') return dialogue[i];
    }
    return null;
  })();

  const faceAnalysisText = displayTurn?.faceAnalysis ?? '표정·음성 분석 중...';

  return (
    <Screen>
      {showFaceAnalysis && (
        <AnalysisBanner>
          <AnalysisDot />
          <AnalysisText>{faceAnalysisText}</AnalysisText>
        </AnalysisBanner>
      )}

      <ContextLabel>
        <ContextText>
          {caseData.patient.name} 님 ·{' '}
          {prevConvIndex !== null ? '팔로업 문진' : '새 문진'}
        </ContextText>
        <TurnBadge>{dialogueIndex + 1} / {dialogue.length}</TurnBadge>
      </ContextLabel>

      {/* 상단 Action Area */}
      <ActionArea>
        {actionMode === 'chips' && currentTurn?.options && (
          <ChipsWrap>
            {currentTurn.options.map((opt, i) => (
              <Chip key={opt} $delay={i} onClick={() => handleSelectOption(opt)}>
                <ChipLabel>{LABELS[i]}</ChipLabel>
                {opt}
              </Chip>
            ))}
            <MicCTA onClick={handleMicTalk}>
              <MicIcon size={16} color="white" />
              직접 말씀하기
            </MicCTA>
            {currentTurn.triggerPhotoCapture && (
              <CameraBtn onClick={handleCameraCapture}>
                <CameraIcon size={15} color={color.amber.dark} />
                약 봉투 보여주기
              </CameraBtn>
            )}
          </ChipsWrap>
        )}

        {actionMode === 'mic' && (
          <MicZone>
            <BigMicWrap>
              <MicHaloRing $delay="0s" />
              <MicHaloRing $delay="0.8s" />
              <BigMicBtn onClick={handleMicTalk}>
                <MicIcon size={28} color="white" />
              </BigMicBtn>
            </BigMicWrap>
            <MicZoneHint>마이크를 눌러<br />말씀해 주세요</MicZoneHint>
          </MicZone>
        )}

        {actionMode === 'listening' && (
          <WaveformWrap>
            <WaveRow>
              {[0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((d, i) => (
                <WaveBar key={i} $delay={`${d}s`} />
              ))}
            </WaveRow>
            <WaveLabel>
              <BlinkDot />
              듣고 있어요...
            </WaveLabel>
          </WaveformWrap>
        )}

        {actionMode === 'camera' && (
          <ViewfinderWrap>
            <Viewfinder>
              <VFCorner $pos="tl" />
              <VFCorner $pos="tr" />
              <VFCorner $pos="bl" />
              <VFCorner $pos="br" />
              <ScanLineEl />
            </Viewfinder>
            <ShootBtn onClick={handleCameraCapture}>지금 촬영</ShootBtn>
            <SkipBtn onClick={handleCameraSkip}>사진 없이 계속하기</SkipBtn>
          </ViewfinderWrap>
        )}

        {actionMode === 'finish' && (
          <FinishWrap>
            <FinishCircle>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path
                  d="M 6 16 L 13 23 L 26 10"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="40"
                  strokeDashoffset="0"
                />
              </svg>
            </FinishCircle>
            <FinishText>분석하고 있어요</FinishText>
            <FinishDots>
              <FinishDot $delay="0s" />
              <FinishDot $delay="0.2s" />
              <FinishDot $delay="0.4s" />
            </FinishDots>
          </FinishWrap>
        )}

        {(actionMode === 'chips' && speaking) && (
          <WaveformWrap style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>
            <WaveRow style={{ height: '20px' }}>
              {[0, 0.1, 0.2, 0.15, 0.05].map((d, i) => (
                <WaveBar key={i} $delay={`${d}s`} style={{ width: '3px', background: color.sage[300] }} />
              ))}
            </WaveRow>
          </WaveformWrap>
        )}
      </ActionArea>

      {/* 하단 Doctor Panel */}
      <DoctorPanel>
        <DocAvatarWrap>
          <VirtualDoctor
            state={doctorState}
            size={52}
            showHalo={doctorState === 'listening' || doctorState === 'idle'}
          />
        </DocAvatarWrap>

        <SpeechWrap>
          {showEmpathy && displayTurn?.empathy && (
            <EmpathyLine key={`emp-${dialogueIndex}`}>{displayTurn.empathy}</EmpathyLine>
          )}
          {displayTurn && (
            <DoctorSpeech key={`msg-${dialogueIndex}`}>
              {displayTurn.message}
            </DoctorSpeech>
          )}
          <DoctorLabel>닥터 메디 · MEDial</DoctorLabel>
        </SpeechWrap>
      </DoctorPanel>
    </Screen>
  );
}
