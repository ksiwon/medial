// src/screens/DecisionScreen.tsx
import styled, { keyframes } from 'styled-components';
import { color, font, radius, border } from '../styles/tokens';
import { PhoneIcon, HospitalIcon, HomeIcon } from '../components/icons';
import { useAppStore } from '../store/useAppStore';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  min-height: 100%;
  background: ${color.cream.light};
  display: flex;
  flex-direction: column;
`;

const TopBar = styled.div`
  padding: 14px 16px 11px;
  border-bottom: ${border.thin};
  flex-shrink: 0;
`;

const TopLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[500]};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 4px;
`;

const TopTitle = styled.div`
  font-size: 17px;
  font-weight: ${font.weight.bold};
  color: ${color.ink[900]};
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  &::-webkit-scrollbar { width: 2px; }
`;

/* AI 권고 카드 */
const RecoCard = styled.div`
  padding: 13px 14px;
  background: ${color.white};
  border: ${border.thin};
  border-left: 3px solid ${color.sage[400]};
  border-radius: ${radius.lg};
  animation: ${fadeUp} 0.3s ease;
`;

const RecoLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.sage[600]};
  letter-spacing: 0.06em;
  margin-bottom: 6px;
`;

const RecoText = styled.p`
  font-size: ${font.size.appMd};
  color: ${color.ink[700]};
  line-height: 1.6;
`;

const SectionLabel = styled.div`
  font-size: 10px;
  font-weight: ${font.weight.semiBold};
  color: ${color.ink[300]};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 4px;
  margin-bottom: 2px;
`;

const BtnGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
`;

const ActionBtn = styled.button<{ $variant: 'emergency' | 'healthCenter' | 'selfCare'; $highlighted: boolean }>`
  width: 100%;
  padding: 13px 14px;
  border-radius: ${radius.xl};
  border: ${({ $highlighted, $variant }) => {
    if (!$highlighted) return border.thin;
    if ($variant === 'emergency') return `2px solid ${color.emergency}`;
    if ($variant === 'healthCenter') return `2px solid ${color.healthBlue}`;
    return `2px solid ${color.sage[600]}`;
  }};
  background: ${({ $highlighted, $variant }) => {
    if (!$highlighted) return color.white;
    if ($variant === 'emergency') return color.emergencyDim;
    if ($variant === 'healthCenter') return color.healthBlueDim;
    return color.sage[50];
  }};
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
  animation: ${fadeUp} 0.3s ease both;

  &:active { opacity: 0.88; }
`;

const BtnIconBox = styled.div<{ $variant: 'emergency' | 'healthCenter' | 'selfCare' }>`
  width: 38px;
  height: 38px;
  border-radius: ${radius.lg};
  background: ${({ $variant }) => {
    if ($variant === 'emergency') return color.emergency;
    if ($variant === 'healthCenter') return color.healthBlue;
    return color.sage[600];
  }};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const BtnTitle = styled.div<{ $variant: 'emergency' | 'healthCenter' | 'selfCare' }>`
  font-size: ${font.size.appMd};
  font-weight: ${font.weight.semiBold};
  color: ${({ $variant }) => {
    if ($variant === 'emergency') return color.emergency;
    if ($variant === 'healthCenter') return color.healthBlue;
    return color.sage[700];
  }};
`;

const BtnSub = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  margin-top: 1px;
`;

const RecommendedTag = styled.div<{ $variant: 'emergency' | 'healthCenter' | 'selfCare' }>`
  margin-left: auto;
  font-size: 10px;
  font-weight: ${font.weight.bold};
  padding: 3px 7px;
  border-radius: ${radius.md};
  background: ${({ $variant }) => {
    if ($variant === 'emergency') return color.emergency;
    if ($variant === 'healthCenter') return color.healthBlue;
    return color.sage[600];
  }};
  color: white;
  flex-shrink: 0;
`;

const ReportLink = styled.button`
  margin-top: 4px;
  padding: 10px 14px;
  border-radius: ${radius.lg};
  border: ${border.thin};
  background: transparent;
  font-size: ${font.size.appMd};
  color: ${color.sage[600]};
  font-weight: ${font.weight.medium};
  transition: background 0.1s;
  width: 100%;
  text-align: center;

  &:active { background: ${color.cream.base}; }
`;

type Variant = 'emergency' | 'healthCenter' | 'selfCare';

const BTNS: Array<{ id: Variant; title: string; sub: string; screen: string; delay: string }> = [
  { id: 'emergency', title: '119 응급 신고', sub: '심각한 응급 상황 — 즉시 연결', screen: 'emergency', delay: '0s' },
  { id: 'healthCenter', title: '보건소 의사 연결', sub: '담당 선생님께 리포트 전달', screen: 'healthCenter', delay: '0.07s' },
  { id: 'selfCare', title: '자가 치료 안내', sub: '집에서 따라할 수 있는 방법', screen: 'selfCare', delay: '0.14s' },
];

export default function DecisionScreen() {
  const { getCurrentCase, setCurrentScreen, showAiRecommendation } = useAppStore();
  const caseData = getCurrentCase();

  return (
    <Screen>
      <TopBar>
        <TopLabel>MEDial 판단</TopLabel>
        <TopTitle>어떻게 도와드릴까요?</TopTitle>
      </TopBar>

      <Body>
        {showAiRecommendation && (
          <RecoCard>
            <RecoLabel>AI 권고</RecoLabel>
            <RecoText>{caseData.decisionRecommendation}</RecoText>
          </RecoCard>
        )}

        <SectionLabel>대응 방법 선택</SectionLabel>

        <BtnGroup>
          {BTNS.map(({ id, title, sub, screen, delay }) => {
            const highlighted = caseData.decisionOutcome === id;
            return (
              <ActionBtn
                key={id}
                $variant={id}
                $highlighted={highlighted}
                style={{ animationDelay: delay }}
                onClick={() => setCurrentScreen(screen as any)}
              >
                <BtnIconBox $variant={id}>
                  {id === 'emergency' && <PhoneIcon size={18} color="white" />}
                  {id === 'healthCenter' && <HospitalIcon size={18} color="white" />}
                  {id === 'selfCare' && <HomeIcon size={18} color="white" />}
                </BtnIconBox>
                <div>
                  <BtnTitle $variant={id}>{title}</BtnTitle>
                  <BtnSub>{sub}</BtnSub>
                </div>
                {highlighted && <RecommendedTag $variant={id}>권고</RecommendedTag>}
              </ActionBtn>
            );
          })}
        </BtnGroup>

        <ReportLink onClick={() => setCurrentScreen('report')}>
          문진 리포트 보기 →
        </ReportLink>
      </Body>
    </Screen>
  );
}
