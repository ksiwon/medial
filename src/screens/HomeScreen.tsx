// src/screens/HomeScreen.tsx
import { useState } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { color, font, radius, border, shadow } from '../styles/tokens';
import { MicIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

/* ── 애니메이션 ─────────────────────────────────────── */
const haloExpand = keyframes`
  0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.35; }
  100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
`;

const micPulse = keyframes`
  0%, 100% { box-shadow: 0 2px 6px rgba(54,99,72,0.20); }
  50%       { box-shadow: 0 4px 18px rgba(54,99,72,0.36); }
`;

const recPulse = keyframes`
  0%, 100% { box-shadow: 0 2px 6px rgba(176,48,32,0.22); }
  50%       { box-shadow: 0 4px 16px rgba(176,48,32,0.40); }
`;

const dotBlink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.15; }
`;

const floatIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ── 레이아웃 ──────────────────────────────────────── */
const Screen = styled.div`
  min-height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const PosterZone = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px 6px;
  position: relative;
  min-height: 0;
`;

/* ── 의사 초상 ──────────────────────────────────── */
const PortraitWrap = styled.div`
  position: relative;
  flex-shrink: 0;
`;

const PortraitPaper = styled.div`
  width: 172px;
  height: 210px;
  background: ${color.cream.base};
  border-radius: ${radius.portrait};
  border: 2px solid rgba(54,99,72,0.18);
  position: relative;
  overflow: visible;
  box-shadow: ${shadow.card};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
`;

const Corner = styled.div<{ $pos: 'tl'|'tr'|'bl'|'br' }>`
  position: absolute;
  width: 11px;
  height: 11px;
  border-color: rgba(54,99,72,0.32);
  border-style: solid;
  border-width: 0;
  ${({ $pos }) => {
    switch ($pos) {
      case 'tl': return 'top:6px;left:6px;border-top-width:1.5px;border-left-width:1.5px;border-radius:1px 0 0 0;';
      case 'tr': return 'top:6px;right:6px;border-top-width:1.5px;border-right-width:1.5px;border-radius:0 1px 0 0;';
      case 'bl': return 'bottom:6px;left:6px;border-bottom-width:1.5px;border-left-width:1.5px;border-radius:0 0 0 1px;';
      case 'br': return 'bottom:6px;right:6px;border-bottom-width:1.5px;border-right-width:1.5px;border-radius:0 0 1px 0;';
    }
  }}
