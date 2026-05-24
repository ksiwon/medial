// src/screens/companion/CompanionShell.tsx
// MEDial 2.0 폰 셸 — 활성 탭 컨텐츠 + 하단 2탭 네비게이션.
// WS/세션/IoT는 CompanionProvider(상위)가 보유한다.
import styled from 'styled-components';
import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import TabBar from '../../components/companion/TabBar';
import CompanionEmergency from '../../components/companion/CompanionEmergency';
import CompanionOnboarding from '../../components/companion/CompanionOnboarding';
import TalkTab from './TalkTab';
import MyHealthTab from './MyHealthTab';
import InfoTab from './InfoTab';

const Shell = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
`;
const Content = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

export default function CompanionShell() {
  const companionTab = useAppStore((s) => s.companionTab);
  const emergencyActive = useAppStore((s) => s.emergencyActive);
  const textScale = useAppStore((s) => s.companionTextScale);
  const onboardingSeen = useAppStore((s) => s.onboardingSeen);

  // 전역 글자 확대: --ts 가 모든 하위 텍스트(calc(px*var(--ts)))에 적용됨.
  const scaleVar = { ['--ts' as string]: String(textScale) } as React.CSSProperties;

  // 응급은 탭/네비를 덮는 전체 오버레이 (안전 최우선).
  if (emergencyActive) return <Shell style={scaleVar}><CompanionEmergency /></Shell>;

  return (
    <Shell style={scaleVar}>
      <Content>
        {companionTab === 'talk' ? <TalkTab />
          : companionTab === 'health' ? <MyHealthTab />
          : <InfoTab />}
      </Content>
      <TabBar />
      {!onboardingSeen && <CompanionOnboarding />}
    </Shell>
  );
}
