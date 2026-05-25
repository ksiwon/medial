// src/store/useAppStore.ts
import { create } from 'zustand';
import { DoctorState, LiveMessage, LiveReport, CompanionTab } from '../types';
import { ChatMode, HealthContext, VitalReading, MealRecord, CommunityEvent } from '../types/health';

// localStorage 키 (브라우저에서 영속). 발표 중 매 새로고침 온보딩 재출현 방지 등.
const LS_KEYS = {
  onboarding: 'medial:onboarding_seen',
  presentation: 'medial:presentation_mode',
} as const;

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeBool(key: string, v: boolean): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
}

function emptyHealthContext(): HealthContext {
  return { vitals: [], meals: [], clues: [], events: [], lastUpdated: Date.now() };
}

export interface TelemetryEvent {
  t: number;
  kind: string;     // escalation_force | escalation_suggest | consent | meal | mode_switch | post | ...
  detail?: string;
}

interface AppState {
  // ── 전역 (연구자 뷰 줌) ────────────────────────────────
  fontScale: number;

  setFontScale: (scale: number) => void;

  // ── WS · 대화 백본 (companion 소통/상담이 공유) ─────────
  // 명칭은 과거 Live 엔진에서 유래했으나, 현재는 companion 대화의 실제 상태다.
  wsUrl: string;
  wsConnected: boolean;
  liveDoctorState: DoctorState;
  liveTurnCount: number;
  liveMessages: LiveMessage[];
  liveReport: LiveReport | null;
  currentSTT: string;
  isRecording: boolean;
  avatarMode: 'css' | 'video';       // css fallback vs Wav2Lip

  setWsUrl: (url: string) => void;
  setWsConnected: (v: boolean) => void;
  setLiveDoctorState: (state: DoctorState) => void;
  incrementLiveTurn: () => void;
  addLiveMessage: (msg: LiveMessage) => void;
  setLiveReport: (report: LiveReport) => void;
  setCurrentSTT: (text: string) => void;
  setIsRecording: (v: boolean) => void;
  setAvatarMode: (mode: 'css' | 'video') => void;
  resetLiveSession: () => void;

  // ── Companion mode (MEDial 3.0) ────────────────────────
  companionTab: CompanionTab;        // 소통 / 내 건강 / 정보
  chatMode: ChatMode;                // companion(일상) / triage(상담)
  healthContext: HealthContext;      // 4종 신호 누적 (오케스트레이터가 채움)
  triageSuggested: boolean;          // 부드러운 상담 제안 진행 중 (동의 칩 노출)
  triageSuggestReason: string | null;
  emergencyActive: boolean;          // 응급 감지 → 119 오버레이
  companionTextScale: number;        // 어르신용 글자 크기 배율 (DR1)
  monitoringConsent: boolean;        // IoT/GPS 수집 동의 (존엄·통제, Frontiers 2025)
  onboardingSeen: boolean;           // 최초 1회 오리엔테이션 표시 여부 (DR1)
  ttsSpeed: number;                  // 메디 음성 속도 (느리게 선호, P4)
  escalationReason: string | null;   // 상담 전환 사유 (설명가능 escalation, AIES 2025)
  telemetry: TelemetryEvent[];       // 세션 이벤트 로그 (평가용, R6)
  presentationMode: boolean;         // 발표/전시용 — dev 패널 숨김

  setCompanionTab: (tab: CompanionTab) => void;
  setChatMode: (mode: ChatMode) => void;
  setHealthContext: (ctx: HealthContext) => void;
  setTriageSuggested: (v: boolean, reason?: string | null) => void;
  setEmergencyActive: (v: boolean) => void;
  setMonitoringConsent: (v: boolean) => void;
  setOnboardingSeen: (v: boolean) => void;
  setTtsSpeed: (v: number) => void;
  setPresentationMode: (v: boolean) => void;
  togglePresentationMode: () => void;
  logEvent: (kind: string, detail?: string) => void;
  cycleCompanionTextScale: () => void;
  addVital: (v: VitalReading) => void;        // 표시용 (서버엔 ws.sendVital로 별도 전송)
  addMeal: (m: MealRecord) => void;
  addEvent: (e: CommunityEvent) => void;
  resetCompanion: () => void;
}

const COMPANION_TEXT_SCALES = [1.0, 1.15, 1.3];

