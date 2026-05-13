// src/components/phone/NavDots.tsx
// 실제 흐름에 맞는 진행 표시기
// home → chat → (photo) → decision → [emergency | healthCenter | selfCare] → (report)
import styled from 'styled-components';
import { color } from '../../styles/tokens';
import { ScreenId } from '../../types';

// 화면별 단계 번호 (분기 포함)
const STEP_MAP: Record<ScreenId, number> = {
  home:          1,
  chat:          2,
  photo:         3,
  decision:      4,
  emergency:     5,
  healthCenter:  5,
  selfCare:      5,
  report:        6,
};
const TOTAL_STEPS = 6;

const Row = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
`;

const Dot = styled.div<{ $state: 'done' | 'active' | 'pending' }>`
  height: 5px;
  width: ${({ $state }) => $state === 'active' ? '18px' : '5px'};
  border-radius: 3px;
  background: ${({ $state }) => {
    if ($state === 'active') return color.sage[400];
    if ($state === 'done')   return color.sage[700];
    return 'rgba(255,255,255,0.18)';
  }};
  transition: width 0.2s ease, background 0.2s ease;
`;

interface Props {
  currentScreen: ScreenId;
}

export default function NavDots({ currentScreen }: Props) {
  const current = STEP_MAP[currentScreen];
  return (
    <Row>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const step = i + 1;
        const state = step < current ? 'done' : step === current ? 'active' : 'pending';
        return <Dot key={step} $state={state} />;
      })}
    </Row>
  );
}
