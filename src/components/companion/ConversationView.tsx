// src/components/companion/ConversationView.tsx
// MEDial 3.0 소통 탭의 채팅 뷰. companion(일상 말동무) ↔ triage(상담)을 모두 렌더한다.
// 두 모드는 같은 transcript(liveMessages)를 공유하므로 escalation 시 대화가 이어진다.
// WS 컨트롤은 CompanionShell이 1회 보유한 인스턴스를 props로 받는다.
import { useRef, useEffect } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { color, font, border, ts, touch } from '../../styles/tokens';
import { MicIcon } from '../icons';
import VirtualDoctor from '../phone/VirtualDoctor';
import { useAppStore } from '../../store/useAppStore';
import { useCompanion } from './CompanionContext';

const MAX_TURNS = 5;

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;
const dotBlink = keyframes`
  0%, 100% { opacity: 1; } 50% { opacity: 0.15; }
`;
const recPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(176,48,32,0.4); }
  50% { box-shadow: 0 0 0 10px rgba(176,48,32,0); }
`;
const haloExpand = keyframes`
  0% { transform: scale(1); opacity: 0.35; } 100% { transform: scale(2.2); opacity: 0; }
`;

const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${color.cream.light};
  overflow: hidden;
  position: relative;
`;

// 상담(triage)은 빨강(응급)이 아니라 차분한 딥틸블루 — 불안 유발 방지(응급만 빨강).
const TRIAGE_TOP = '#21414F';
const TopBar = styled.div<{ $triage: boolean }>`
  flex-shrink: 0;
  background: ${({ $triage }) => ($triage ? TRIAGE_TOP : color.sage[900])};
  padding: 7px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.3s;
`;
const TopLabel = styled.div`
  font-size: ${ts(15)};
  font-weight: ${font.weight.semiBold};
  color: white;
  letter-spacing: 0.02em;
`;
const TopRight = styled.div`
  display: flex; align-items: center; gap: 8px;
`;
const TurnBadge = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: rgba(255,255,255,0.85);
  background: rgba(255,255,255,0.12);
  padding: 2px 8px;
  border-radius: 3px;
`;
const TextSizeBtn = styled.button`
  display: flex; align-items: center; gap: 2px;
  min-height: 40px;
  color: white; background: rgba(255,255,255,0.16);
  border-radius: 8px; padding: 4px 10px; font-weight: ${font.weight.bold};
  & .sm { font-size: 12px; } & .lg { font-size: 17px; }
  & .lvl { font-size: 12px; margin-left: 4px; opacity: 0.85; font-weight: ${font.weight.medium}; }
  &:active { transform: scale(0.96); }
`;

const ProgressWrap = styled.div`
  flex-shrink: 0;
  background: rgba(0,0,0,0.06);
  height: 3px;
`;
const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%;
  background: ${color.healthBlue};
  width: ${({ $pct }) => $pct}%;
  transition: width 0.4s ease;
`;

const AvatarPanel = styled.div<{ $triage: boolean }>`
  flex-shrink: 0;
  background: ${({ $triage }) =>
    $triage
      ? 'linear-gradient(160deg, #2C5468, #18323D)'
      : `linear-gradient(160deg, ${color.sage[800]}, ${color.sage[900]})`};
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 14px 14px;
  gap: 7px;
  transition: background 0.3s;
`;
const AvatarName = styled.div`
  font-size: ${ts(14)};
  font-weight: ${font.weight.bold};
  color: rgba(255,255,255,0.9);
  margin-top: -2px;
`;
const SpeechBubble = styled.div`
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: ${ts(19)};
  color: white;
  line-height: 1.6;
  width: 100%;
  min-height: 38px;
  animation: ${fadeUp} 0.28s ease both;
`;
const ThinkRow = styled.div`
  display: flex; align-items: center; gap: 5px; height: 22px;
`;
const ThinkDot = styled.div<{ $d: string }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${color.sage[300]};
  animation: ${dotBlink} 0.9s ease-in-out infinite;
  animation-delay: ${({ $d }) => $d};
