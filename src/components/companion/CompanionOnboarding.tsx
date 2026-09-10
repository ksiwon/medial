// src/components/companion/CompanionOnboarding.tsx
// 최초 1회 오리엔테이션 (DR1·P3: "한번 가르쳐 주면 그 뒤엔 잘 씀").
import styled from 'styled-components';
import { color, font, ts, touch } from '../../styles/tokens';
import VirtualDoctor from '../phone/VirtualDoctor';
import { useAppStore } from '../../store/useAppStore';

const Overlay = styled.div`
  position: absolute; inset: 0; z-index: 20;
  background: ${color.sage[900]};
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 28px 24px; text-align: center;
`;
const Title = styled.h1`font-size: ${ts(26)}; font-weight: ${font.weight.bold}; color: #fff;`;
const Steps = styled.div`display: flex; flex-direction: column; gap: 12px; width: 100%;`;
const Step = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
  background: rgba(255,255,255,0.1); border-radius: 14px; padding: 14px 16px;
  font-size: ${ts(17)}; color: #fff; line-height: 1.45; text-align: left;
`;
const StepText = styled.span`
  flex: 1;
  word-break: keep-all;   /* 한국어 단어 중간 줄바꿈 방지 */
  & b { font-weight: ${font.weight.bold}; }
`;
const Num = styled.div`
  width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%;
  background: ${color.sage[400]}; color: ${color.sage[900]};
  display: flex; align-items: center; justify-content: center; font-weight: ${font.weight.bold};
`;
const StartBtn = styled.button`
  width: 100%; min-height: ${touch.min + 8}px; margin-top: 6px;
  border-radius: 16px; background: #fff; color: ${color.sage[800]};
  font-size: ${ts(19)}; font-weight: ${font.weight.bold};
  &:active { transform: scale(0.98); }
`;

export default function CompanionOnboarding() {
  return (
    <Overlay>
      <VirtualDoctor state="speaking" size={84} showHalo={false} />
      <Title>저는 메디예요</Title>
      <Steps>
        <Step><Num>1</Num><StepText>아래 <b>마이크 버튼을 누르고</b> 말씀하세요.</StepText></Step>
        <Step><Num>2</Num><StepText>다 말하셨으면 <b>버튼을 다시 한 번</b> 눌러 주세요.</StepText></Step>
        <Step><Num>3</Num><StepText>글씨가 작으면 위의 <b>‘가가’</b>로 키우세요.</StepText></Step>
      </Steps>
      <StartBtn onClick={() => useAppStore.getState().setOnboardingSeen(true)}>
        네, 시작할게요
      </StartBtn>
    </Overlay>
  );
}
