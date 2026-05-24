// src/data/communityFeed.ts
// MEDial 2.0 정보 탭 시드 데이터 (단일 사용자 AI 큐레이션 데모).
import { CommunityEvent } from '../types/health';

// 동네·보건소 소식 시드. injectToChat=true 인 항목은 메디가 일상 대화에 자연스럽게 녹인다.
export const SEED_EVENTS: CommunityEvent[] = [
  {
    id: 'evt-flu',
    timestamp: Date.now(),
    source: 'health_center',
    kind: 'advisory',
    title: '독감 유행 주의보',
    body: '남해군에 독감이 유행하고 있어요. 사람 많은 곳은 피하시고 손을 자주 씻어 주세요.',
    injectToChat: true,
    injected: false,
    priority: 2,
  },
  {
    id: 'evt-bp-clinic',
    timestamp: Date.now(),
    source: 'health_center',
    kind: 'event',
    title: '경로당 혈압 측정의 날',
    body: '이번 주 목요일 오전, 마을 경로당에서 무료 혈압 측정을 해드려요.',
    injectToChat: true,
    injected: false,
    priority: 1,
  },
  {
    id: 'evt-grandson',
    timestamp: Date.now(),
    source: 'neighbor',
    kind: 'news',
    title: '아랫집 손자 대학 합격 소식',
    body: '아랫집 순자 어르신 손자가 대학에 합격했대요. 온 동네가 잔치 분위기예요.',
    injectToChat: true,
    injected: false,
    priority: 0,
  },
  {
    id: 'evt-market',
    timestamp: Date.now(),
    source: 'neighbor',
    kind: 'event',
    title: '오일장 안내',
    body: '내일은 읍내 오일장 날이에요. 봄나물이 많이 나왔다고 하네요.',
    injectToChat: false,
    injected: false,
    priority: 0,
  },
];

// 추가 공지 데모(InfoTab '새 공지 받기' 버튼용)
export const EXTRA_ADVISORY: CommunityEvent = {
  id: 'evt-cold-snap',
  timestamp: Date.now(),
  source: 'health_center',
  kind: 'advisory',
  title: '한파 주의보',
  body: '내일 아침 기온이 크게 떨어져요. 새벽 외출은 삼가시고 따뜻하게 입으세요.',
  injectToChat: true,
  injected: false,
  priority: 2,
};

// 오늘의 건강 숏폼 — 실제 유튜브 영상(공신력 있는 출처 위주).
// ※ 영상은 게시자 사정으로 내려갈 수 있으니 주기적으로 ID 점검 권장.
export interface HealthShort {
  youtubeId: string;
  title: string;
  channel: string;
}

export const HEALTH_SHORTS: HealthShort[] = [
  { youtubeId: 'pCyT7MWC_H4', title: '노인 낙상예방 운동 모두 따라하기', channel: '국민건강보험공단' },
  { youtubeId: 'J6d1xAD1v40', title: '우리가 알아야 하는 짧은 이야기 — 고혈압편', channel: '국민건강보험' },
  { youtubeId: 'TIUX-5a9pJQ', title: '노인 고혈압, 치료도 관리법도 다릅니다', channel: '건강정보' },
  { youtubeId: 'xCGE2iVr0YI', title: '매일매일 즐기는 시니어 스트레칭', channel: '어르신 HOME 배움터' },
];
