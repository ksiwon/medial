// src/types/index.ts

export type ScreenId =
  | 'home'
  | 'chat'
  | 'photo'
  | 'decision'
  | 'emergency'
  | 'healthCenter'
  | 'selfCare'
  | 'report';

export type DialogueSpeaker = 'ai' | 'user';
export type PhotoMode = 'wound' | 'medicine';
export type DecisionOutcome = 'emergency' | 'healthCenter' | 'selfCare';

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
    /** 이전 대화 기록 클릭 시 실행되는 팔로업 대화 */
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
  /** 출처 인터뷰 트리 이름 (이미지 제목과 매핑) */
  sourceTree?: string;
}

export interface ScreenDescription {
  screenId: ScreenId;
  label: string;
  title: string;
  desc: string;
  /** 이 화면과 관련된 인터뷰 연구 주제들 */
  researchTopics?: string[];
  themeCodes: ThemeCode[];
  designIntent: Array<{ point: string; rationale: string }>;
}
