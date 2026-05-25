// src/types/health.ts
// MEDial 3.0 — AI 동반 + 의료 커뮤니티 도메인 타입.
// 4종 신호(IoT·식사·대화·커뮤니티)를 누적하는 HealthContext와
// companion ↔ triage 전환(escalation) 모델을 정의한다.
import escalationConfig from '../config/escalation.json';

// ── 신호 1: IoT 바이탈 (시뮬레이션) ──────────────────────
export interface VitalReading {
  timestamp: number;
  heartRate: number; // bpm
  bloodPressure: { systolic: number; diastolic: number }; // mmHg
  steps: number; // 당일 누적 걸음수
  distanceKm: number; // 당일 이동거리
  location?: { lat: number; lng: number; label?: string }; // GPS
  /** 어젯밤 수면 시간(시간 단위, 소수). 손목밴드 수면 추적 결과를 가정. */
  sleepHours?: number;
}

// ── 신호 2: 식사 촬영 분석 ───────────────────────────────
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealFlag = '고나트륨' | '저단백' | '고당' | '저섬유' | '소량섭취' | '균형';

export interface MealRecord {
  timestamp: number;
  photoUri?: string;
  mealType: MealType;
  aiSummary: string; // "흰쌀밥·김치·된장국 — 나트륨 다소 높음"
  flags: MealFlag[];
}

// ── 신호 3: 일상 대화에서 추출한 단서 ────────────────────
// 카테고리는 노인포괄평가(CGA) 도메인과 한국 농촌 고령자 AI 통화 연구
// (네이버 CareCall, Jeongeup; 건강·수면·식사·운동·외출 5도메인)를 정착점으로 한다.
//  - symptom    : CGA 의학영역 + 트리아지 코어
//  - mood       : GDS / CareCall 우울지표
//  - sleep      : PSQI·ISI / CareCall '수면'
//  - appetite   : MNA / CareCall '식사' + 우울지표 '식욕저하'
//  - medication : CGA 상시복약(다약제) + MEDial 약물오남용 우려
//  - mobility   : CGA 기능/ADL + CareCall '운동·외출' + IoT 걸음수/이동거리
//  - social     : CGA 사회영역 + 대화형 에이전트 외로움 문헌
// cognition(인지)은 일상 대화 기반 신뢰성·민감성 문제로 v3.0 범위에서 의도적 제외.
export type ClueCategory =
  | 'symptom'
  | 'mood'
  | 'sleep'
  | 'appetite'
  | 'medication'
  | 'mobility'
  | 'social';

/**
 * 0 정상 · 1 주의(선별 양성 수준 소프트 신호, 누적) · 2 경고(즉시 트리아지/응급).
 * severity 2 = 응급 red flag(예: 흉통+왼팔저림) — NEWS2 단일 3점/ACS red flag와 정합.
 */
export type ClueSeverity = 0 | 1 | 2;

export interface ConversationClue {
  timestamp: number;
  text: string; // 단서가 된 발화 일부
  category: ClueCategory;
  severity: ClueSeverity;
}

// ── 신호 4: 커뮤니티 / 보건소 이벤트 ─────────────────────
export type EventSource = 'health_center' | 'neighbor';
export type EventKind = 'advisory' | 'news' | 'event'; // 독감유행 · 손자소식 · 마을행사

export interface CommunityEvent {
  id: string;
  timestamp: number;
  source: EventSource;
  kind: EventKind;
  title: string;
  body: string;
  injectToChat: boolean; // 메디가 말동무 중 언급할 대상인지
  injected: boolean; // 이미 대화에 언급했는지
  priority: 0 | 1 | 2;
}

// ── 누적 헬스 컨텍스트 (단일 사용자 데모) ────────────────
export interface HealthContext {
  vitals: VitalReading[];
  meals: MealRecord[];
  clues: ConversationClue[];
  events: CommunityEvent[];
  lastUpdated: number;
}

// ── 대화 모드 & Escalation ───────────────────────────────
export type ChatMode = 'companion' | 'triage';

/** none: 유지 · suggest: 동의 후 진입 · force: 즉시 상담/응급 */
export type EscalationLevel = 'none' | 'suggest' | 'force';

export interface EscalationDecision {
  level: EscalationLevel;
  score: number; // 누적 점수
  reasons: string[]; // 발동 근거 (대시보드/로그용)
}

// ── Escalation 임계치 — 단일 소스(src/config/escalation.json) ─────────
// 값은 프론트·서버가 공유하는 단일 JSON에서 온다. 튜닝은 그 파일 한 곳에서만.
// (과거엔 여기와 orchestrator.py에 같은 값을 손으로 복제 — 드리프트=사고 위험으로 제거)
// 바이탈: NEWS2(RCP 2017) 저혈압·서맥/빈맥 + 2017 ACC/AHA 고혈압 위기(>180/>120) 결합.
// 누적: GDS-SF ≥2/5 (CareCall, 한국 농촌 고령자) 정착으로 suggest=2.
// ※ '가정 단발 측정 트리아지'로 검증된 표준이 아닌 연구 데모 휴리스틱.
export const ESCALATION = escalationConfig;
