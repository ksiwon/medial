// src/components/layout/PhoneFrame.tsx
import styled from 'styled-components';
import { color, font, radius } from '../../styles/tokens';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { useAppStore } from '../../store/useAppStore';
import { ScreenId } from '../../types';

const SCREEN_ORDER: ScreenId[] = [
  'home', 'chat', 'photo', 'decision',
  'emergency', 'healthCenter', 'selfCare', 'report',
];

/* ── 패널 (기기 + 네비 버튼 포함) */
const Panel = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 16px 24px;
  flex-shrink: 0;
`;

/* ── 폰 기기 외형 */
const Device = styled.div`
  width: 320px;
  height: 640px;
  background: #1C1C1E;
  border-radius: 44px;
  border: 1.5px solid rgba(0,0,0,0.18);
  overflow: hidden;
  position: relative;
  box-shadow:
    0 0 0 4px #2A2A2C,
    0 24px 60px rgba(0,0,0,0.28),
    0 6px 16px rgba(0,0,0,0.14);
  display: flex;
  flex-direction: column;
`;

/* ── 상단 노치 */
const Notch = styled.div`
  flex-shrink: 0;
  height: 28px;
  background: #1C1C1E;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding-bottom: 4px;
  z-index: 10;
`;

const NotchPill = styled.div`
  width: 78px;
  height: 10px;
  background: #0A0A0A;
  border-radius: 6px;
`;

/* ── 콘텐츠 영역: 스크롤 허용 */
const ScreenArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${color.cream.light};
  position: relative;
  -webkit-overflow-scrolling: touch;

  /* 스크롤바 */
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: rgba(54,99,72,0.25);
    border-radius: 2px;
  }
`;

/* ── 홈 바 */
const HomeBar = styled.div`
  flex-shrink: 0;
  height: 22px;
  background: #1C1C1E;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
`;

const HomeBarLine = styled.div`
  width: 80px;
  height: 3px;
  background: rgba(255,255,255,0.22);
  border-radius: 2px;
`;

/* ── 하단 네비 버튼 (밝은 배경 위) */
const NavRow = styled.div`
  display: flex;
  gap: 14px;
  align-items: center;
`;

const NavBtn = styled.button<{ $disabled: boolean }>`
  width: 34px;
  height: 34px;
  border-radius: ${radius.lg};
  background: rgba(0,0,0,0.07);
  border: 1px solid rgba(0,0,0,0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: ${({ $disabled }) => $disabled ? 0.22 : 1};
  cursor: ${({ $disabled }) => $disabled ? 'default' : 'pointer'};
  transition: background 0.12s;

  &:hover:not([disabled]) {
    background: rgba(0,0,0,0.12);
  }
  &:active {
    background: rgba(0,0,0,0.16);
  }
`;

const ScreenLabel = styled.span`
  font-size: 11px;
  font-weight: ${font.weight.medium};
  color: rgba(0,0,0,0.38);
  min-width: 82px;
  text-align: center;
  letter-spacing: 0.03em;
`;

const SCREEN_LABELS: Record<ScreenId, string> = {
  home:         '홈',
  chat:         '아바타 대화',
  photo:        '사진 촬영',
  decision:     '판단 분기',
  emergency:    '응급 119',
  healthCenter: '보건소 연결',
  selfCare:     '자가 치료',
  report:       '리포트',
};

interface Props {
  children: React.ReactNode;
}

export default function PhoneFrame({ children }: Props) {
  const { currentScreen, setCurrentScreen } = useAppStore();

  const idx = SCREEN_ORDER.indexOf(currentScreen);
  const canPrev = idx > 0;
  const canNext = idx < SCREEN_ORDER.length - 1;

  return (
    <Panel>
      <Device>
        <Notch>
          <NotchPill />
        </Notch>
        <ScreenArea>{children}</ScreenArea>
        <HomeBar>
          <HomeBarLine />
        </HomeBar>
      </Device>

      <NavRow>
        <NavBtn
          $disabled={!canPrev}
          onClick={() => canPrev && setCurrentScreen(SCREEN_ORDER[idx - 1])}
        >
          <ChevronLeftIcon size={15} color="rgba(0,0,0,0.5)" />
        </NavBtn>
        <ScreenLabel>{SCREEN_LABELS[currentScreen]}</ScreenLabel>
        <NavBtn
          $disabled={!canNext}
          onClick={() => canNext && setCurrentScreen(SCREEN_ORDER[idx + 1])}
        >
          <ChevronRightIcon size={15} color="rgba(0,0,0,0.5)" />
        </NavBtn>
      </NavRow>
    </Panel>
  );
}
