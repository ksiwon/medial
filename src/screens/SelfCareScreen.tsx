// src/screens/SelfCareScreen.tsx
import { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { AlertIcon, ClockIcon } from '../components/icons';
import { getSelfCareIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  min-height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
`;

const TopBar = styled.div`
  padding: 13px 16px 11px;
  border-bottom: ${border.thin};
  flex-shrink: 0;
`;

const TopLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[500]};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 3px;
`;

const TopTitle = styled.div`
  font-size: 16px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
`;

const TopSub = styled.div`
  font-size: ${font.size.appXs};
  color: ${color.ink[300]};
  margin-top: 2px;
`;

const StepList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  &::-webkit-scrollbar { width: 2px; }
`;

const StepCard = styled.div`
  display: flex;
  gap: 12px;
  padding: 12px;
  background: ${color.white};
  border: ${border.thin};
  border-radius: ${radius.xl};
  animation: ${fadeUp} 0.25s ease both;
`;

const StepNum = styled.div`
  width: 22px;
  height: 22px;
  border-radius: ${radius.md};
  background: ${color.sage[600]};
  font-size: 11px;
  font-weight: ${font.weight.bold};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
`;

const IconCol = styled.div`
  color: ${color.sage[400]};
  flex-shrink: 0;
  margin-top: 1px;
`;

const StepContent = styled.div`
  flex: 1;
`;

const StepTitle = styled.div`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  margin-bottom: 4px;
`;

const StepDesc = styled.div`
  font-size: ${font.size.appSm};
  color: ${color.ink[300]};
  line-height: 1.55;
`;

const NoSteps = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${font.size.appMd};
  color: ${color.ink[300]};
  padding: 20px;
  text-align: center;
`;

const Footer = styled.div`
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
  border-top: ${border.thin};
  background: ${color.white};
  position: sticky;
  bottom: 0;
  z-index: 5;
`;

const TimerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  background: ${color.cream.base};
  border-radius: ${radius.lg};
  border: ${border.thin};
`;

const TimerLabel = styled.span`
  font-size: ${font.size.appSm};
  color: ${color.ink[300]};
  flex: 1;
`;

const TimerVal = styled.span`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.bold};
  color: ${color.sage[600]};
  font-variant-numeric: tabular-nums;
`;

const WarnBtn = styled.button`
  width: 100%;
  padding: 12px;
  border-radius: ${radius.xl};
  border: 1.5px solid ${color.terra.base};
  background: ${color.terra.pale};
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: ${color.terra.base};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.1s;
  &:active { background: rgba(176,48,32,0.12); }
`;

const RegionNote = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  text-align: center;
  padding: 0 4px;
`;

function useTimer(seconds: number) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const m = Math.floor(remaining / 60).toString().padStart(2, '0');
  const s = (remaining % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function SelfCareScreen() {
  const { getCurrentCase, setCurrentScreen, region } = useAppStore();
  const caseData = getCurrentCase();
  const steps = caseData.selfCareSteps ?? [];
  const timer = useTimer(30 * 60);

  return (
    <Screen>
      <TopBar>
        <TopLabel>자가 치료</TopLabel>
        <TopTitle>집에서 할 수 있어요</TopTitle>
        <TopSub>아래 순서대로 따라하세요 · 30분 후 재확인 권장</TopSub>
      </TopBar>

      {steps.length > 0 ? (
        <StepList>
          {steps.map((step, i) => (
            <StepCard key={step.num} style={{ animationDelay: `${i * 0.06}s` }}>
              <StepNum>{step.num}</StepNum>
              <IconCol>{getSelfCareIcon(step.iconSvg, 17, color.sage[400])}</IconCol>
              <StepContent>
                <StepTitle>{step.title}</StepTitle>
                <StepDesc>{step.description}</StepDesc>
              </StepContent>
            </StepCard>
          ))}
        </StepList>
      ) : (
        <NoSteps>이 케이스에는 자가 치료 안내가 포함되지 않습니다.</NoSteps>
      )}

      <Footer>
        <TimerRow>
          <ClockIcon size={13} color={color.sage[500]} />
          <TimerLabel>30분 후 재확인 타이머</TimerLabel>
          <TimerVal>{timer}</TimerVal>
        </TimerRow>

        <WarnBtn onClick={() => setCurrentScreen('decision')}>
          <AlertIcon size={15} color={color.terra.base} />
          증상이 나빠졌어요
        </WarnBtn>

        <RegionNote>
          {region === 'rural'
            ? '가까운 보건소 방문 또는 의사 선생님께 연락하세요'
            : '근처 병원 — 증상 악화 시 바로 방문하세요'}
        </RegionNote>
      </Footer>
    </Screen>
  );
}
