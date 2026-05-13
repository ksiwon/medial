// src/screens/PhotoScreen.tsx
import { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { CameraIcon, PillIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

const scanLine = keyframes`
  0%   { top: 10%; opacity: 1; }
  90%  { top: 90%; opacity: 1; }
  100% { top: 90%; opacity: 0; }
`;

const Screen = styled.div`
  height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
`;

const Tabs = styled.div`
  display: flex;
  border-bottom: ${border.thin};
  flex-shrink: 0;
  background: ${color.white};
`;

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 10px 8px;
  font-size: ${font.size.appMd};
  font-weight: ${({ $active }) => $active ? font.weight.semiBold : font.weight.regular};
  color: ${({ $active }) => $active ? color.sage[700] : color.ink[300]};
  border-bottom: 2px solid ${({ $active }) => $active ? color.sage[600] : 'transparent'};
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: color 0.15s, border-color 0.15s;
`;

const CameraZone = styled.div`
  flex: 1;
  background: #141B16;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
`;

/* 카메라 코너 가이드 */
const Corner = styled.div<{ $t?: boolean; $b?: boolean; $l?: boolean; $r?: boolean }>`
  position: absolute;
  width: 22px;
  height: 22px;
  top: ${({ $t }) => $t ? '18px' : 'auto'};
  bottom: ${({ $b }) => $b ? '18px' : 'auto'};
  left: ${({ $l }) => $l ? '18px' : 'auto'};
  right: ${({ $r }) => $r ? '18px' : 'auto'};
  border-top: ${({ $t }) => $t ? '2px solid rgba(255,255,255,0.5)' : 'none'};
  border-bottom: ${({ $b }) => $b ? '2px solid rgba(255,255,255,0.5)' : 'none'};
  border-left: ${({ $l }) => $l ? '2px solid rgba(255,255,255,0.5)' : 'none'};
  border-right: ${({ $r }) => $r ? '2px solid rgba(255,255,255,0.5)' : 'none'};
`;

const ScanLineEl = styled.div`
  position: absolute;
  left: 15%;
  right: 15%;
  height: 1.5px;
  background: ${color.sage[400]};
  opacity: 0.7;
  animation: ${scanLine} 2.4s ease-in-out infinite;
`;

const CameraHint = styled.div`
  font-size: ${font.size.appMd};
  color: rgba(255,255,255,0.55);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`;

const CaptureRing = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2.5px solid rgba(255,255,255,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const CaptureInner = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255,255,255,0.85);
`;

const HintLabel = styled.div`
  font-size: ${font.size.appMd};
  color: rgba(255,255,255,0.55);
`;

const HintSub = styled.div`
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  margin-top: -6px;
`;

const ResultArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: ${fadeIn} 0.3s ease;
  &::-webkit-scrollbar { width: 2px; }
`;

const ResultLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[300]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 4px;
`;

const ResultCard = styled.div<{ $tag: 'ok' | 'warn' | 'conflict' }>`
  padding: 11px 13px;
  border-radius: ${radius.lg};
  background: ${color.white};
  border: ${border.thin};
  border-left: 3px solid ${({ $tag }) => {
    if ($tag === 'ok') return color.sage[400];
    if ($tag === 'warn') return color.terra.base;
    return color.emergency;
  }};
`;

const CardTag = styled.div<{ $tag: 'ok' | 'warn' | 'conflict' }>`
  font-size: 10px;
  font-weight: ${font.weight.bold};
  color: ${({ $tag }) => {
    if ($tag === 'ok') return color.sage[600];
    if ($tag === 'warn') return color.terra.base;
    return color.emergency;
  }};
  letter-spacing: 0.05em;
  margin-bottom: 4px;
`;

const CardDesc = styled.div`
  font-size: ${font.size.appMd};
  color: ${color.ink[700]};
  line-height: 1.5;
`;

const SkipBtn = styled.button`
  margin: 8px 14px;
  padding: 9px;
  border-radius: ${radius.lg};
  border: ${border.thin};
  background: transparent;
  font-size: ${font.size.appMd};
  color: ${color.ink[300]};
  flex-shrink: 0;
  transition: background 0.1s;

  &:active { background: ${color.cream.base}; }
`;

const NextBtn = styled.button`
  margin: 0 14px 14px;
  padding: 13px;
  border-radius: ${radius.lg};
  border: none;
  background: ${color.sage[600]};
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: white;
  flex-shrink: 0;
  transition: background 0.1s;
  box-shadow: 0 2px 8px rgba(54,99,72,0.2);

  &:active { background: ${color.sage[700]}; }
`;

export default function PhotoScreen() {
  const { getCurrentCase, setCurrentScreen } = useAppStore();
  const caseData = getCurrentCase();
  const [mode, setMode] = useState<'wound' | 'medicine'>(caseData.photoMode);
  const [captured, setCaptured] = useState(false);

  return (
    <Screen>
      <Tabs>
        <Tab $active={mode === 'wound'} onClick={() => { setMode('wound'); setCaptured(false); }}>
          <CameraIcon size={14} color={mode === 'wound' ? color.sage[600] : color.ink[300]} />
          상처 촬영
        </Tab>
        <Tab $active={mode === 'medicine'} onClick={() => { setMode('medicine'); setCaptured(false); }}>
          <PillIcon size={14} color={mode === 'medicine' ? color.sage[600] : color.ink[300]} />
          약 봉투 스캔
        </Tab>
      </Tabs>

      {!captured ? (
        <>
          <CameraZone onClick={() => setCaptured(true)}>
            {/* 스캔 라인 */}
            <ScanLineEl />
            {/* 코너 가이드 */}
            <Corner $t $l />
            <Corner $t $r />
            <Corner $b $l />
            <Corner $b $r />
            <CameraHint>
              <CaptureRing><CaptureInner /></CaptureRing>
              <div>
                <HintLabel>
                  {mode === 'wound' ? '상처 부위를 화면 안에 맞춰주세요' : '약 봉투를 밝은 곳에서 찍어주세요'}
                </HintLabel>
                <HintSub>화면을 탭하면 촬영</HintSub>
              </div>
            </CameraHint>
          </CameraZone>
          <SkipBtn onClick={() => setCurrentScreen('decision')}>사진 없이 계속하기</SkipBtn>
        </>
      ) : (
        <>
          <ResultArea>
            <ResultLabel>
              {mode === 'wound' ? '상처 분석 결과' : '약 봉투 분석 결과'}
            </ResultLabel>
            {caseData.photoResult.items.map((item, i) => (
              <ResultCard key={i} $tag={item.tag}>
                <CardTag $tag={item.tag}>{item.label}</CardTag>
                <CardDesc>{item.description}</CardDesc>
              </ResultCard>
            ))}
          </ResultArea>
          <NextBtn onClick={() => setCurrentScreen('decision')}>판단 결과 보기 →</NextBtn>
        </>
      )}
    </Screen>
  );
}
