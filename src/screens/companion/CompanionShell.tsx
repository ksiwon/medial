// src/screens/companion/CompanionShell.tsx
// MEDial 3.0 폰 셸 — 활성 탭 컨텐츠 + 하단 3탭 네비게이션.
// WS/세션/IoT는 CompanionProvider(상위)가 보유한다.
import styled from 'styled-components';
import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useCompanion } from '../../components/companion/CompanionContext';
import TabBar from '../../components/companion/TabBar';
import CompanionEmergency from '../../components/companion/CompanionEmergency';
import CompanionOnboarding from '../../components/companion/CompanionOnboarding';
import TalkTab from './TalkTab';
import MyHealthTab from './MyHealthTab';
import InfoTab from './InfoTab';
import { EXTRA_ADVISORY } from '../../data/communityFeed';
import { AnomalyKind } from '../../hooks/useVitalsSim';

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

// 발표용 핫키 안내(우상단). 키 누르면 잠깐 떠올랐다 사라짐 — 연구자 본인만 알아채는 크기.
const HotkeyToast = styled.div`
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  font-size: 11px;
  letter-spacing: 0.02em;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(20,30,24,0.78);
  color: rgba(255,255,255,0.92);
  pointer-events: none;
  animation: hkfade 1.6s ease forwards;
  @keyframes hkfade {
    0%   { opacity: 0; transform: translate(-50%, -4px); }
    18%  { opacity: 1; transform: translate(-50%, 0); }
    78%  { opacity: 1; }
    100% { opacity: 0; }
  }
`;

const ANOMALY_LABELS: Record<AnomalyKind, string> = {
  htn_crisis:   '혈압 위기 (192/124)',
  tachycardia:  '빈맥 (136 bpm)',
  bradycardia:  '서맥 (38 bpm)',
  hypotension:  '저혈압 (86 mmHg)',
};

export default function CompanionShell() {
  const companionTab = useAppStore((s) => s.companionTab);
  const emergencyActive = useAppStore((s) => s.emergencyActive);
  const textScale = useAppStore((s) => s.companionTextScale);
  const onboardingSeen = useAppStore((s) => s.onboardingSeen);
  const { injectAnomaly, ws } = useCompanion();

  // 핫키 트리거 시 잠깐 떠오르는 토스트 메시지.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1600);
  };

  // 발표용 단축키:
  //   1=혈압 위기, 2=빈맥, 3=서맥, 4=저혈압, E=한파 주의보 공지
  // 텍스트 입력 중에는 무시(InfoTab composer 등 보호).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const map: Record<string, AnomalyKind> = {
        '1': 'htn_crisis', '2': 'tachycardia', '3': 'bradycardia', '4': 'hypotension',
      };
      if (map[e.key]) {
        e.preventDefault();
        const kind = map[e.key];
        injectAnomaly(kind);
        showToast(`이상치 주입 · ${ANOMALY_LABELS[kind]}`);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const evt = { ...EXTRA_ADVISORY, timestamp: Date.now() };
        useAppStore.getState().addEvent(evt);
        ws.sendEvent(evt);
        showToast(`공지 전달 · ${EXTRA_ADVISORY.title}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [injectAnomaly, ws]);

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
      {toast && <HotkeyToast key={toast}>{toast}</HotkeyToast>}
      {!onboardingSeen && <CompanionOnboarding />}
    </Shell>
  );
}