`;

function BigDoctorSvg() {
  const c = color;
  return (
    <svg viewBox="0 0 172 185" width="172" height="185" style={{ display: 'block' }}>
      {/* 머리캡 */}
      <ellipse cx="86" cy="28" rx="32" ry="20" fill={c.sage[600]} />
      <rect x="54" y="28" width="64" height="9" fill={c.sage[700]} rx="2" />
      <line x1="86" y1="9" x2="86" y2="18" stroke={c.sage[400]} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="65" y1="13" x2="69" y2="21" stroke={c.sage[400]} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="107" y1="13" x2="103" y2="21" stroke={c.sage[400]} strokeWidth="1.5" strokeLinecap="round" />

      {/* 얼굴 */}
      <ellipse cx="86" cy="56" rx="27" ry="27" fill="#F5D5BA" />

      {/* 볼 */}
      <ellipse cx="67" cy="63" rx="8" ry="4.5" fill="#E8A090" opacity="0.22" />
      <ellipse cx="105" cy="63" rx="8" ry="4.5" fill="#E8A090" opacity="0.22" />

      {/* 눈썹 */}
      <path d="M 71 44 Q 77 41 83 42" stroke={c.ink[700]} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 89 42 Q 95 41 101 44" stroke={c.ink[700]} strokeWidth="1.6" fill="none" strokeLinecap="round" />

      {/* 눈 */}
      <ellipse cx="77" cy="51" rx="5.5" ry="4.5" fill="white" />
      <ellipse cx="77" cy="52" rx="3" ry="3" fill={c.ink[900]} />
      <ellipse cx="78.5" cy="50.5" rx="1" ry="1" fill="white" />
      <ellipse cx="95" cy="51" rx="5.5" ry="4.5" fill="white" />
      <ellipse cx="95" cy="52" rx="3" ry="3" fill={c.ink[900]} />
      <ellipse cx="96.5" cy="50.5" rx="1" ry="1" fill="white" />

      {/* 안경 */}
      <circle cx="77" cy="51" r="7.5" fill="none" stroke={c.ink[700]} strokeWidth="1.4" />
      <circle cx="95" cy="51" r="7.5" fill="none" stroke={c.ink[700]} strokeWidth="1.4" />
      <line x1="84.5" y1="51" x2="87.5" y2="51" stroke={c.ink[700]} strokeWidth="1.4" />
      <line x1="69.5" y1="49" x2="61" y2="46" stroke={c.ink[700]} strokeWidth="1.4" />
      <line x1="102.5" y1="49" x2="111" y2="46" stroke={c.ink[700]} strokeWidth="1.4" />

      {/* 코 */}
      <ellipse cx="86" cy="61" rx="2.5" ry="1.8" fill="#D4A080" />

      {/* 입 — 미소 */}
      <path d="M 79 69 Q 86 75 93 69" stroke="#C4845A" strokeWidth="1.6" fill="none" strokeLinecap="round" />

      {/* 목 */}
      <rect x="80" y="82" width="12" height="12" fill="#F0C8A0" rx="2.5" />

      {/* 흰 가운 */}
      <path d="M 22 185 L 18 108 Q 20 96 42 92 L 60 88 L 86 95 L 112 88 L 130 92 Q 152 96 154 108 L 150 185 Z"
        fill="white" />
      <path d="M 22 185 L 18 108 Q 20 96 42 92 L 60 88 L 86 95 L 112 88 L 130 92 Q 152 96 154 108 L 150 185 Z"
        fill="none" stroke={c.sage[100]} strokeWidth="1" />

      {/* 여밈선 */}
      <line x1="86" y1="100" x2="86" y2="185" stroke={c.sage[200]} strokeWidth="1" strokeDasharray="3.5,3.5" />

      {/* 십자 뱃지 */}
      <rect x="48" y="108" width="20" height="20" fill={c.terra.mid} rx="4" />
      <rect x="55" y="110.5" width="6" height="15" fill="white" rx="1.5" />
      <rect x="49" y="115.5" width="18" height="5" fill="white" rx="1.5" />

      {/* 청진기 */}
      <path d="M 82 98 L 73 116 A 5 5 0 0 0 69 123" fill="none" stroke={c.ink[300]} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M 90 98 L 99 116 A 5 5 0 0 1 103 123" fill="none" stroke={c.ink[300]} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="69" y1="123" x2="103" y2="123" stroke={c.ink[300]} strokeWidth="1.8" />
      <circle cx="86" cy="127" r="3.5" fill={c.ink[500]} />

      {/* 소매 */}
      <path d="M 18 108 L 7 124 L 10 145 L 26 145" fill={c.cream.mid} stroke={c.cream.dark} strokeWidth="0.8" />
      <path d="M 154 108 L 165 124 L 162 145 L 146 145" fill={c.cream.mid} stroke={c.cream.dark} strokeWidth="0.8" />

      {/* 주머니 */}
      <rect x="118" y="136" width="16" height="12" fill={c.cream.mid} rx="2" stroke={c.cream.dark} strokeWidth="0.8" />
    </svg>
  );
}

/* ── 이름판 ──────────────────────────────────────── */
const NamePlate = styled.div`
  width: 100%;
  background: ${color.sage[700]};
  padding: 5px 10px;
  border-radius: 0 0 12px 12px;
  text-align: center;
  flex-shrink: 0;
`;

const NameMain = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: white;
  letter-spacing: 0.05em;
`;

const NameSub = styled.div`
  font-size: 8.5px;
  color: ${color.sage[200]};
  margin-top: 1px;
  font-family: ${font.mono};
`;

/* ── 차트 캡션 ──────────────────────────────────── */
const ChartCaption = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: ${color.ink[300]};
  letter-spacing: 0.04em;
  margin-top: 5px;
`;

/* ── 포스트카드 ──────────────────────────────────── */
const Postcard = styled.div`
  margin: 7px 0 5px;
  width: 100%;
  background: ${color.amber.pale};
  border: ${border.amber};
  border-radius: ${radius.xxl};
  padding: 9px 12px 10px;
  position: relative;
  animation: ${floatIn} 0.35s ease both;
`;

const PostcardStamp = styled.div`
  position: absolute;
  top: -1px;
  right: 10px;
  background: ${color.amber.base};
  color: white;
  font-size: 7.5px;
  font-weight: ${font.weight.bold};
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 0 0 4px 4px;
`;

const PostcardPrev = styled.div`
  font-size: 10.5px;
  color: ${color.ink[500]};
  line-height: 1.5;
  margin-bottom: 3px;
  font-style: italic;
