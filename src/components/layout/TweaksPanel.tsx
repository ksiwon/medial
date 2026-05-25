// src/components/layout/TweaksPanel.tsx
// 연구자 전용 dev 패널 (발표 모드에선 숨김). companion 제품의 서버 상태·줌·정보.
import styled from 'styled-components';
import { color, font } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';

const Panel = styled.div`
  width: 200px;
  height: 100%;
  overflow-y: auto;
  background: #E0DAD0;
  border-left: 1px solid rgba(0,0,0,0.10);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 12px 20px;
  gap: 14px;

  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 1px; }
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const SectionLabel = styled.div`
  font-size: 9.5px;
  font-weight: ${font.weight.bold};
  color: rgba(0,0,0,0.36);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: ${font.mono};
  margin-bottom: 2px;
`;

const InfoCard = styled.div`
  background: rgba(255,255,255,0.55);
  border-radius: 6px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const Meta = styled.div`
  font-size: 10px;
  color: ${color.ink[300]};
  font-family: ${font.mono};
`;

const Divider = styled.div`
  height: 1px;
  background: rgba(0,0,0,0.10);
`;

const ScaleOptions = styled.div`
  display: flex;
  gap: 3px;
`;

const ScaleBtn = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 5px 2px;
  border-radius: 4px;
  font-size: 10px;
  font-family: ${font.mono};
  font-weight: ${({ $active }) => $active ? 700 : 400};
  background: ${({ $active }) => $active ? color.sage[600] : 'rgba(0,0,0,0.07)'};
  color: ${({ $active }) => $active ? 'white' : color.ink[500]};
  border: 1px solid ${({ $active }) => $active ? color.sage[500] : 'transparent'};
  transition: all 0.12s;
`;

const WsInput = styled.input`
  width: 100%;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid rgba(0,0,0,0.14);
  background: white;
  font-size: 10px;
  font-family: ${font.mono};
  color: ${color.ink[700]};
  &:focus { outline: 2px solid ${color.sage[400]}; }
`;

const StatusDot = styled.div<{ $ok: boolean }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${({ $ok }) => $ok ? color.sage[500] : color.terra.mid};
  flex-shrink: 0;
`;
const StatusRow = styled.div`
  display: flex; align-items: center; gap: 5px;
  font-size: 10px; font-family: ${font.mono};
  color: ${color.ink[300]};
`;

const SCALE_OPTIONS = [0.9, 1.0, 1.1, 1.2, 1.4];

export default function TweaksPanel() {
  const { fontScale, setFontScale, wsUrl, setWsUrl, wsConnected } = useAppStore();

  return (
    <Panel>
      <Section>
        <SectionLabel>MEDial 3.0</SectionLabel>
        <InfoCard>
          <Meta>AI 동반 + 의료 커뮤니티</Meta>
          <Meta>소통 · 내 건강 · 정보</Meta>
        </InfoCard>
      </Section>

      <Divider />

      <Section>
        <SectionLabel>서버</SectionLabel>
        <StatusRow>
          <StatusDot $ok={wsConnected} />
          {wsConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </StatusRow>
        <WsInput
          value={wsUrl}
          onChange={(e) => setWsUrl(e.target.value)}
          placeholder="ws://localhost:8000/ws/consultation"
          spellCheck={false}
        />
      </Section>

      <Divider />

      <Section>
        <SectionLabel>뷰 글자 크기</SectionLabel>
        <ScaleOptions>
          {SCALE_OPTIONS.map((s) => (
            <ScaleBtn key={s} $active={fontScale === s} onClick={() => setFontScale(s)}>
              {s}x
            </ScaleBtn>
          ))}
        </ScaleOptions>
      </Section>

      <Divider />

      <Section>
        <SectionLabel>대상</SectionLabel>
        <InfoCard>
          <Meta>남해 농촌 고령자</Meta>
          <Meta>IRB-2026-56 · N=11</Meta>
        </InfoCard>
      </Section>
    </Panel>
  );
}
