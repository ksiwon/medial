// src/types/index.ts

export type AppMode = 'mock' | 'live' | 'companion';

/** MEDial 3.0 하단 3탭: 소통(대화) / 내 건강(오늘의 나) / 정보(소식·영상) */
export type CompanionTab = 'talk' | 'health' | 'info';

export type ScreenId =
  | 'home'
  | 'chat'
  | 'analyzing'
  | 'photo'
  | 'decision'
  | 'emergency'
  | 'healthCenter'
  | 'selfCare'
  | 'report';

export type LiveScreenId =
  | 'live-idle'
  | 'live-chat'
  | 'live-emergency'
  | 'live-report'
  | 'live-complete';

export type WsInboundType =
  | 'session_started'
  | 'session_reset'
  | 'stt_result'
  | 'llm_response'
  | 'tts_audio'
  | 'avatar_video'
  | 'report_ready'
  | 'emergency'
  | 'mode_switch'        // companion → triage 전환 (force/consent)
  | 'triage_suggested'   // 부드러운 상담 제안 (동의 칩)
  | 'error';

export interface WsInboundMessage {
  type: WsInboundType;
  text?: string;
  message?: string;
  audio?: string;        // base64 LINEAR16 wav (24 kHz)
  video?: string;        // base64 mp4
  report?: LiveReport;
  level?: string;
  turn?: number;
  max_turns?: number;
  model?: string;
  session_id?: string;
  session_code?: string;
  mode?: 'companion' | 'triage';
  reason?: string;
}

export interface LiveReport {
  chief_complaint: string;
  symptoms: string[];
  ddx: Array<{ name: string; probability: number }>;
  medications: string[];
  /** Self-care attempts (약국 약, 민간요법 등) — formative study DR2 */
  self_care?: string[];
  triage: string;
  questions: Array<{ question: string; answer: string }>;
  /** 1-2 sentence note from MEDI to the human clinician — DR3/DR4 */
  notes_for_clinician?: string;
  timestamp: number;
  sessionCode: string;
}

export interface LiveMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface LiveSession {
  sessionCode: string;
  messages: LiveMessage[];
  report: LiveReport | null;
  startedAt: number;
}

export type DialogueSpeaker = 'ai' | 'user';
export type PhotoMode = 'wound' | 'medicine';
export type DecisionOutcome = 'emergency' | 'healthCenter' | 'selfCare';
export type ActionMode = 'chips' | 'mic' | 'camera' | 'listening' | 'echo' | 'finish';
export type DoctorState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'emergency';
export type DR = 1 | 2 | 3 | 4;

export interface DialogueTurn {
  id: string;
  speaker: DialogueSpeaker;
  empathy?: string;
  message: string;
  options?: string[];
  nextScreenOnSelect?: ScreenId;
  faceAnalysis?: string;
  triggerPhotoCapture?: boolean;
}

export interface PhotoResultItem {
  tag: 'ok' | 'warn' | 'conflict';
  label: string;
  description: string;
}

export interface PhotoResult {
  type: 'wound' | 'medicine';
  items: PhotoResultItem[];
}

export interface SelfCareStep {
  num: number;
  iconSvg: string;
  title: string;
  description: string;
}

export interface PatientInfo {
  name: string;
  age: number;
  gender: string;
  bloodType: string;
  conditions: string[];
  allergies: string[];
  medications: Array<{ name: string; dose: string; schedule: string }>;
  sessionCount: number;
}

export interface CaseData {
  id: string;
  label: string;
  patient: PatientInfo;
  dialogue: DialogueTurn[];
  photoMode: PhotoMode;
  photoResult: PhotoResult;
  decisionRecommendation: string;
  decisionOutcome: DecisionOutcome;
  selfCareSteps?: SelfCareStep[];
  warningSignals?: string[];
  reportData: {
    todaySummary: string[];
    medicationWarning?: string;
    painLevel: number;
    analysisNote: string;
  };
  prevConversations: Array<{
    daysAgo: number;
    date: string;
    title: string;
    subtitle: string;
    urgent: boolean;
    followUpDialogue: DialogueTurn[];
  }>;
}

export type ThemeCategory = 'barrier' | 'behavior' | 'condition' | 'insight';

export interface ThemeCode {
  code: string;
  codeKr: string;
  category: ThemeCategory;
  quote?: string;
  finding: string;
  sourceTree?: string;
  participantId?: string;
  affinityCode?: string;
  dr?: DR[];
}

export interface InsightQuote {
  p: string;
  quote: string;
  affinityCode: string;
  dr: DR[];
  cluster: string;
}

export interface ScreenDescription {
  screenId: ScreenId;
  label: string;
  title: string;
  desc: string;
  activeDRs: DR[];
  researchTopics?: string[];
  themeCodes: ThemeCode[];
  designIntent: Array<{ point: string; rationale: string }>;
}
