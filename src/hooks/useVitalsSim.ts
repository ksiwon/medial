// src/hooks/useVitalsSim.ts
// IoT 시뮬레이션 — 주기적으로 정상 범위 바이탈을 생성해 표시(store)하고 서버로 전송(ws.sendVital).
// injectAnomaly()로 전시 시연용 이상치를 주입해 escalation을 유발한다.
import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { VitalReading } from '../types/health';
import { WsControls } from './useWebSocket';

const TICK_MS = 8000;
const BASE = { hr: 72, sys: 128, dia: 78 };
const NAMHAE = { lat: 34.8376, lng: 127.8924, label: '남해군' };

export type AnomalyKind = 'htn_crisis' | 'bradycardia' | 'tachycardia' | 'hypotension';

function jitter(base: number, spread: number): number {
  return Math.round(base + (Math.random() - 0.5) * 2 * spread);
}

export function useVitalsSim(ws: WsControls, active: boolean) {
  const stepsRef = useRef(800 + Math.floor(Math.random() * 400));
  const distRef = useRef(0.5 + Math.random() * 0.4);

  const emit = useCallback((reading: VitalReading) => {
    useAppStore.getState().addVital(reading);
    ws.sendVital(reading);
  }, [ws]);

  const makeNormal = useCallback((): VitalReading => {
    stepsRef.current += Math.floor(Math.random() * 90);
    distRef.current += Math.random() * 0.06;
    return {
      timestamp: Date.now(),
      heartRate: jitter(BASE.hr, 6),
      bloodPressure: { systolic: jitter(BASE.sys, 8), diastolic: jitter(BASE.dia, 5) },
      steps: stepsRef.current,
      distanceKm: Math.round(distRef.current * 10) / 10,
      location: NAMHAE,
    };
  }, []);

  const injectAnomaly = useCallback((kind: AnomalyKind) => {
    const base = makeNormal();
    const r: VitalReading = { ...base };
    if (kind === 'htn_crisis') r.bloodPressure = { systolic: jitter(192, 4), diastolic: jitter(124, 3) };
    else if (kind === 'bradycardia') r.heartRate = jitter(38, 2);
    else if (kind === 'tachycardia') r.heartRate = jitter(136, 4);
    else if (kind === 'hypotension') r.bloodPressure = { systolic: jitter(86, 3), diastolic: jitter(56, 3) };
    emit(r);
  }, [makeNormal, emit]);

  useEffect(() => {
    if (!active) return;
    emit(makeNormal()); // 첫 측정 즉시
    const id = window.setInterval(() => emit(makeNormal()), TICK_MS);
    return () => window.clearInterval(id);
  }, [active, emit, makeNormal]);

  return { injectAnomaly };
}
