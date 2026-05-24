// src/components/layout/TitleBar.tsx
import styled from 'styled-components';
import { color, font } from '../../styles/tokens';
import NavDots from '../phone/NavDots';
import { ScreenId, AppMode, LiveScreenId } from '../../types';
import { useAppStore } from '../../store/useAppStore';

const Bar = styled.header`
  height: 46px;
  background: ${color.sage[800]};
  border-bottom: 1px solid rgba(0,0,0,0.12);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 14px;
  flex-shrink: 0;
  z-index: 10;
`;

const Logo = styled.span`
  font-size: 16px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[300]};
  letter-spacing: 0.04em;
  font-style: italic;
`;

const Divider = styled.div`
  width: 1px;
  height: 16px;
  background: rgba(255,255,255,0.12);
`;

const ScreenLabel = styled.span`
  font-size: 11px;
  font-weight: ${font.weight.medium};
  color: rgba(255,255,255,0.38);
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const Spacer = styled.div`flex: 1;`;

const ModeToggle = styled.div`
  display: flex;
  align-items: center;
  background: rgba(0,0,0,0.2);
  border-radius: 6px;
  padding: 2px;
  gap: 1px;
`;

const ModeBtn = styled.button<{ $active: boolean; $live?: boolean }>`
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-family: ${font.mono};
  transition: all 0.15s;
  background: ${({ $active, $live }) =>
    $active
      ? $live ? 'rgba(233,69,96,0.85)' : 'rgba(255,255,255,0.15)'
      : 'transparent'};
  color: ${({ $active }) => $active ? 'white' : 'rgba(255,255,255,0.35)'};
`;

const MOCK_LABELS: Record<ScreenId, string> = {
  home:         '홈',
  chat:         '아바타 대화',
  analyzing:    'AI 분석',
  photo:        '멀티모달',
  decision:     '판단 분기',
  emergency:    '응급 119',
  healthCenter: '보건소 연결',
  selfCare:     '자가 치료',
  report:       '리포트',
};

const LIVE_LABELS: Record<LiveScreenId, string> = {
  'live-idle':      '대기',
  'live-chat':      '라이브 문진',
  'live-emergency': '응급 감지',
  'live-report':    '리포트 전송',
  'live-complete':  '전달 완료',
};

interface Props {
  currentScreen: ScreenId;
}

export default function TitleBar({ currentScreen }: Props) {
  const { appMode, liveScreen, companionTab, setAppMode } = useAppStore();

  const label = appMode === 'companion'
    ? (companionTab === 'talk' ? '소통' : '정보')
    : appMode === 'live'
      ? LIVE_LABELS[liveScreen]
      : MOCK_LABELS[currentScreen];

  const handleSwitch = (mode: AppMode) => {
    setAppMode(mode);
    if (mode === 'live') {
      useAppStore.getState().resetLiveSession();
    } else if (mode === 'companion') {
      useAppStore.getState().resetCompanion();
    }
  };

  return (
    <Bar>
      <Logo>MEDial</Logo>
      <Divider />
      <ScreenLabel>{label}</ScreenLabel>
      <Spacer />

      <ModeToggle>
        <ModeBtn $active={appMode === 'mock'} onClick={() => handleSwitch('mock')}>
          Mock
        </ModeBtn>
        <ModeBtn $active={appMode === 'live'} $live onClick={() => handleSwitch('live')}>
          Live
        </ModeBtn>
        <ModeBtn $active={appMode === 'companion'} onClick={() => handleSwitch('companion')}>
          2.0
        </ModeBtn>
      </ModeToggle>

      {appMode === 'mock' && <NavDots currentScreen={currentScreen} />}
    </Bar>
  );
}
