// src/components/layout/PhoneFrame.tsx
import styled from 'styled-components';
import { color } from '../../styles/tokens';

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 20px;
  flex-shrink: 0;
`;

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

const ScreenArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${color.cream.light};
  position: relative;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: rgba(54,99,72,0.25);
    border-radius: 2px;
  }
`;

const HomeBar = styled.div`
  flex-shrink: 0;
  height: 28px;
  background: #1C1C1E;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  z-index: 10;
`;

const HomeBarLine = styled.div`
  width: 120px;
  height: 4px;
  background: rgba(255,255,255,0.22);
  border-radius: 2px;
`;

interface Props {
  children: React.ReactNode;
}

export default function PhoneFrame({ children }: Props) {
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
    </Panel>
  );
}
