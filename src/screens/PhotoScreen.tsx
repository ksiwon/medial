// src/screens/PhotoScreen.tsx
import { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, border, shadow } from '../styles/tokens';
import VirtualDoctor from '../components/phone/VirtualDoctor';
import { useAppStore } from '../store/useAppStore';

const scanLine = keyframes`
  0%   { top: 12%; }
  100% { top: 80%; }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const itemIn = keyframes`
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
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
  padding: 7px 14px;
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

const ModeTag = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.amber.dark};
  background: ${color.amber.pale};
  border: ${border.amber};
  padding: 2px 8px;
  border-radius: 4px;
  font-family: ${font.mono};
`;

/* ── 뷰파인더 영역 ──────────────────────────────── */
const ViewfinderArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  gap: 12px;
  min-height: 0;
`;

const Viewfinder = styled.div`
  width: 100%;
  aspect-ratio: 4/3;
  background: #111;
  border-radius: 10px;
  position: relative;
  overflow: hidden;
  max-height: 170px;
  box-shadow: ${shadow.float};
`;

const VFCorner = styled.div<{ $pos: 'tl'|'tr'|'bl'|'br' }>`
  position: absolute;
  width: 20px;
  height: 20px;
  border-color: ${color.amber.base};
  border-style: solid;
  border-width: 0;
  ${({ $pos }) => {
    switch ($pos) {
      case 'tl': return 'top:10px;left:10px;border-top-width:2.5px;border-left-width:2.5px;border-radius:3px 0 0 0;';
      case 'tr': return 'top:10px;right:10px;border-top-width:2.5px;border-right-width:2.5px;border-radius:0 3px 0 0;';
      case 'bl': return 'bottom:10px;left:10px;border-bottom-width:2.5px;border-left-width:2.5px;border-radius:0 0 0 3px;';
      case 'br': return 'bottom:10px;right:10px;border-bottom-width:2.5px;border-right-width:2.5px;border-radius:0 0 3px 0;';
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
  opacity: 0.75;
`;

const VFHint = styled.div`
  position: absolute;
  bottom: 10px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  color: rgba(255,255,255,0.45);
  font-family: ${font.mono};
  letter-spacing: 0.04em;
`;

const ShootBtn = styled.button`
  width: 100%;
  padding: 13px;
  background: ${color.amber.base};
  border: 2px solid ${color.amber.dark};
  border-radius: 10px;
  font-size: 14px;
  font-weight: ${font.weight.bold};
  color: white;
  box-shadow: 0 2px 8px rgba(181,133,62,0.32);
  &:active { transform: scale(0.98); }
`;

const SkipBtn = styled.button`
  font-size: 11px;
  color: ${color.ink[300]};
  text-decoration: underline;
  text-underline-offset: 2px;
`;

/* ── 결과 카드 목록 ──────────────────────────────── */
const ResultList = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: ${fadeIn} 0.3s ease both;
`;

const ResultItem = styled.div<{ $tag: 'ok'|'warn'|'conflict'; $delay: number }>`
  padding: 10px 12px;
  border-radius: 8px;
  background: ${color.white};
  border: ${border.thin};
  border-left: 3px solid ${({ $tag }) =>
    $tag === 'ok' ? color.sage[400] :
    $tag === 'warn' ? color.amber.base : color.terra.base};
  animation: ${itemIn} 0.25s ease ${({ $delay }) => $delay * 0.1}s both;
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
`;

const TagBadge = styled.div<{ $tag: 'ok'|'warn'|'conflict' }>`
  font-size: 9px;
  font-weight: ${font.weight.bold};
  font-family: ${font.mono};
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.04em;
  background: ${({ $tag }) =>
    $tag === 'ok' ? color.sage[50] :
    $tag === 'warn' ? color.amber.pale : color.terra.pale};
  color: ${({ $tag }) =>
    $tag === 'ok' ? color.sage[600] :
    $tag === 'warn' ? color.amber.dark : color.terra.base};
`;

const ResultLabel = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
`;

const ResultDesc = styled.div`
  font-size: 11px;
  color: ${color.ink[300]};
  line-height: 1.5;
`;

const ConfirmBtn = styled.button`
  width: 100%;
  padding: 12px;
  background: ${color.sage[600]};
  border: 2px solid ${color.sage[700]};
  border-radius: 10px;
  font-size: 13px;
  font-weight: ${font.weight.bold};
  color: white;
  box-shadow: ${shadow.cta};
  animation: ${fadeIn} 0.3s ease 0.5s both;
  &:active { transform: scale(0.98); }
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
`;

const DoctorLabel = styled.div`
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${color.ink[100]};
  margin-top: 3px;
`;

/* ── 컴포넌트 ─────────────────────────────────────── */
const TAG_LABEL: Record<string, string> = { ok: 'OK', warn: 'WARN', conflict: 'CONFLICT' };

export default function PhotoScreen() {
  const { getCurrentCase, setCurrentScreen } = useAppStore();
  const caseData = getCurrentCase();
  const [captured, setCaptured] = useState(false);

  const mode = caseData.photoMode;
  const result = caseData.photoResult;

  const doctorMsg = captured
    ? '사진 잘 받았어요. 분석 결과를 알려드릴게요.'
    : mode === 'medicine'
      ? '약 봉투를 카메라 안에 맞춰주세요.'
      : '상처 부위를 화면 안에 넣어주세요.';

  const handleCapture = () => setCaptured(true);
  const handleSkip = () => setCurrentScreen('decision');
  const handleConfirm = () => setCurrentScreen('decision');

  return (
    <Screen>
      <TopLabel>
        <TopText>
          {mode === 'medicine' ? '약봉투 스캔' : '상처 촬영'}
        </TopText>
        <ModeTag>{mode === 'medicine' ? 'MEDICINE' : 'WOUND'}</ModeTag>
      </TopLabel>

      <ViewfinderArea>
        {!captured ? (
          <>
            <Viewfinder>
              <VFCorner $pos="tl" />
              <VFCorner $pos="tr" />
              <VFCorner $pos="bl" />
              <VFCorner $pos="br" />
              <ScanLineEl />
              <VFHint>
                {mode === 'medicine' ? 'MEDICINE PACKET' : 'WOUND AREA'}
              </VFHint>
            </Viewfinder>
            <ShootBtn onClick={handleCapture}>지금 촬영</ShootBtn>
            <SkipBtn onClick={handleSkip}>사진 없이 계속하기</SkipBtn>
          </>
        ) : (
          <>
            <ResultList>
              {result.items.map((item, i) => (
                <ResultItem key={i} $tag={item.tag} $delay={i}>
                  <TagRow>
                    <TagBadge $tag={item.tag}>{TAG_LABEL[item.tag]}</TagBadge>
                    <ResultLabel>{item.label}</ResultLabel>
                  </TagRow>
                  <ResultDesc>{item.description}</ResultDesc>
                </ResultItem>
              ))}
            </ResultList>
            <ConfirmBtn onClick={handleConfirm}>확인했어요</ConfirmBtn>
          </>
        )}
      </ViewfinderArea>

      <DoctorPanel>
        <VirtualDoctor state={captured ? 'idle' : 'speaking'} size={52} showHalo={false} />
        <SpeechWrap>
          <DoctorSpeech key={String(captured)}>{doctorMsg}</DoctorSpeech>
          <DoctorLabel>닥터 메디 · MEDial</DoctorLabel>
        </SpeechWrap>
      </DoctorPanel>
    </Screen>
  );
}
