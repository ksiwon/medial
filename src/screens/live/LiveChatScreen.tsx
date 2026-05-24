// src/screens/live/LiveChatScreen.tsx — SCREEN 02+03 (Real-time AI conversation)
import { useRef, useEffect } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { color, font, border } from '../../styles/tokens';
import { MicIcon } from '../../components/icons';
import VirtualDoctor from '../../components/phone/VirtualDoctor';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../hooks/useWebSocket';

const MAX_TURNS = 5;

/* ── animations ───────────────────────────────── */
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;
const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.15; }
`;
const waveBounce = keyframes`
  0%, 80%, 100% { transform: scaleY(0.25); }
  40%            { transform: scaleY(1); }
`;
const recPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(176,48,32,0.4); }
  50%       { box-shadow: 0 0 0 10px rgba(176,48,32,0); }
`;
const haloExpand = keyframes`
  0%   { transform: scale(1); opacity: 0.35; }
  100% { transform: scale(2.2); opacity: 0; }
`;

/* ── layout ───────────────────────────────────── */
const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.cream.light};
  overflow: hidden;
`;

const TopBar = styled.div`
  flex-shrink: 0;
  background: ${color.sage[900]};
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const TopLabel = styled.div`
  font-family: ${font.mono};
  font-size: 9.5px;
  color: ${color.sage[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const TurnBadge = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: ${color.sage[400]};
  background: rgba(255,255,255,0.08);
  padding: 2px 8px;
  border-radius: 3px;
`;

/* progress bar */
const ProgressWrap = styled.div`
  flex-shrink: 0;
  background: rgba(255,255,255,0.06);
  height: 3px;
  position: relative;
`;
const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  background: ${color.sage[400]};
  width: ${({ $pct }) => $pct}%;
  transition: width 0.4s ease;
`;

/* avatar panel */
const AvatarPanel = styled.div`
  flex-shrink: 0;
  background: ${color.sage[900]};
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 12px 12px;
  gap: 6px;
`;

const SpeechBubble = styled.div`
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: white;
  line-height: 1.6;
  width: 100%;
  min-height: 36px;
  animation: ${fadeUp} 0.28s ease both;
`;

const ThinkRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  height: 20px;
`;
const ThinkDot = styled.div<{ $d: string }>`
  width: 5px; height: 5px;
  border-radius: 50%;
  background: ${color.sage[300]};
  animation: ${dotBlink} 0.9s ease-in-out infinite;
  animation-delay: ${({ $d }) => $d};
`;

/* chat history */
const ChatArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;

const Bubble = styled.div<{ $role: 'user' | 'ai' }>`
  max-width: 88%;
  padding: 8px 11px;
  border-radius: ${({ $role }) => $role === 'ai' ? '4px 12px 12px 12px' : '12px 4px 12px 12px'};
  background: ${({ $role }) => $role === 'ai' ? color.white : color.sage[600]};
  border: ${({ $role }) => $role === 'ai' ? border.thin : 'none'};
  color: ${({ $role }) => $role === 'ai' ? color.ink[700] : 'white'};
  font-size: 12.5px;
  line-height: 1.55;
  align-self: ${({ $role }) => $role === 'ai' ? 'flex-start' : 'flex-end'};
  animation: ${fadeUp} 0.22s ease both;
`;

const SttPreview = styled.div`
  align-self: flex-end;
  max-width: 88%;
  padding: 6px 10px;
  border-radius: 12px 4px 12px 12px;
  background: ${color.sage[50]};
  border: 1px dashed ${color.sage[300]};
  font-size: 11.5px;
  color: ${color.ink[300]};
  font-style: italic;
  animation: ${fadeUp} 0.15s ease both;
`;

/* mic area */
const MicArea = styled.div`
  flex-shrink: 0;
  padding: 10px 16px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border-top: 1px solid ${color.cream.dark};
  background: ${color.cream.base};
`;

const MicWrap = styled.div`
  position: relative;
  width: 68px;
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Halo = styled.div<{ $delay: string; $rec: boolean }>`
  position: absolute;
  width: 50px; height: 50px;
  border-radius: 50%;
  border: 1.5px solid ${({ $rec }) => $rec ? color.terra.mid : color.sage[400]};
  animation: ${haloExpand} 1.8s ease-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

const MicBtn = styled.button<{ $rec: boolean; $disabled: boolean }>`
  width: 50px; height: 50px;
  border-radius: 50%;
  background: ${({ $rec }) => $rec ? color.terra.base : color.sage[600]};
  border: 2.5px solid ${({ $rec }) => $rec ? color.terra.dark : color.sage[700]};
  display: flex; align-items: center; justify-content: center;
  z-index: 2;
  opacity: ${({ $disabled }) => $disabled ? 0.45 : 1};
  ${({ $rec }) => $rec && css`animation: ${recPulse} 0.9s ease-in-out infinite;`}
  &:active { transform: scale(0.95); }
`;

