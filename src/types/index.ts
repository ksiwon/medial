// src/types/index.ts

/** MEDial 3.0 하단 3탭: 소통(대화) / 내 건강(오늘의 나) / 정보(소식·영상) */
export type CompanionTab = 'talk' | 'health' | 'info';

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

/** 메디 아바타 상태 — VirtualDoctor 표정/애니메이션 + 대화 상태. */
export type DoctorState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'emergency';
