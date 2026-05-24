// src/store/useAppStore.ts
import { create } from 'zustand';
import { ScreenId, ActionMode, DoctorState, AppMode, LiveScreenId, LiveMessage, LiveReport, LiveSession, CompanionTab } from '../types';
import { ChatMode, HealthContext, VitalReading, MealRecord, CommunityEvent } from '../types/health';
import { cases } from '../data/mockData';

function emptyHealthContext(): HealthContext {
  return { vitals: [], meals: [], clues: [], events: [], lastUpdated: Date.now() };
}

function makeSessionCode() {
  return `PT-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

interface AppState {
  // ── Mock mode ──────────────────────────────────────────
  currentCaseId: string;
  currentScreen: ScreenId;
  prevConvIndex: number | null;
  dialogueIndex: number;
  actionMode: ActionMode;
  doctorState: DoctorState;
  showFaceAnalysis: boolean;
  showEmpathy: boolean;
  showAiRecommendation: boolean;
  fontScale: number;
  region: 'rural' | 'urban';

  setCurrentCase: (caseId: string) => void;
  setCurrentScreen: (screen: ScreenId) => void;
  setPrevConvIndex: (index: number | null) => void;
  setDialogueIndex: (index: number) => void;
  incrementDialogueIndex: () => void;
  resetDialogue: () => void;
  startFromConversation: (index: number) => void;
  setActionMode: (mode: ActionMode) => void;
  setDoctorState: (state: DoctorState) => void;
  toggleFaceAnalysis: () => void;
  toggleEmpathy: () => void;
  toggleAiRecommendation: () => void;
  setFontScale: (scale: number) => void;
  setRegion: (region: 'rural' | 'urban') => void;
  onHome: () => void;
  onTriageSend: (action: 'emergency' | 'healthCenter' | 'selfCare' | 'dialogue') => void;
  getCurrentCase: () => typeof cases[0];

  // ── Live mode ──────────────────────────────────────────
  appMode: AppMode;
  liveScreen: LiveScreenId;
  wsUrl: string;
  wsConnected: boolean;
  liveDoctorState: DoctorState;
  liveTurnCount: number;
  liveMessages: LiveMessage[];
  liveReport: LiveReport | null;
  currentSTT: string;
  isRecording: boolean;
  sessions: LiveSession[];           // accumulated for dashboard
  selectedSessionCode: string | null;
  avatarMode: 'css' | 'video';       // css fallback vs Wav2Lip

  setAppMode: (mode: AppMode) => void;
  setLiveScreen: (screen: LiveScreenId) => void;
  setWsUrl: (url: string) => void;
  setWsConnected: (v: boolean) => void;
  setLiveDoctorState: (state: DoctorState) => void;
  incrementLiveTurn: () => void;
  addLiveMessage: (msg: LiveMessage) => void;
  setLiveReport: (report: LiveReport) => void;
  setCurrentSTT: (text: string) => void;
  setIsRecording: (v: boolean) => void;
  setSelectedSession: (code: string | null) => void;
  setAvatarMode: (mode: 'css' | 'video') => void;
  resetLiveSession: () => void;
  commitSession: () => void;         // archive current session into sessions[]

  // ── Companion mode (MEDial 2.0) ────────────────────────
  companionTab: CompanionTab;        // 소통 / 정보
  chatMode: ChatMode;                // companion(일상) / triage(상담)
  healthContext: HealthContext;      // 4종 신호 누적 (P3 오케스트레이터가 채움)
  triageSuggested: boolean;          // 부드러운 상담 제안 진행 중 (동의 칩 노출)
  triageSuggestReason: string | null;
  emergencyActive: boolean;          // 응급 감지 → 119 오버레이 (companion/live 공통)
  companionTextScale: number;        // 어르신용 글자 크기 배율 (DR1)
  monitoringConsent: boolean;        // IoT/GPS 수집 동의 (존엄·통제, Frontiers 2025)
  onboardingSeen: boolean;           // 최초 1회 오리엔테이션 표시 여부 (DR1)
  ttsSpeed: number;                  // 메디 음성 속도 (느리게 선호, P4)
  escalationReason: string | null;   // 상담 전환 사유 (설명가능 escalation, AIES 2025)
  telemetry: TelemetryEvent[];       // 세션 이벤트 로그 (평가용, R6)

  setCompanionTab: (tab: CompanionTab) => void;
  setChatMode: (mode: ChatMode) => void;
  setHealthContext: (ctx: HealthContext) => void;
  setTriageSuggested: (v: boolean, reason?: string | null) => void;
  setEmergencyActive: (v: boolean) => void;
  setMonitoringConsent: (v: boolean) => void;
  setOnboardingSeen: (v: boolean) => void;
  setTtsSpeed: (v: number) => void;
  logEvent: (kind: string, detail?: string) => void;
  cycleCompanionTextScale: () => void;
  addVital: (v: VitalReading) => void;        // 표시용 (서버엔 ws.sendVital로 별도 전송)
  addMeal: (m: MealRecord) => void;
  addEvent: (e: CommunityEvent) => void;
  resetCompanion: () => void;
}

const COMPANION_TEXT_SCALES = [1.0, 1.15, 1.3];

export interface TelemetryEvent {
  t: number;
  kind: string;     // escalation_force | escalation_suggest | consent | meal | mode_switch | post | ...
  detail?: string;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── Mock defaults ──────────────────────────────────────
  currentCaseId: 'case1',
  currentScreen: 'home',
  prevConvIndex: null,
  dialogueIndex: 0,
  actionMode: 'chips',
  doctorState: 'idle',
  showFaceAnalysis: true,
  showEmpathy: true,
  showAiRecommendation: true,
  fontScale: 1.0,
  region: 'rural',

  setCurrentCase: (caseId) => {
    set({ currentCaseId: caseId, currentScreen: 'home', prevConvIndex: null, dialogueIndex: 0, actionMode: 'chips', doctorState: 'idle' });
  },
  setCurrentScreen: (screen) => set({ currentScreen: screen }),
  setPrevConvIndex: (index) => set({ prevConvIndex: index }),
  setDialogueIndex: (index) => set({ dialogueIndex: index }),
  incrementDialogueIndex: () => set((s) => ({ dialogueIndex: s.dialogueIndex + 1 })),
  resetDialogue: () => set({ dialogueIndex: 0, prevConvIndex: null, actionMode: 'chips', doctorState: 'idle' }),

  startFromConversation: (index) => {
    set({ prevConvIndex: index, dialogueIndex: 0, currentScreen: 'chat', actionMode: 'chips', doctorState: 'speaking' });
  },

  setActionMode: (mode) => set({ actionMode: mode }),
  setDoctorState: (state) => set({ doctorState: state }),

  toggleFaceAnalysis: () => set((s) => ({ showFaceAnalysis: !s.showFaceAnalysis })),
  toggleEmpathy: () => set((s) => ({ showEmpathy: !s.showEmpathy })),
  toggleAiRecommendation: () => set((s) => ({ showAiRecommendation: !s.showAiRecommendation })),
  setFontScale: (scale) => set({ fontScale: scale }),
  setRegion: (region) => set({ region }),

  onHome: () => {
    set({ currentScreen: 'home', dialogueIndex: 0, prevConvIndex: null, actionMode: 'chips', doctorState: 'idle' });
  },

  onTriageSend: (action) => {
    if (action === 'dialogue') {
      set({ currentScreen: 'chat', dialogueIndex: 0, prevConvIndex: null, actionMode: 'chips', doctorState: 'speaking' });
    } else {
      set({ currentScreen: action });
    }
  },

  getCurrentCase: () => {
    const { currentCaseId } = get();
    return cases.find((c) => c.id === currentCaseId) ?? cases[0];
  },

  // ── Live defaults ──────────────────────────────────────
  // MEDial 3.0: companion(동반+커뮤니티)이 제품. Mock/Live는 연구 아카이브.
  appMode: 'companion',
  liveScreen: 'live-idle',
  wsUrl: 'ws://localhost:8000/ws/consultation',
  wsConnected: false,
  liveDoctorState: 'idle',
  liveTurnCount: 0,
  liveMessages: [],
  liveReport: null,
  currentSTT: '',
  isRecording: false,
  sessions: [],
  selectedSessionCode: null,
  avatarMode: 'css',

  setAppMode: (mode) => set({ appMode: mode }),
  setLiveScreen: (screen) => set({ liveScreen: screen }),
  setWsUrl: (url) => set({ wsUrl: url }),
  setWsConnected: (v) => set({ wsConnected: v }),
  setLiveDoctorState: (state) => set({ liveDoctorState: state }),
  incrementLiveTurn: () => set((s) => ({ liveTurnCount: s.liveTurnCount + 1 })),
  addLiveMessage: (msg) => set((s) => ({ liveMessages: [...s.liveMessages, msg] })),
  setLiveReport: (report) => set({ liveReport: report }),
  setCurrentSTT: (text) => set({ currentSTT: text }),
  setIsRecording: (v) => set({ isRecording: v }),
  setSelectedSession: (code) => set({ selectedSessionCode: code }),
  setAvatarMode: (mode) => set({ avatarMode: mode }),

  resetLiveSession: () => set({
    liveScreen: 'live-idle',
    liveDoctorState: 'idle',
    liveTurnCount: 0,
    liveMessages: [],
    liveReport: null,
    currentSTT: '',
    isRecording: false,
    emergencyActive: false,
  }),

  commitSession: () => {
    const { liveMessages, liveReport } = get();
    if (liveMessages.length === 0) return;
    const code = makeSessionCode();
    const session: LiveSession = {
      sessionCode: code,
      messages: liveMessages,
      report: liveReport,
      startedAt: liveMessages[0]?.timestamp ?? Date.now(),
    };
    set((s) => ({
      sessions: [session, ...s.sessions],
      selectedSessionCode: code,
    }));
  },

  // ── Companion defaults ─────────────────────────────────
  companionTab: 'talk',
  chatMode: 'companion',
  healthContext: emptyHealthContext(),
  triageSuggested: false,
  triageSuggestReason: null,
  emergencyActive: false,
  companionTextScale: 1.0,
  monitoringConsent: true,
  onboardingSeen: false,
  ttsSpeed: 0.85,
  escalationReason: null,
  telemetry: [],

  setMonitoringConsent: (v) => set({ monitoringConsent: v }),
  setOnboardingSeen: (v) => set({ onboardingSeen: v }),
  setTtsSpeed: (v) => set({ ttsSpeed: v }),
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