export const useAppStore = create<AppState>((set) => ({
  // ── 전역 ───────────────────────────────────────────────
  fontScale: 1.0,
  setFontScale: (scale) => set({ fontScale: scale }),

  // ── WS · 대화 백본 ─────────────────────────────────────
  wsUrl: 'ws://localhost:8000/ws/consultation',
  wsConnected: false,
  liveDoctorState: 'idle',
  liveTurnCount: 0,
  liveMessages: [],
  liveReport: null,
  currentSTT: '',
  isRecording: false,
  avatarMode: 'css',

  setWsUrl: (url) => set({ wsUrl: url }),
  setWsConnected: (v) => set({ wsConnected: v }),
  setLiveDoctorState: (state) => set({ liveDoctorState: state }),
  incrementLiveTurn: () => set((s) => ({ liveTurnCount: s.liveTurnCount + 1 })),
  addLiveMessage: (msg) => set((s) => ({ liveMessages: [...s.liveMessages, msg] })),
  setLiveReport: (report) => set({ liveReport: report }),
  setCurrentSTT: (text) => set({ currentSTT: text }),
  setIsRecording: (v) => set({ isRecording: v }),
  setAvatarMode: (mode) => set({ avatarMode: mode }),

  resetLiveSession: () => set({
    liveDoctorState: 'idle',
    liveTurnCount: 0,
    liveMessages: [],
    liveReport: null,
    currentSTT: '',
    isRecording: false,
    emergencyActive: false,
  }),

  // ── Companion defaults ─────────────────────────────────
  companionTab: 'talk',
  chatMode: 'companion',
  healthContext: emptyHealthContext(),
  triageSuggested: false,
  triageSuggestReason: null,
  emergencyActive: false,
  companionTextScale: 1.0,
  monitoringConsent: true,
  // 페이지 새로고침해도 온보딩 재출현 방지 (DR1: 최초 1회).
  onboardingSeen: readBool(LS_KEYS.onboarding, false),
  ttsSpeed: 0.85,
  escalationReason: null,
  telemetry: [],
  // 기본은 발표 모드(우측 dev 패널 숨김). 연구자가 'D' 키로 토글.
  presentationMode: readBool(LS_KEYS.presentation, true),

  setMonitoringConsent: (v) => set({ monitoringConsent: v }),
  setOnboardingSeen: (v) => {
    writeBool(LS_KEYS.onboarding, v);
    set({ onboardingSeen: v });
  },
  setTtsSpeed: (v) => set({ ttsSpeed: v }),
  setPresentationMode: (v) => {
    writeBool(LS_KEYS.presentation, v);
    set({ presentationMode: v });
  },
  togglePresentationMode: () => set((s) => {
    const next = !s.presentationMode;
    writeBool(LS_KEYS.presentation, next);
    return { presentationMode: next };
  }),
  logEvent: (kind, detail) => set((s) => ({ telemetry: [...s.telemetry, { t: Date.now(), kind, detail }].slice(-100) })),

  setCompanionTab: (tab) => set({ companionTab: tab }),
  setChatMode: (mode) => set({ chatMode: mode }),
  setHealthContext: (ctx) => set({ healthContext: ctx }),
  setTriageSuggested: (v, reason = null) => set({ triageSuggested: v, triageSuggestReason: v ? reason : null }),
  setEmergencyActive: (v) => set({ emergencyActive: v }),
  cycleCompanionTextScale: () => set((s) => {
    const i = COMPANION_TEXT_SCALES.indexOf(s.companionTextScale);
    return { companionTextScale: COMPANION_TEXT_SCALES[(i + 1) % COMPANION_TEXT_SCALES.length] };
  }),
  addVital: (v) => set((s) => ({ healthContext: { ...s.healthContext, vitals: [...s.healthContext.vitals, v].slice(-60), lastUpdated: Date.now() } })),
  addMeal: (m) => set((s) => ({ healthContext: { ...s.healthContext, meals: [...s.healthContext.meals, m], lastUpdated: Date.now() } })),
  addEvent: (e) => set((s) => ({ healthContext: { ...s.healthContext, events: [...s.healthContext.events, e], lastUpdated: Date.now() } })),
  resetCompanion: () => set({
    companionTab: 'talk',
    chatMode: 'companion',
    healthContext: emptyHealthContext(),
    triageSuggested: false,
    triageSuggestReason: null,
    emergencyActive: false,
    monitoringConsent: true,
    escalationReason: null,
    telemetry: [],
    liveReport: null,
    liveMessages: [],
  }),
}));
