// src/components/layout/TitleBar.tsx
import styled from 'styled-components';
import { color, font } from '../../styles/tokens';
import NavDots from '../phone/NavDots';
import { ScreenId } from '../../types';

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

const SCREEN_LABELS: Record<ScreenId, string> = {
  home: '홈',
  chat: '아바타 대화',
  photo: '사진 촬영',
  decision: '판단 분기',
  emergency: '응급 119',
  healthCenter: '보건소 연결',
  selfCare: '자가 치료',
  report: '리포트',
};

interface Props {
  currentScreen: ScreenId;
}

export default function TitleBar({ currentScreen }: Props) {
  return (
    <Bar>
      <Logo>MEDial</Logo>
      <Divider />
      <ScreenLabel>{SCREEN_LABELS[currentScreen]}</ScreenLabel>
      <Spacer />
      <NavDots currentScreen={currentScreen} />
    </Bar>
  );
}
