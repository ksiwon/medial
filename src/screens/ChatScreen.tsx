// src/screens/ChatScreen.tsx
import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { EyeIcon, CameraIcon, MicIcon } from '../components/icons';
import AvatarFace from '../components/phone/AvatarFace';
import OptionButton from '../components/phone/OptionButton';
import { useAppStore } from '../store/useAppStore';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const AnalysisBanner = styled.div`
  padding: 6px 12px;
  background: ${color.yellowDim};
  border-bottom: 1px solid ${color.yellow}33;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  animation: ${fadeIn} 0.3s ease;
`;

const BannerText = styled.span`
  font-size: 10px;
  color: ${color.yellow};
  font-weight: ${font.weight.semiBold};
  flex: 1;
`;

const PrevBanner = styled.div`
  padding: 5px 12px;
  background: ${color.sage[50]};
  border-bottom: ${border.thin};
  font-size: 10px;
  color: ${color.sage[600]};
  font-weight: ${font.weight.medium};
  text-align: center;
  flex-shrink: 0;
`;

const AvatarZone = styled.div`
  flex-shrink: 0;
  background: ${color.sage[50]};
  border-bottom: ${border.thin};
`;

const DialogueArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &::-webkit-scrollbar { width: 2px; }
  &::-webkit-scrollbar-thumb { background: ${color.sage[200]}; border-radius: 1px; }
`;

const AiTurn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: ${fadeIn} 0.25s ease;
`;

const EmpathyLine = styled.div`
  font-size: 10px;
  color: ${color.sage[500]};
  font-weight: ${font.weight.medium};
  padding-left: 1px;
  display: flex;
  align-items: center;
  gap: 4px;

  &::before {
    content: '';
    display: block;
    width: 2px;
    height: 10px;
    background: ${color.sage[300]};
    border-radius: 1px;
    flex-shrink: 0;
  }
`;

const AiMsg = styled.div`
  font-size: ${font.size.appLg};
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
  line-height: 1.45;
`;

const UserTurn = styled.div`
  align-self: flex-end;
  padding: 8px 12px;
  background: ${color.sage[600]};
  border-radius: ${radius.lg} ${radius.lg} ${radius.sm} ${radius.lg};
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.medium};
  color: white;
  max-width: 82%;
  animation: ${fadeIn} 0.2s ease;
  line-height: 1.4;
`;

const OptionsWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
`;

const CameraPrompt = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 13px;
  border-radius: ${radius.lg};
  border: ${border.mid};
  border-left: 3px solid ${color.sage[400]};
  background: ${color.white};
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[700]};
  cursor: pointer;
  margin-top: 6px;
  animation: ${fadeIn} 0.3s ease;
  text-align: left;
  line-height: 1.3;
  transition: background 0.1s;
  width: 100%;

  &:active { background: ${color.cream.base}; }
`;

const CameraPromptSub = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.regular};
  color: ${color.ink[300]};
  margin-top: 1px;
`;

const BottomBar = styled.div`
  flex-shrink: 0;
  padding: 10px 14px 12px;
  border-top: ${border.thin};
  background: ${color.white};
  display: flex;
  align-items: center;
  gap: 10px;
`;

const MicHint = styled.div`
  flex: 1;
  font-size: 10px;
  color: ${color.ink[300]};
  text-align: center;
`;

const ListeningToast = styled.div`
  position: absolute;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  background: ${color.sage[700]};
  color: white;
  font-size: 11px;
  font-weight: ${font.weight.semiBold};
  padding: 6px 14px;
  border-radius: ${radius.xxl};
  white-space: nowrap;
  pointer-events: none;
  animation: ${fadeIn} 0.2s ease;
  z-index: 20;
`;

const micPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(54,99,72,0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(54,99,72,0); }
`;

const MicSmallBtn = styled.button<{ $active: boolean }>`
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: ${({ $active }) => $active ? color.sage[600] : color.sage[50]};
  border: ${border.mid};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
  animation: ${({ $active }) => $active ? micPulse : 'none'} 1s ease-in-out infinite;
  cursor: pointer;

  &:active { background: ${color.sage[100]}; }
`;

