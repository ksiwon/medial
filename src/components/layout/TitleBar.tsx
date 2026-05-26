// src/components/layout/TitleBar.tsx
import styled from 'styled-components';
import { color, font } from '../../styles/tokens';
import { CompanionTab } from '../../types';
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

const PresentationHint = styled.span`
  font-size: 9.5px;
  font-family: ${font.mono};
  color: rgba(255,255,255,0.28);
  letter-spacing: 0.06em;
`;

const COMPANION_LABELS: Record<CompanionTab, string> = {
  talk:   '소통',
  health: '내 건강',
  info:   '정보',
};

export default function TitleBar() {
  const { companionTab, presentationMode } = useAppStore();

  return (
    <Bar>
      <Logo>MEDial</Logo>
      <Divider />
      <ScreenLabel>{COMPANION_LABELS[companionTab]}</ScreenLabel>
      <Spacer />
      <PresentationHint>{presentationMode ? 'D · dev' : '연구자 모드'}</PresentationHint>
    </Bar>
  );
}