`;

const ChatArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 1px; }
`;
const Bubble = styled.div<{ $role: 'user' | 'ai' }>`
  max-width: 88%;
  padding: 11px 14px;
  border-radius: ${({ $role }) => ($role === 'ai' ? '4px 14px 14px 14px' : '14px 4px 14px 14px')};
  background: ${({ $role }) => ($role === 'ai' ? color.white : color.sage[600])};
  border: ${({ $role }) => ($role === 'ai' ? border.thin : 'none')};
  color: ${({ $role }) => ($role === 'ai' ? color.text.body : 'white')};
  font-size: ${ts(17)};
  line-height: 1.55;
  align-self: ${({ $role }) => ($role === 'ai' ? 'flex-start' : 'flex-end')};
  animation: ${fadeUp} 0.22s ease both;
`;
const SttPreview = styled.div`
  align-self: flex-end;
  max-width: 88%;
  padding: 8px 12px;
  border-radius: 13px 4px 13px 13px;
  background: ${color.sage[50]};
  border: 1px dashed ${color.sage[300]};
  font-size: ${ts(15)};
  color: ${color.text.muted};
  font-style: italic;
`;

const MicArea = styled.div`
  flex-shrink: 0;
  padding: 6px 12px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border-top: 1px solid ${color.cream.dark};
  background: ${color.cream.base};
`;
const MicWrap = styled.div`
  position: relative; width: 52px; height: 52px;
  display: flex; align-items: center; justify-content: center;
`;
const Halo = styled.div<{ $delay: string; $rec: boolean }>`
  position: absolute; width: 40px; height: 40px; border-radius: 50%;
  border: 1.5px solid ${({ $rec }) => ($rec ? color.terra.mid : color.sage[400])};
  animation: ${haloExpand} 1.8s ease-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;
const MicBtn = styled.button<{ $rec: boolean; $disabled: boolean }>`
  width: 42px; height: 42px; border-radius: 50%;
  background: ${({ $rec }) => ($rec ? color.terra.base : color.sage[600])};
  border: 2px solid ${({ $rec }) => ($rec ? color.terra.dark : color.sage[700])};
  display: flex; align-items: center; justify-content: center;
  z-index: 2;
  opacity: ${({ $disabled }) => ($disabled ? 0.45 : 1)};
  ${({ $rec }) => $rec && css`animation: ${recPulse} 0.9s ease-in-out infinite;`}
  &:active { transform: scale(0.95); }
`;
const MicHint = styled.div`
  font-size: ${ts(14)};
  color: ${color.text.body};
  text-align: center;
`;
const Disclaimer = styled.div`
  font-size: ${ts(13)};
  color: ${color.text.muted};
  text-align: center;
  padding: 2px 8px;
`;
const Banner = styled.div`
  flex-shrink: 0;
  background: ${color.role.warnBg};
  color: ${color.role.warn};
  font-size: ${ts(15)};
  font-weight: ${font.weight.semiBold};
  padding: 8px 14px;
  text-align: center;
`;
const FinishBtn = styled.button`
  font-size: 12px;
  color: ${color.terra.base};
  text-decoration: underline;
  text-underline-offset: 2px;
`;

const sheetUp = keyframes`from { transform: translateY(100%); } to { transform: translateY(0); }`;
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;

const Backdrop = styled.div`
  position: absolute; inset: 0; z-index: 5;
  background: rgba(20,30,24,0.42);
  animation: ${fadeIn} 0.2s ease both;
`;
const Sheet = styled.div`
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 6;
  background: ${color.white};
  border-radius: 22px 22px 0 0;
  padding: 14px 18px 22px;
  box-shadow: 0 -10px 34px rgba(0,0,0,0.20);
  animation: ${sheetUp} 0.3s cubic-bezier(0.22,1,0.36,1) both;
  display: flex; flex-direction: column; gap: 12px;