const WaveRow = styled.div`
  display: flex; align-items: center; gap: 4px; height: 28px;
`;
const WaveBar = styled.div<{ $d: string }>`
  width: 4px; height: 100%;
  background: ${color.terra.base};
  border-radius: 2px;
  transform: scaleY(0.25);
  transform-origin: center;
  animation: ${waveBounce} 0.9s ease-in-out infinite;
  animation-delay: ${({ $d }) => $d};
`;

const MicHint = styled.div`
  font-size: 11px;
  color: ${color.ink[300]};
  text-align: center;
`;

const FinishBtn = styled.button`
  font-size: 11px;
  color: ${color.sage[500]};
  text-decoration: underline;
  text-underline-offset: 2px;
`;

/* ── component ────────────────────────────────── */
export default function LiveChatScreen() {
  const {
    liveDoctorState,
    liveMessages,
    liveTurnCount,
    currentSTT,
    isRecording,
    commitSession,
    setLiveScreen,
  } = useAppStore();

  const { startRecording, stopRecording, finishEarly } = useWebSocket();
  const bottomRef = useRef<HTMLDivElement>(null);
  const canRecord = liveDoctorState === 'idle' && !isRecording;
  const isThinking = liveDoctorState === 'thinking';
  const isSpeaking = liveDoctorState === 'speaking';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages, currentSTT]);

  const handleMic = async () => {
    if (isRecording) {
      stopRecording();
    } else if (canRecord) {
      await startRecording();
    }
  };

  const handleFinish = () => {
    // Ask the server for a real LLM-generated report from the transcript.
    // The 'report_ready' message will switch screens; if the server is offline
    // we still navigate locally as a fallback.
    finishEarly();
    if (!useAppStore.getState().wsConnected) {
      commitSession();
      setLiveScreen('live-report');
    }
  };

  const lastAiMsg = [...liveMessages].reverse().find((m) => m.role === 'ai');
  const pct = Math.min((liveTurnCount / MAX_TURNS) * 100, 100);

  return (
    <Screen>
      <TopBar>
        <TopLabel>MEDial · 라이브 문진</TopLabel>
        <TurnBadge>상담 {liveTurnCount}/{MAX_TURNS}회</TurnBadge>
      </TopBar>
      <ProgressWrap><ProgressFill $pct={pct} /></ProgressWrap>

      {/* avatar panel */}
      <AvatarPanel>
        <VirtualDoctor state={liveDoctorState} size={52} showHalo={false} />
        {isThinking ? (
          <ThinkRow>
            <ThinkDot $d="0s" />
            <ThinkDot $d="0.18s" />
            <ThinkDot $d="0.36s" />
          </ThinkRow>
        ) : (
          <SpeechBubble key={lastAiMsg?.timestamp ?? 0}>
            {lastAiMsg?.text ?? '안녕하세요, AI 의료 도우미 메디입니다. 오늘 어디가 불편하신지 편하게 말씀해 주세요.'}
          </SpeechBubble>
        )}
      </AvatarPanel>

      {/* chat history */}
      <ChatArea>
        {liveMessages.map((m) => (
          <Bubble key={m.timestamp} $role={m.role}>{m.text}</Bubble>
        ))}
        {currentSTT && <SttPreview>{currentSTT}...</SttPreview>}
        <div ref={bottomRef} />
      </ChatArea>

      {/* mic controls */}
      <MicArea>
        {isRecording ? (
          <WaveRow>
            {[0, 0.08, 0.16, 0.24, 0.32, 0.40].map((d, i) => (
              <WaveBar key={i} $d={`${d}s`} />
            ))}
          </WaveRow>
        ) : (
          <MicWrap>
            {!isThinking && !isSpeaking && (
              <>
                <Halo $delay="0s" $rec={isRecording} />
                <Halo $delay="0.85s" $rec={isRecording} />
              </>
            )}
            <MicBtn
              $rec={isRecording}
              $disabled={isThinking || isSpeaking}
              onClick={handleMic}
              aria-label={isRecording ? '녹음 중지' : '녹음 시작'}
            >
              <MicIcon size={20} color="white" />
            </MicBtn>
          </MicWrap>
        )}

        <MicHint>
          {isRecording
            ? '듣고 있어요 — 다시 눌러 전송'
            : isThinking
            ? 'AI가 분석 중이에요...'
            : isSpeaking
            ? '메디가 말하고 있어요...'
            : '마이크를 눌러 증상을 말씀해 주세요'}
        </MicHint>

        {liveTurnCount >= 2 && !isRecording && liveDoctorState === 'idle' && (
          <FinishBtn onClick={handleFinish}>지금 리포트 생성하기</FinishBtn>
        )}
      </MicArea>
    </Screen>
  );
}
