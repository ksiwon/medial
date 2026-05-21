// src/screens/SelfCareScreen.tsx
import { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font, border, shadow } from '../styles/tokens';
import VirtualDoctor from '../components/phone/VirtualDoctor';
import { useAppStore } from '../store/useAppStore';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const stepIn = keyframes`
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
  gap: 6px;
`;

const TopText = styled.div`
  font-family: ${font.mono};
  font-size: 9.5px;
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  flex: 1;
`;

const PageDots = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
`;

const PageDot = styled.div<{ $active: boolean }>`
  width: ${({ $active }) => $active ? 16 : 5}px;
  height: 5px;
  border-radius: 3px;
  background: ${({ $active }) => $active ? color.sage[500] : color.cream.dark};
  transition: all 0.25s;
`;

/* ── 스크롤 바디 ──────────────────────────────── */
const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 0;
  min-height: 0;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(54,99,72,0.18); }
`;

const SectionTitle = styled.div`
  font-size: 14px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
  margin-bottom: 10px;
  animation: ${fadeIn} 0.3s ease both;
`;

/* ── 치료 단계 ──────────────────────────────────── */
const StepCard = styled.div<{ $delay: number }>`
  padding: 11px 13px;
  background: ${color.white};
  border: ${border.thin};
  border-left: 3px solid ${color.sage[400]};
  border-radius: 8px;
  margin-bottom: 6px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  animation: ${stepIn} 0.25s ease ${({ $delay }) => $delay * 0.08}s both;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
`;

const StepNum = styled.div`
  font-family: ${font.mono};
  font-size: 13px;
  font-weight: 700;
  color: ${color.sage[500]};
  flex-shrink: 0;
  width: 20px;
  line-height: 1.4;
`;

const StepContent = styled.div`
  flex: 1;
`;

const StepTitle = styled.div`
  font-size: 13px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[700]};
  line-height: 1.4;
  margin-bottom: 2px;
`;

const StepDesc = styled.div`
  font-size: 11px;
  color: ${color.ink[300]};
  line-height: 1.55;
`;

/* ── 주의 신호 ──────────────────────────────────── */
const WarnTitle = styled.div`
  font-size: 14px;
  font-weight: ${font.weight.bold};
  color: ${color.terra.base};
  margin-bottom: 10px;
  animation: ${fadeIn} 0.3s ease both;
`;

const WarnCard = styled.div<{ $delay: number }>`
  padding: 10px 13px;
  background: ${color.terra.pale};
  border: 1px solid rgba(176,48,32,0.22);
  border-left: 3px solid ${color.terra.base};
  border-radius: 8px;
  margin-bottom: 6px;
  font-size: 12.5px;
  font-weight: ${font.weight.medium};
  color: ${color.terra.dark};
  line-height: 1.5;
  animation: ${stepIn} 0.25s ease ${({ $delay }) => $delay * 0.08}s both;
`;

const EmptyMsg = styled.div`
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: ${color.ink[100]};
`;

/* ── 고정 하단 CTA ──────────────────────────────── */
const Footer = styled.div`
  flex-shrink: 0;
  padding: 10px 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid ${color.cream.mid};
  background: ${color.cream.light};
`;

const NextBtn = styled.button<{ $danger?: boolean }>`
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: ${font.weight.bold};
  color: white;
  background: ${({ $danger }) => $danger ? color.terra.base : color.sage[600]};
  border: 2px solid ${({ $danger }) => $danger ? color.terra.dark : color.sage[700]};
  box-shadow: ${shadow.cta};
  &:active { transform: scale(0.98); }
`;

/* ── Doctor Panel ─────────────────────────────── */
const DoctorPanel = styled.div`
  flex-shrink: 0;
  background: ${color.cream.base};
  border-top: 1.5px solid ${color.cream.dark};
  display: flex;
  align-items: flex-start;
  padding: 8px 12px;
  gap: 10px;
`;

const SpeechWrap = styled.div`
  flex: 1;
  padding-top: 4px;
`;

const DoctorSpeech = styled.div`
  font-size: 12px;
  font-weight: ${font.weight.medium};
  color: ${color.ink[900]};
  line-height: 1.55;
`;

const DoctorLabel = styled.div`
  font-family: ${font.mono};
  font-size: 8.5px;
  color: ${color.ink[100]};
  margin-top: 2px;
`;

/* ── 컴포넌트 ─────────────────────────────────────── */
export default function SelfCareScreen() {
  const { getCurrentCase, setCurrentScreen, onHome } = useAppStore();
  const caseData = getCurrentCase();
  const steps = caseData.selfCareSteps ?? [];
  const warnings = caseData.warningSignals ?? [];

  const [page, setPage] = useState<0|1>(0);

  const doctorMsg = page === 0
    ? '단계에 따라 차근차근 해보세요.'
    : '이 증상이 나타나면 바로 보건소에 가세요.';

  if (!steps.length) {
    return (
      <Screen>
        <TopLabel><TopText>자가 치료</TopText></TopLabel>
        <Body><EmptyMsg>이 케이스에는 자가 치료 안내가 없어요.</EmptyMsg></Body>
        <Footer>
          <NextBtn onClick={() => setCurrentScreen('home')}>처음으로</NextBtn>
        </Footer>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopLabel>
        <TopText>{page === 0 ? '자가 치료 방법' : '주의 신호'}</TopText>
        <PageDots>
          <PageDot $active={page === 0} />
          <PageDot $active={page === 1} />
        </PageDots>
      </TopLabel>

      <Body key={page}>
        {page === 0 ? (
          <>
            <SectionTitle>이렇게 해보세요</SectionTitle>
            {steps.map((step, i) => (
              <StepCard key={step.num} $delay={i}>
                <StepNum>{step.num}</StepNum>
                <StepContent>
                  <StepTitle>{step.title}</StepTitle>
                  <StepDesc>{step.description}</StepDesc>
                </StepContent>
              </StepCard>
            ))}
          </>
        ) : (
          <>
            <WarnTitle>이 증상이 생기면 바로 보건소로</WarnTitle>
            {warnings.length > 0 ? (
              warnings.map((w, i) => (
                <WarnCard key={i} $delay={i}>{w}</WarnCard>
              ))
            ) : (
              <EmptyMsg>특별한 주의 신호가 없어요.</EmptyMsg>
            )}
          </>
        )}
      </Body>

      <Footer>
        {page === 0 ? (
          <NextBtn onClick={() => setPage(1)}>주의 신호 확인</NextBtn>
        ) : (
          <>
            <NextBtn $danger onClick={() => setCurrentScreen('healthCenter')}>
              증상이 나빠졌어요
            </NextBtn>
            <NextBtn onClick={onHome}>처음으로</NextBtn>
          </>
        )}
      </Footer>

      <DoctorPanel>
        <VirtualDoctor state={page === 1 ? 'speaking' : 'idle'} size={44} showHalo={false} />
        <SpeechWrap>
          <DoctorSpeech key={page}>{doctorMsg}</DoctorSpeech>
          <DoctorLabel>닥터 메디 · MEDial</DoctorLabel>
        </SpeechWrap>
      </DoctorPanel>
    </Screen>
  );
}