`;

const PostcardQ = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
`;

/* ── 큰 마이크 CTA ──────────────────────────────── */
const MicArea = styled.div`
  padding: 2px 0 8px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

const MicBtnWrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
`;

const MicHalo = styled.div<{ $delay: string; $recording?: boolean }>`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: 1.5px solid ${({ $recording }) => $recording ? color.terra.mid : color.sage[400]};
  animation: ${haloExpand} 2s ease-out infinite;
  animation-delay: ${({ $delay }) => $delay};
  pointer-events: none;
`;

const MicBtn = styled.button<{ $recording?: boolean }>`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: ${({ $recording }) => $recording ? color.terra.base : color.sage[600]};
  border: 2.5px solid ${({ $recording }) => $recording ? color.terra.dark : color.sage[700]};
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 2;
  animation: ${({ $recording }) =>
    $recording ? css`${recPulse} 1s ease-in-out infinite` : css`${micPulse} 2.4s ease-in-out infinite`};
  transition: background 0.25s, border-color 0.25s;
  &:active { transform: scale(0.93); }
`;

const RecRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`;

const RecDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${color.terra.base};
  animation: ${dotBlink} 0.9s ease-in-out infinite;
`;

const MicHint = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
`;

/* ── 이전 대화 기록 ──────────────────────────────── */
const HistorySection = styled.div`
  border-top: 1px solid ${color.cream.mid};
  flex-shrink: 0;
`;

const HistoryHead = styled.div`
  padding: 7px 16px 3px;
`;

const HistoryLabel = styled.span`
  font-size: 9.5px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[300]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-family: ${font.mono};
`;

const ConvList = styled.div`
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const ConvItem = styled.button<{ $urgent: boolean }>`
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  background: ${color.white};
  border: ${border.thin};
  border-left: 2.5px solid ${({ $urgent }) => $urgent ? color.terra.base : color.sage[300]};
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  animation: ${fadeUp} 0.22s ease both;
  &:active { background: ${color.cream.base}; }
`;

const ConvTitle = styled.div`
  font-size: 11px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ConvSub = styled.div`
  font-size: 9.5px;
  color: ${color.ink[300]};
  white-space: nowrap;
`;

const ConvDate = styled.div`
  font-family: ${font.mono};
  font-size: 9px;
  color: ${color.ink[100]};
  flex-shrink: 0;
`;

const UrgentDot = styled.div`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${color.terra.base};
  flex-shrink: 0;
`;

/* ── 이전 상담 요약 모달 ─────────────────────────── */
const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(15,26,18,0.55);
  z-index: 20;
  display: flex;
  align-items: flex-end;
`;

const SummarySheet = styled.div`
  width: 100%;
  background: ${color.white};
  border-radius: 16px 16px 0 0;
  padding: 16px 16px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: ${floatIn} 0.22s ease both;
`;

const SheetHandle = styled.div`
  width: 36px;
  height: 4px;
  background: ${color.cream.dark};
  border-radius: 2px;
  align-self: center;
  margin-bottom: 2px;
`;

const SheetMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SheetDateTag = styled.div`
  font-family: ${font.mono};
  font-size: 9.5px;
  color: ${color.ink[300]};
  background: ${color.cream.base};
  padding: 2px 8px;
  border-radius: 4px;
`;

const UrgentTag = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.semiBold};
  color: ${color.terra.base};
  background: ${color.terra.pale};
  padding: 2px 8px;
  border-radius: 4px;
`;

const SheetTitle = styled.div`
  font-size: 15px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
  line-height: 1.35;
`;

const SheetSub = styled.div`
  font-size: 12px;
  color: ${color.ink[500]};
  line-height: 1.55;
  padding: 8px 12px;
  background: ${color.cream.light};
  border-radius: 8px;
  border-left: 2.5px solid ${color.sage[300]};
`;

const SheetBtns = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
`;

const ContinueBtn = styled.button`
  width: 100%;
  padding: 12px;
  background: ${color.sage[600]};
  border: 2px solid ${color.sage[700]};
  border-radius: 10px;
  font-size: 14px;
  font-weight: ${font.weight.semiBold};
  color: white;
  box-shadow: ${shadow.cta};
  transition: background 0.12s;
  &:active { background: ${color.sage[700]}; transform: scale(0.98); }
`;