`;
const Handle = styled.div`
  width: 42px; height: 4px; border-radius: 2px;
  background: rgba(0,0,0,0.15); align-self: center; margin-bottom: 2px;
`;
const ConsentText = styled.div`
  font-size: ${ts(17)};
  line-height: 1.55;
  color: ${color.text.body};
`;
const ConsentRow = styled.div`
  display: flex;
  gap: 8px;
`;
const ConsentBtn = styled.button<{ $primary?: boolean }>`
  flex: 1;
  min-height: ${touch.min}px;
  padding: 13px 0;
  border-radius: 12px;
  font-size: ${ts(17)};
  font-weight: ${font.weight.bold};
  background: ${({ $primary }) => ($primary ? color.sage[600] : color.white)};
  color: ${({ $primary }) => ($primary ? 'white' : color.ink[500])};
  border: ${({ $primary }) => ($primary ? 'none' : `1px solid ${color.cream.dark}`)};
  &:active { transform: scale(0.98); }
`;

export default function ConversationView() {
  const { ws } = useCompanion();
  const {
    chatMode,
    liveDoctorState,
    liveMessages,
    liveTurnCount,
    currentSTT,
    isRecording,
    wsConnected,
    triageSuggested,
    liveReport,
    companionTextScale,
    cycleCompanionTextScale,
    escalationReason,
  } = useAppStore();
  const scaleLabel = companionTextScale >= 1.3 ? '더 큼' : companionTextScale >= 1.15 ? '큼' : '보통';

  const bottomRef = useRef<HTMLDivElement>(null);
  const isTriage = chatMode === 'triage';
  // 서버가 끊겼을 때 마이크를 막아 사용자가 허공에 말하는 상황을 방지한다.
  // 자동 재연결(3s)되면 자연스럽게 다시 사용 가능.
  const canRecord = liveDoctorState === 'idle' && !isRecording && wsConnected;
  const isThinking = liveDoctorState === 'thinking';
  const isSpeaking = liveDoctorState === 'speaking';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages, currentSTT]);

  // 토글 방식: 한 번 누르면 녹음 시작, 다시 누르면 전송.
  const handleToggleMic = async () => {
    if (isRecording) {
      ws.stopRecording();
    } else if (canRecord) {
      await ws.startRecording();
    }
  };

  const handleFinish = () => {
    // 서버가 상담을 정리해 report_ready로 리포트를 보내준다(ConversationView가 시트로 표시).
    ws.finishEarly();
  };

  const lastAiMsg = [...liveMessages].reverse().find((m) => m.role === 'ai');
  // 아바타 말풍선이 '최신 AI 발화'를 보여주므로, 채팅 이력에선 중복 제거.
  const lastMsg = liveMessages[liveMessages.length - 1];
  const historyMsgs = lastMsg && lastMsg.role === 'ai' ? liveMessages.slice(0, -1) : liveMessages;
  const pct = Math.min((liveTurnCount / MAX_TURNS) * 100, 100);
  const defaultGreeting = isTriage
    ? '말씀하신 내용을 좀 더 여쭤볼게요. 편하게 답해 주세요.'
    : '안녕하세요, 메디예요. 오늘은 어떻게 지내셨어요?';

  return (
    <Screen>
      <TopBar $triage={isTriage}>
        <TopLabel>{isTriage ? '메디 · 건강 상담' : '메디 · 말동무'}</TopLabel>
        <TopRight>
          <TextSizeBtn onClick={cycleCompanionTextScale} aria-label={`글자 크기: ${scaleLabel}`} title="글자 크기">
            <span className="sm">가</span><span className="lg">가</span>
            <span className="lvl">{scaleLabel}</span>
          </TextSizeBtn>
          {isTriage
            ? <TurnBadge>상담 {liveTurnCount}/{MAX_TURNS}회</TurnBadge>
            : <TurnBadge>{wsConnected ? '듣고 있어요' : '연결 중…'}</TurnBadge>}
        </TopRight>
      </TopBar>
      {isTriage && <ProgressWrap><ProgressFill $pct={pct} /></ProgressWrap>}
      {isTriage && escalationReason && (
        <Banner>건강 신호가 조금 걱정돼 잠깐 여쭤보고 있어요</Banner>
      )}

      <AvatarPanel $triage={isTriage}>
        <VirtualDoctor state={liveDoctorState} size={76} showHalo={false} />
        <AvatarName>메디</AvatarName>
        {isThinking ? (
          <ThinkRow><ThinkDot $d="0s" /><ThinkDot $d="0.18s" /><ThinkDot $d="0.36s" /></ThinkRow>
        ) : (
          <SpeechBubble key={lastAiMsg?.timestamp ?? 0}>
            {lastAiMsg?.text ?? defaultGreeting}
          </SpeechBubble>
        )}
      </AvatarPanel>

      <ChatArea>
        {historyMsgs.map((m) => (
          <Bubble key={m.timestamp} $role={m.role}>{m.text}</Bubble>
        ))}
        {currentSTT && <SttPreview>{currentSTT}...</SttPreview>}
        <div ref={bottomRef} />
      </ChatArea>

      {isTriage && liveReport && (
        <>
          <Backdrop />
          <Sheet>
            <Handle />
            <ConsentText>
              오늘 들려주신 이야기 잘 정리해서 <b>남해보건소 선생님</b>께 전해드렸어요.
              걱정 마시고 편히 쉬세요.
            </ConsentText>
            <ConsentRow>
              <ConsentBtn $primary onClick={() => ws.setMode('companion')}>
                일상 대화로 돌아가기
              </ConsentBtn>
            </ConsentRow>
          </Sheet>
        </>
      )}

      {!isTriage && triageSuggested && (
        <>
          <Backdrop />
          <Sheet>
            <Handle />
            <ConsentText>요즘 건강이 조금 신경 쓰여요. 잠깐 몇 가지 여쭤봐도 될까요?</ConsentText>
            <ConsentRow>
              <ConsentBtn $primary onClick={() => ws.consentTriage()}>네, 여쭤보세요</ConsentBtn>
              <ConsentBtn onClick={() => {
                ws.declineTriage();
                useAppStore.getState().setTriageSuggested(false);
              }}>괜찮아요</ConsentBtn>
            </ConsentRow>
          </Sheet>
        </>
      )}

      <MicArea>
        <MicWrap>
          {!isThinking && !isSpeaking && !isRecording && (
            <>
              <Halo $delay="0s" $rec={isRecording} />
              <Halo $delay="0.85s" $rec={isRecording} />
            </>
          )}
          <MicBtn
            $rec={isRecording}
            $disabled={isThinking || isSpeaking || !wsConnected}
            onClick={handleToggleMic}
            aria-label={isRecording ? '전송하기' : '말하기 시작'}
            aria-disabled={!canRecord}
          >
            <MicIcon size={20} color="white" />
          </MicBtn>
        </MicWrap>

        <MicHint>
          {!wsConnected
            ? '메디가 잠시 자리를 비웠어요 — 곧 돌아와요'
            : isRecording
            ? '듣고 있어요 — 다시 누르면 전송해요'
            : isThinking
            ? '메디가 생각하고 있어요...'
            : isSpeaking
            ? '메디가 이야기하고 있어요...'
            : isTriage
            ? '버튼을 눌러 답하시고, 다 하셨으면 다시 눌러주세요'
            : '버튼을 눌러 말씀하시고, 다 하셨으면 다시 눌러주세요'}
        </MicHint>

        {isTriage && liveTurnCount >= 2 && !isRecording && liveDoctorState === 'idle' && (
          <FinishBtn onClick={handleFinish}>지금 상담 정리하기</FinishBtn>
        )}

        <Disclaimer>참고용이에요 · 진단은 보건소 선생님이 하세요</Disclaimer>
      </MicArea>
    </Screen>
  );
}
