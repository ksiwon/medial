// src/components/companion/CompanionContext.tsx
// companion 모드의 단일 WS 인스턴스 + IoT 시뮬을 한 곳에서 보유하고,
// 폰 셸(CompanionShell)과 우측 HealthPanel이 함께 공유하도록 컨텍스트로 제공한다.
import { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket, WsControls } from '../../hooks/useWebSocket';
import { useVitalsSim, AnomalyKind } from '../../hooks/useVitalsSim';
import { SEED_EVENTS } from '../../data/communityFeed';

interface CompanionCtx {
  ws: WsControls;
  injectAnomaly: (kind: AnomalyKind) => void;
}

const Ctx = createContext<CompanionCtx | null>(null);

export function useCompanion(): CompanionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCompanion must be used within CompanionProvider');
  return v;
}

export function CompanionProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();
  const wsConnected = useAppStore((s) => s.wsConnected);
  const monitoringConsent = useAppStore((s) => s.monitoringConsent);
  // 동의(존엄·통제, Frontiers 2025)가 있을 때만 IoT 신호 수집/전송.
  const { injectAnomaly } = useVitalsSim(ws, wsConnected && monitoringConsent);
  const startedRef = useRef(false);

  // 연결되면 companion 세션을 1회 자동 시작하고, 동네·보건소 소식을 시드 주입한다.
  useEffect(() => {
    if (wsConnected && !startedRef.current) {
      startedRef.current = true;
      ws.startSession('companion');
      const store = useAppStore.getState();
      ws.setTtsSpeed(store.ttsSpeed);   // 어르신 선호 속도(느리게) 적용
      for (const evt of SEED_EVENTS) {
        const e = { ...evt, timestamp: Date.now() };
        store.addEvent(e);       // 정보 탭 표시용
        ws.sendEvent(e);         // 서버 큐 — 메디가 대화에 녹임
      }
    }
  }, [wsConnected, ws]);

  return <Ctx.Provider value={{ ws, injectAnomaly }}>{children}</Ctx.Provider>;
}