const CloseBtn = styled.button`
  width: 100%;
  padding: 10px;
  background: transparent;
  border: ${border.thin};
  border-radius: 8px;
  font-size: 13px;
  color: ${color.ink[300]};
  transition: background 0.12s;
  &:active { background: ${color.cream.base}; }
`;

/* ── 컴포넌트 ──────────────────────────────────── */
export default function HomeScreen() {
  const { getCurrentCase, setCurrentScreen, startFromConversation, resetDialogue } = useAppStore();
  const caseData = getCurrentCase();
  const { patient, prevConversations } = caseData;
  const [recording, setRecording] = useState(false);
  const [selectedConvIdx, setSelectedConvIdx] = useState<number | null>(null);

  const handleMicPress = () => {
    if (recording) return;
    setRecording(true);
    setTimeout(() => {
      resetDialogue();
      setCurrentScreen('chat');
    }, 1400);
  };

  const prevConv = prevConversations[0];

  return (
    <Screen>
      <PosterZone>
        <PortraitWrap>
          <PortraitPaper>
            <Corner $pos="tl" />
            <Corner $pos="tr" />
            <Corner $pos="bl" />
            <Corner $pos="br" />
            <BigDoctorSvg />
            <NamePlate>
              <NameMain>MEDIAL · 닥터 메디</NameMain>
              <NameSub>전담의 {patient.sessionCount}회차</NameSub>
            </NamePlate>
          </PortraitPaper>
        </PortraitWrap>

        <ChartCaption>FOR {patient.name} 어르신 {patient.age}세 · {patient.gender}</ChartCaption>

        <Postcard>
          <PostcardStamp>오늘의 안부</PostcardStamp>
          {prevConv && (
            <PostcardPrev>"{prevConv.title}" 이후...</PostcardPrev>
          )}
          <PostcardQ>오늘은 좀 어떠세요?</PostcardQ>
        </Postcard>

        <MicArea>
          <MicBtnWrap>
            {!recording && <MicHalo $delay="0s" />}
            {!recording && <MicHalo $delay="0.85s" />}
            {recording && <MicHalo $delay="0s" $recording />}
            {recording && <MicHalo $delay="0.6s" $recording />}
            <MicBtn
              $recording={recording}
              onClick={handleMicPress}
              aria-label={recording ? '녹음 중' : '음성 상담 시작'}
            >
              <MicIcon size={24} color="white" />
            </MicBtn>
          </MicBtnWrap>
          {recording ? (
            <RecRow>
              <RecDot />
              <MicHint style={{ color: color.terra.base }}>듣고 있어요...</MicHint>
            </RecRow>
          ) : (
            <MicHint>눌러서 말씀해 주세요</MicHint>
          )}
        </MicArea>
      </PosterZone>

      <HistorySection>
        <HistoryHead>
          <HistoryLabel>이전 상담</HistoryLabel>
        </HistoryHead>
        <ConvList>
          {prevConversations.map((conv, i) => (
            <ConvItem
              key={i}
              $urgent={conv.urgent}
              onClick={() => setSelectedConvIdx(i)}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              {conv.urgent && <UrgentDot />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <ConvTitle>{conv.title}</ConvTitle>
                <ConvSub>{conv.subtitle}</ConvSub>
              </div>
              <ConvDate>{conv.date}</ConvDate>
            </ConvItem>
          ))}
        </ConvList>
      </HistorySection>

      {/* ── 이전 상담 요약 모달 ── */}
      {selectedConvIdx !== null && (() => {
        const conv = prevConversations[selectedConvIdx];
        return (
          <Backdrop onClick={() => setSelectedConvIdx(null)}>
            <SummarySheet onClick={e => e.stopPropagation()}>
              <SheetHandle />
              <SheetMeta>
                <SheetDateTag>{conv.daysAgo === 0 ? '오늘' : `${conv.daysAgo}일 전`} · {conv.date}</SheetDateTag>
                {conv.urgent && <UrgentTag>주의 필요</UrgentTag>}
              </SheetMeta>
              <SheetTitle>{conv.title}</SheetTitle>
              <SheetSub>{conv.subtitle}</SheetSub>
              <SheetBtns>
                <ContinueBtn onClick={() => { startFromConversation(selectedConvIdx); setSelectedConvIdx(null); }}>
                  이 상담 이어서 보기
                </ContinueBtn>
                <CloseBtn onClick={() => setSelectedConvIdx(null)}>닫기</CloseBtn>
              </SheetBtns>
            </SummarySheet>
          </Backdrop>
        );
      })()}
    </Screen>
  );
}
