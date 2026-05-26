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
  // 이전 연결 상태를 기억해 false → true 전이마다 세션을 (재)시작한다.
  // 발표 중 서버가 재시작되거나 와이파이가 잠시 끊겨도 자동 재연결 후 인사가 다시 나오도록.
  const prevConnectedRef = useRef(false);

  useEffect(() => {
    if (wsConnected && !prevConnectedRef.current) {
      // 신규 연결(첫 진입 또는 재연결). 서버는 매 WS accept마다 새 Session을 만들므로
      // start로 모드를 알려야 COMPANION_GREETING + TTS가 시작된다.
      ws.startSession('companion');
      const store = useAppStore.getState();
      // 시드 소식은 첫 진입에만 주입(재연결 시 중복 방지).
      const alreadySeeded = store.healthContext.events.some((e) =>
        SEED_EVENTS.some((s) => s.id === e.id),
      );
      if (!alreadySeeded) {
        for (const evt of SEED_EVENTS) {
          const e = { ...evt, timestamp: Date.now() };
          store.addEvent(e);
          ws.sendEvent(e);
        }
      } else {
        // 이미 시드된 소식은 store에 있지만 서버 세션은 새로 만들어졌으므로
        // 메디가 다시 언급할 수 있도록 서버에만 재전송.
        for (const evt of store.healthContext.events) {
          if (evt.injectToChat) ws.sendEvent(evt);
        }
      }
    }
    prevConnectedRef.current = wsConnected;
  }, [wsConnected, ws]);

  return <Ctx.Provider value={{ ws, injectAnomaly }}>{children}</Ctx.Provider>;
}