export default function ChatScreen() {
  const {
    getCurrentCase,
    prevConvIndex,
    dialogueIndex,
    incrementDialogueIndex,
    setCurrentScreen,
    showFaceAnalysis,
    showEmpathy,
  } = useAppStore();

  const caseData = getCurrentCase();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMicPress = () => {
    if (micActive) {
      // 중지: 타이머 취소
      setMicActive(false);
      if (micTimerRef.current) clearTimeout(micTimerRef.current);
      return;
    }
    setMicActive(true);
    if (micTimerRef.current) clearTimeout(micTimerRef.current);

    // 1.8초 후: 현재 AI 턴의 첫 번째 옵션을 자동 선택
    micTimerRef.current = setTimeout(() => {
      setMicActive(false);
      const curr = dialogue[dialogueIndex];
      if (curr?.speaker === 'ai' && curr.options?.length) {
        handleOptionSelect(curr.options[0], curr.nextScreenOnSelect);
      }
    }, 1800);
  };

  const dialogue = (prevConvIndex !== null &&
    caseData.prevConversations[prevConvIndex]?.followUpDialogue?.length)
    ? caseData.prevConversations[prevConvIndex].followUpDialogue
    : caseData.dialogue;

  const shown = dialogue.slice(0, dialogueIndex + 1);
  const current = dialogue[dialogueIndex];

  // ─── 핵심 대화 진행 로직 ────────────────────────────────────
  useEffect(() => {
    // 이전 타이머 항상 초기화
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!current) return;

    if (current.speaker === 'ai') {
      setSpeaking(true);

      timerRef.current = setTimeout(() => {
        setSpeaking(false);

        // 사용자 입력이 필요한 경우: options 또는 triggerPhotoCapture
        const needsUserInput = !!(current.options || current.triggerPhotoCapture);

        if (!needsUserInput && dialogueIndex < dialogue.length - 1) {
          // 입력 불필요 → 자동으로 다음 턴
          timerRef.current = setTimeout(() => incrementDialogueIndex(), 400);
        }
        // 입력 필요한 경우 → 사용자 선택 대기
      }, 1200);

    } else {
      // 사용자 턴: 잠깐 보여준 뒤 자동으로 다음 AI 턴으로 이동
      setSpeaking(false);
      if (dialogueIndex < dialogue.length - 1) {
        timerRef.current = setTimeout(() => incrementDialogueIndex(), 500);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogueIndex, caseData.id]);

  // 스크롤
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [dialogueIndex, selectedOption]);

  // ─── 옵션 선택 핸들러 ──────────────────────────────────────
  const handleOptionSelect = (opt: string, nextScreen?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current); // 진행 중 타이머 취소
    setSelectedOption(opt);
    setSpeaking(false);

    setTimeout(() => {
      setSelectedOption(null);
      if (nextScreen) {
        // 화면 전환이 있는 경우: 인덱스 증가 없이 바로 전환
        setCurrentScreen(nextScreen as any);
      } else {
        // 화면 전환 없는 경우: 다음 턴으로
        incrementDialogueIndex();
      }
    }, 650);
  };

  // 표정 분석 배너: 가장 최근 AI 턴의 faceAnalysis 사용
  const faceAnalysis = [...shown]
    .reverse()
    .find((t) => t.speaker === 'ai' && t.faceAnalysis)?.faceAnalysis;

  const isPrevConv = prevConvIndex !== null;
  const prevConvData = isPrevConv ? caseData.prevConversations[prevConvIndex] : null;

  return (
    <Screen>
      {/* 표정·음성 분석 배너 */}
      {showFaceAnalysis && faceAnalysis && (
        <AnalysisBanner>
          <EyeIcon size={11} color={color.yellow} />
          <BannerText>{faceAnalysis}</BannerText>
        </AnalysisBanner>
      )}

      {isPrevConv && prevConvData && (
        <PrevBanner>
          {prevConvData.daysAgo}일 전 대화 기록 — {prevConvData.date}
        </PrevBanner>
      )}

      {/* 아바타 */}
      <AvatarZone>
        <AvatarFace speaking={speaking} />
      </AvatarZone>

      {/* 대화 스크롤 영역 */}
      <DialogueArea ref={scrollRef}>
        {shown.map((turn) => {
          if (turn.speaker === 'ai') {
            const isLast = turn.id === current?.id;
            return (
              <AiTurn key={turn.id}>
                {showEmpathy && turn.empathy && (
                  <EmpathyLine>{turn.empathy}</EmpathyLine>
                )}
                <AiMsg>{turn.message}</AiMsg>

                {/* 선택지: 마지막 AI 턴 + 옵션 있음 + 아직 선택 안 함 */}
                {isLast && !selectedOption && turn.options && (
                  <OptionsWrap>
                    {turn.options.map((opt) => (
                      <OptionButton
                        key={opt}
                        label={opt}
                        selected={false}
                        onClick={() => handleOptionSelect(opt, turn.nextScreenOnSelect)}
                      />
                    ))}
                  </OptionsWrap>
                )}

                {/* 카메라 촬영 유도: 마지막 AI 턴 + triggerPhotoCapture */}
                {isLast && !selectedOption && turn.triggerPhotoCapture && (
                  <CameraPrompt onClick={() => setCurrentScreen('photo')}>
                    <CameraIcon size={18} color={color.sage[600]} />
                    <div>
                      <div>사진으로 보여주기</div>
                      <CameraPromptSub>상처 또는 약 봉투를 촬영할 수 있어요</CameraPromptSub>
                    </div>
                  </CameraPrompt>
                )}
              </AiTurn>
            );
          }
          // 사용자 턴
          return <UserTurn key={turn.id}>{turn.message}</UserTurn>;
        })}

        {/* 방금 선택한 옵션 (애니메이션용 임시 표시) */}
        {selectedOption && <UserTurn>{selectedOption}</UserTurn>}
      </DialogueArea>

      {/* 하단 마이크 바 */}
      <BottomBar style={{ position: 'relative' }}>
        {micActive && (
          <ListeningToast>듣고 있어요...</ListeningToast>
        )}
        <MicSmallBtn
          $active={micActive}
          aria-label={micActive ? '녹음 중지' : '음성 입력'}
          onClick={handleMicPress}
        >
          <MicIcon size={16} color={micActive ? 'white' : color.sage[600]} />
        </MicSmallBtn>
        <MicHint>
          {micActive ? '말씀하세요 — 탭하면 중지' : '버튼을 눌러 선택하거나 음성으로 답하세요'}
        </MicHint>
      </BottomBar>
    </Screen>
  );
}
