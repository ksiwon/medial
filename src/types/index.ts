// src/types/index.ts

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
