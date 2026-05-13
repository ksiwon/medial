// src/data/mockData.ts
import { CaseData, ScreenDescription } from '../types';

// ══════════════════════════════════════════════════════════════════
// CASE 1: 박순옥 — 두통·혈압약 → 보건소
// ══════════════════════════════════════════════════════════════════
const case1: CaseData = {
  id: 'case1',
  label: '박순옥 님 — 두통 · 보건소',
  patient: {
    name: '박순옥',
    age: 71,
    gender: '여',
    bloodType: 'A형',
    conditions: ['고혈압 (2023년 진단)'],
    allergies: ['페니실린 계열'],
    medications: [
      { name: '암로디핀', dose: '5mg', schedule: '아침 1정' },
      { name: '아스피린', dose: '100mg', schedule: '아침 1정' },
    ],
    sessionCount: 12,
  },
  dialogue: [
    { id: 'd0', speaker: 'user', message: '머리가 아프고 어지러워서요...' },
    {
      id: 'd1',
      speaker: 'ai',
      empathy: '오늘도 오셨네요, 반가워요.',
      message: '머리가 아프고 어지러우시군요. 언제부터 그러셨어요?',
      faceAnalysis: '표정을 보니 많이 힘드신 것 같아요',
      options: ['오늘 아침 일어나면서부터요', '어제부터인 것 같아요', '며칠 됐어요'],
    },
    { id: 'd2', speaker: 'user', message: '오늘 아침 일어나면서부터요' },
    {
      id: 'd3',
      speaker: 'ai',
      empathy: '아, 아침부터 고생하셨군요.',
      message: '최근에 혈압약을 바꾸셨나요?',
      options: ['네, 지난주에 바꿨어요', '아니요, 그대로예요', '잘 모르겠어요'],
    },
    { id: 'd4', speaker: 'user', message: '네, 지난주에 바꿨어요' },
    {
      id: 'd5',
      speaker: 'ai',
      empathy: '약이 바뀐 후에 시작됐을 수 있어요.',
      message: '드시는 약 봉투가 있으면 사진으로 보여주실 수 있어요?',
      triggerPhotoCapture: true,
      options: ['사진은 없어요'],
      nextScreenOnSelect: 'decision',
    },
  ],
  photoMode: 'medicine',
  photoResult: {
    type: 'medicine',
    items: [
      { tag: 'ok',   label: '암로디핀 5mg',   description: '혈압약 · 아침 1정 — 정상 처방' },
      { tag: 'ok',   label: '아스피린 100mg', description: '혈전 예방 · 아침 1정 — 정상 처방' },
      { tag: 'warn', label: '부작용 주의',     description: '암로디핀 변경 후 두통·어지러움은 흔한 초기 부작용이에요. 보건소 선생님께 확인이 필요합니다.' },
    ],
  },
  decisionRecommendation: '두통과 어지러움이 함께 온 데다 최근 혈압약도 바뀌었어요. 오늘 보건소에 가보시는 게 좋겠어요.',
  decisionOutcome: 'healthCenter',
  reportData: {
    todaySummary: [
      '혈압약(암로디핀) 변경 1주일 후 두통·어지러움 동시 발생',
      '약 봉투 사진 분석 완료 — 현재 투약 이상 없음, 부작용 가능성 있음',
      '보건소 의사 선생님 연결 권고 — 처방 재검토 필요',
    ],
    medicationWarning: '암로디핀 변경 후 두통 부작용 가능성. 처방 재검토 필요 여부 확인 권고.',
    painLevel: 7,
    analysisNote: '음성 톤 저하 + 눈썹 미간 수축 감지 — 통증 정도 높음으로 판단',
  },
  prevConversations: [
    {
      daysAgo: 3, date: '5월 9일',
      title: '혈압약 바꾼 후 두통', subtitle: '복약 조정 안내 완료', urgent: true,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '그때 두통 때문에 다시 왔어요' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '다시 오셨군요, 반가워요.',
          message: '지난번에 혈압약 바꾸신 후 두통으로 오셨었는데, 그 뒤로 좀 나아지셨어요?',
          options: ['많이 나아졌어요', '비슷해요', '더 심해진 것 같아요'],
        },
        { id: 'f2', speaker: 'user', message: '비슷해요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '많이 힘드셨겠어요.',
          message: '두통이 계속되고 있군요. 지금도 어지럼증이 함께 있나요?',
          options: ['네, 어지럽기도 해요', '어지럼증은 없어요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
    {
      daysAgo: 8, date: '5월 4일',
      title: '무릎 붓기 사진 분석', subtitle: '정형외과 방문 권고', urgent: false,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '무릎 때문에 다시 왔어요' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '다시 오셨군요.',
          message: '지난번에 무릎이 부었다고 하셨는데, 정형외과는 다녀오셨어요?',
          options: ['네, 다녀왔어요', '아직 못 갔어요'],
        },
        { id: 'f2', speaker: 'user', message: '아직 못 갔어요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '아, 그러셨군요.',
          message: '지금 무릎 상태는 어때요? 부기가 빠졌나요?',
          options: ['부기가 빠졌어요', '비슷해요', '더 부은 것 같아요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
    {
      daysAgo: 22, date: '4월 20일',
      title: '감기 증상 문진', subtitle: '자가 치료 완료', urgent: false,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '감기 이후로 확인하러 왔어요' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '오셨군요.',
          message: '지난번에 감기 증상이 있으셨는데, 이제 많이 나으셨어요?',
          options: ['네, 다 나았어요', '아직 좀 남아있어요', '다른 증상이 생겼어요'],
        },
        { id: 'f2', speaker: 'user', message: '다 나았어요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '다행이네요!',
          message: '다행이에요. 오늘은 다른 불편한 증상이 있어서 오신 건가요?',
          options: ['네, 다른 게 불편해요', '아니요, 확인차 왔어요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
  ],
};

// ══════════════════════════════════════════════════════════════════
// CASE 2: 김영배 — 발 상처(당뇨) → 자가치료
// ══════════════════════════════════════════════════════════════════
const case2: CaseData = {
  id: 'case2',
  label: '김영배 님 — 발 상처 · 자가치료',
  patient: {
    name: '김영배',
    age: 78,
    gender: '남',
    bloodType: 'B형',
    conditions: ['당뇨 2형 (2019년 진단)', '고지혈증'],
    allergies: ['없음'],
    medications: [
      { name: '메트포르민',    dose: '500mg', schedule: '아침·저녁 1정' },
      { name: '로수바스타틴', dose: '10mg',   schedule: '저녁 1정' },
    ],
    sessionCount: 5,
  },
  dialogue: [
    { id: 'd0', speaker: 'user', message: '발에 상처가 났는데 걱정이 돼서요...' },
    {
      id: 'd1', speaker: 'ai',
      empathy: '영배 님, 오늘도 오셨네요.',
      message: '발에 상처가 나셨군요. 당뇨가 있으시니 빨리 확인해야 해요. 사진으로 보여주실 수 있어요?',
      faceAnalysis: '표정이 걱정스러워 보이세요',
      triggerPhotoCapture: true,
      options: ['말로 설명할게요'],
    },
    { id: 'd2', speaker: 'user', message: '말로 설명할게요' },
    {
      id: 'd3', speaker: 'ai',
      empathy: '걱정되셨겠어요.',
      message: '상처가 생긴 지 얼마나 됐어요?',
      options: ['오늘 생겼어요', '이틀 정도 됐어요', '일주일 넘었어요'],
    },
    { id: 'd4', speaker: 'user', message: '오늘 생겼어요' },
    {
      id: 'd5', speaker: 'ai',
      empathy: '오늘 생긴 거라 다행이에요.',
      message: '피가 멈췄나요? 빨갛게 부었나요?',
      options: ['피는 멈췄어요, 조금 빨개요', '아직 피가 나요', '많이 부었어요'],
      nextScreenOnSelect: 'decision',
    },
  ],
  photoMode: 'wound',
  photoResult: {
    type: 'wound',
    items: [
      { tag: 'ok',   label: '표면 찰과상',  description: '표면 찰과상으로 보여요. 깊이가 얕습니다.' },
      { tag: 'warn', label: '당뇨 주의',    description: '당뇨 환자는 발 상처 감염이 빠를 수 있어요. 매일 확인하세요.' },
      { tag: 'ok',   label: '봉합 불필요',  description: '봉합이 필요한 수준은 아니에요. 자가 치료 가능합니다.' },
    ],
  },
  decisionRecommendation: '오늘 생긴 표면 찰과상이고 지혈됐어요. 집에서 깨끗이 씻고 드레싱하시면 되지만, 당뇨가 있으시니 매일 꼭 확인하셔야 해요.',
  decisionOutcome: 'selfCare',
  selfCareSteps: [
    { num: 1, iconSvg: 'water',    title: '흐르는 물에 5분 이상 씻어 주세요',   description: '비누를 사용해 상처 부위를 흐르는 물로 충분히 씻어 주세요.' },
    { num: 2, iconSvg: 'compress', title: '깨끗한 거즈로 가볍게 눌러 주세요',   description: '깨끗한 거즈나 수건으로 상처를 살짝 눌러 지혈하세요. 문지르지 마세요.' },
    { num: 3, iconSvg: 'medicine', title: '소독 후 반창고를 붙여 주세요',        description: '소독약(클로르헥시딘 또는 포비돈)으로 소독하고 반창고로 덮어 주세요.' },
    { num: 4, iconSvg: 'check',    title: '매일 아침 상처를 확인하세요',         description: '당뇨가 있으시면 3일 이상 빨갛거나 부으면 바로 보건소에 가세요.' },
  ],
  reportData: {
    todaySummary: [
      '오른쪽 발 엄지 표면 찰과상 (오늘 발생, 지혈 완료)',
      '상처 사진 분석: 봉합 불필요, 당뇨 환자 주의 필요',
      '자가 치료 안내 완료 — 48시간 후 상태 재확인 예정',
    ],
    painLevel: 3,
    analysisNote: '음성 안정적, 표정 걱정됨 — 당뇨 합병증 우려로 판단',
  },
  prevConversations: [
    {
      daysAgo: 5, date: '5월 7일',
      title: '혈당 수치 높음 이상', subtitle: '식이 조절 안내', urgent: false,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '혈당이 계속 높아서요...' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '다시 오셨군요.',
          message: '지난번에 혈당 수치가 높으셨는데, 식이 조절 잘 되고 계세요?',
          options: ['네, 조금 조절했어요', '잘 안 됐어요'],
        },
        { id: 'f2', speaker: 'user', message: '잘 안 됐어요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '쉽지 않으셨겠어요.',
          message: '지금 혈당 수치가 얼마나 되는지 재봤나요?',
          options: ['재봤는데 높아요', '안 재봤어요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
    {
      daysAgo: 14, date: '4월 28일',
      title: '첫 상담 — 당뇨 이력 등록', subtitle: '기저질환 등록 완료', urgent: false,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '당뇨 관련해서 다시 왔어요' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '오셨군요.',
          message: '처음 오셨을 때 당뇨 이력 등록해드렸는데, 그 뒤로 몸은 어떠셨어요?',
          options: ['괜찮았어요', '혈당이 불안정해요', '발에 문제가 생겼어요'],
        },
        { id: 'f2', speaker: 'user', message: '발에 문제가 생겼어요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '당뇨 발 관리가 중요해요.',
          message: '발에 어떤 문제가 있으세요? 상처가 났나요, 저리거나 아픈가요?',
          options: ['상처가 났어요', '저리고 아파요', '색이 변했어요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
  ],
};

// ══════════════════════════════════════════════════════════════════
// CASE 3: 이정숙 — 흉통·왼팔저림 → 응급 119
// ══════════════════════════════════════════════════════════════════
const case3: CaseData = {
  id: 'case3',
  label: '이정숙 님 — 흉통 · 응급 119',
  patient: {
    name: '이정숙',
    age: 83,
    gender: '여',
    bloodType: 'O형',
    conditions: ['류마티스 관절염 (2015년 진단)', '골다공증'],
    allergies: ['없음'],
    medications: [
      { name: '메토트렉세이트', dose: '7.5mg', schedule: '주 1회 월요일' },
      { name: '엽산',           dose: '5mg',   schedule: '주 6회 (월 제외)' },
    ],
    sessionCount: 3,
  },
  dialogue: [
    { id: 'd0', speaker: 'user', message: '가슴이 갑자기 아프고 숨이 막혀요...' },
    {
      id: 'd1', speaker: 'ai',
      empathy: '정숙 님, 많이 걱정되는 표정이시네요.',
      message: '가슴이 아프고 숨이 막히세요? 지금 바로 확인해야 해요. 통증이 언제부터 시작됐어요?',
      faceAnalysis: '통증이 심하신 것 같아요 — 빠르게 살펴볼게요',
      options: ['지금 막 시작됐어요, 15분 됐어요', '한 시간 됐어요', '아까부터 계속이에요'],
    },
    { id: 'd2', speaker: 'user', message: '지금 막 시작됐어요, 15분 됐어요' },
    {
      id: 'd3', speaker: 'ai',
      empathy: '빠르게 도움을 받으셔야 할 것 같아요.',
      message: '왼쪽 팔이나 턱으로 통증이 퍼지나요?',
      options: ['네, 왼쪽 팔이 저려요', '아니요, 가슴만 아파요', '잘 모르겠어요'],
    },
    { id: 'd4', speaker: 'user', message: '네, 왼쪽 팔이 저려요' },
    {
      id: 'd5', speaker: 'ai',
      empathy: '지금 바로 도움이 필요해요.',
      message: '지금 바로 119에 연락해야 할 것 같아요. 같이 계신 분이 있으세요?',
      options: ['혼자 있어요', '가족이 있어요'],
      nextScreenOnSelect: 'decision',
    },
  ],
  photoMode: 'wound',
  photoResult: { type: 'wound', items: [] },
  decisionRecommendation: '가슴 통증과 왼팔 저림이 15분 이상 지속되고 있어요. 심장 관련 응급 상황일 수 있습니다. 지금 바로 119에 연락해 주세요.',
  decisionOutcome: 'emergency',
  reportData: {
    todaySummary: [
      '갑작스러운 흉통 + 왼팔 저림 15분 이상 지속',
      '심근경색 의심 증상 — 즉각적 응급 대응 필요',
      '119 연결 완료 — 구급대원에게 정보 전달',
    ],
    painLevel: 9,
    analysisNote: '음성 긴박함 감지 + 미간 강하게 수축 — 극심한 통증 및 불안 상태',
  },
  prevConversations: [
    {
      daysAgo: 7, date: '5월 5일',
      title: '손가락 관절 통증 악화', subtitle: '진통제 복용 안내', urgent: false,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '손가락이 계속 아파서요' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '다시 오셨군요.',
          message: '지난번에 손가락 관절 통증이 심하셨는데, 진통제 드시고 나서 좀 나아지셨어요?',
          options: ['조금 나아졌어요', '별로 안 들었어요', '더 다른 곳이 아파요'],
        },
        { id: 'f2', speaker: 'user', message: '더 다른 곳이 아파요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '많이 힘드셨겠어요.',
          message: '어디가 아프신가요? 가슴이나 숨쉬기도 불편하신 건 없나요?',
          options: ['가슴이 아파요', '관절만 아파요', '숨쉬기가 힘들어요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
    {
      daysAgo: 20, date: '4월 22일',
      title: '첫 상담 — 관절염 이력 등록', subtitle: '기저질환 등록 완료', urgent: false,
      followUpDialogue: [
        { id: 'f0', speaker: 'user', message: '관절 때문에 다시 왔어요' },
        {
          id: 'f1', speaker: 'ai',
          empathy: '오셨군요.',
          message: '처음 오셨을 때 류마티스 관절염 이력 등록해드렸는데, 그동안 잘 지내셨어요?',
          options: ['괜찮았어요', '관절이 많이 아팠어요', '다른 증상이 생겼어요'],
        },
        { id: 'f2', speaker: 'user', message: '다른 증상이 생겼어요' },
        {
          id: 'f3', speaker: 'ai',
          empathy: '말씀해 주세요.',
          message: '어떤 증상이 새로 생기셨어요?',
          options: ['가슴이 아프고 숨이 막혀요', '손발이 저려요', '두통이 있어요'],
          nextScreenOnSelect: 'decision',
        },
      ],
    },
  ],
};

export const cases: CaseData[] = [case1, case2, case3];
export const defaultCase = case1;

export const screenDescriptions: ScreenDescription[] = [

  // ══════════════════════════════════════════════════════════════════
  // 1. 홈 화면
  // 연구 주제: Cause of Withdrawal 3가지 · Overestimation of Digital Literacy
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'home',
    label: '홈 화면',
    title: '버튼 하나가 전부인 이유',
    researchTopics: [
      'Cause of Withdrawal 3가지',
      'Overestimation of Digital Literacy among the Elderly',
    ],
    desc: '인터뷰에서 확인된 앱 포기 3원인(과거 실패 경험·초기 진입 장벽·노화 한계)은 모두 이 화면 하나로 대응합니다. 동시에 고령층은 이미 AI와 스마트폰에 능숙하며 배움에 능동적이므로, 능력이 아닌 경험의 기회만 제공하면 됩니다.',
    themeCodes: [
      {
        code: 'High Initial Entry Barriers',
        codeKr: '높은 초기 진입 장벽',
        category: 'barrier',
        sourceTree: 'Cause of Withdrawal 3가지',
        quote: '앱 사용법을 가르쳐 줄 사람이 필요하지만 한번 가르쳐 주면 그 뒤엔 잘 씀',
        finding: '앱 포기 3원인 중 초기 진입 장벽이 가장 큰 비중. 한 번 어렵다고 느끼면 재진입하지 않음. 마이크 버튼 하나만 배치해 진입 마찰을 0으로 낮춤.',
      },
      {
        code: 'Resistance from Past Negative Experiences',
        codeKr: '과거 실패 경험으로 인한 저항감',
        category: 'barrier',
        sourceTree: 'Cause of Withdrawal 3가지',
        quote: '처음 써보는 기기 사용 실패 경험으로 인한 위축 / 과거의 부정적 경험이 새로운 기술에 대한 접근을 거부',
        finding: '기기 첫 실패 경험이 이후 새 기술 전체에 대한 거부로 이어짐. 첫 화면에서 성공 경험을 빠르게 제공해야 지속 사용 가능. 진입 마찰 = 0.',
      },
      {
        code: 'Aging-related Limitations',
        codeKr: '노화로 인한 신체·인지 한계',
        category: 'barrier',
        sourceTree: 'Cause of Withdrawal 3가지',
        quote: '고령자의 신체적 한계 극복을 위한 음성 선호 / 노화로 인해 사용의 연속성이 없으면 리터러시가 급격히 하락',
        finding: '음성은 시력·운동 한계를 우회하는 가장 자연스러운 입력. 연속성이 끊기면 리터러시가 급격히 낮아지므로 이전 대화 기록으로 재진입 경로를 제공해야 함.',
      },
      {
        code: 'Overestimation of Digital Literacy',
        codeKr: '고령자 디지털 리터러시 과소평가',
        category: 'insight',
        sourceTree: 'Overestimation of Digital Literacy among the Elderly',
        quote: 'AI를 여러 매체에서 지속적으로 접해서 잘 알고 있음 / 능력이 부족한 것이 아니라 "경험"이 부족한 것임',
        finding: 'LLM을 일상으로 활용하는 고령자 그룹 존재. 스마트폰 사용은 더 이상 pain point가 아님. 처음 교육만 해주면 이후 스스로 잘 사용함. 어렵게 만들지 않는 것이 핵심.',
      },
      {
        code: 'Personalized AI for Continuous Care',
        codeKr: '지속 관계를 만드는 개인화 AI',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '과거 기록을 기억하는 나만의 AI가 주는 신뢰가 지속 사용의 동기가 됨',
        finding: '이전 대화 기록 표시로 "나를 기억하는 AI" 느낌을 만들어야 함. 연속성 자체가 신뢰이며 지속 사용의 핵심 동기.',
      },
    ],
    designIntent: [
      { point: '마이크 버튼 단일 CTA', rationale: '화면 중앙에 큰 버튼 하나만. 진입 실패 경험 방지.' },
      { point: '이전 대화 기록 (하단)', rationale: '"나를 기억해주는 AI" 기대 시각화. urgent 색상 구분으로 중요도 전달. 탭으로 재진입.' },
      { point: '음성 전용 입력', rationale: '노화 한계(시력·운동) + 과거 실패 저항 동시 해소. 가장 친숙한 인터페이스 = 말하기.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 2. 채팅 화면
  // 연구 주제: Healthcare decision-making patterns · Cause of Withdrawal
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'chat',
    label: '아바타 대화',
    title: '공감이 먼저, 전문성은 그다음',
    researchTopics: [
      'Healthcare decision-making patterns of senior patients',
      'Cause of Withdrawal 3가지',
    ],
    desc: '"AI가 막막하고 감정 없는 반응이 심리적 장벽으로 작용한다"는 직접 발언이 인터뷰에서 나왔습니다. 공감 → 전문성 순서가 지속 케어 관계를 만들며, 음성·표정 멀티모달 분석이 비대면 진단의 한계를 극복합니다.',
    themeCodes: [
      {
        code: 'Emotional Closeness',
        codeKr: '정서적 친밀감',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: 'AI 막막하고 감정 없는 반응이 심리적 장벽으로 작용 / 음성을 통한 감정 반영 대화 선호',
        finding: '공감 없이 바로 묻는 AI는 차갑게 느껴짐. 음성 톤과 표정을 반영해 대화하는 것이 정서적 친밀감 형성의 핵심.',
      },
      {
        code: 'Clinical Expertise',
        codeKr: '임상 전문성',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '전문가다운 태도 갖추기를 기대 / 근거 중심의 정보 전달 필요',
        finding: '공감만으로는 부족. 전문적인 의료 멘트와 근거 기반 정보 전달이 신뢰 형성의 두 번째 조건. 공감 → 전문성 순서가 핵심.',
      },
      {
        code: 'Empathetic Clinical Continuity',
        codeKr: '공감형 임상 연속성',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: 'AI가 친구처럼 반응하면서도 전문가다운 태도 갖추기를 기대',
        finding: '공감과 전문성이 조화된 문진으로 신뢰 구축. 이전 대화 맥락을 기억하며 대화하는 것이 "나만의 의사" 느낌.',
      },
      {
        code: 'Necessity of Multimodal',
        codeKr: '멀티모달의 필요성',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '비대면 표현의 한계를 극복하기 위한 음성·영상 입력 필요 / 증상 표현이 모호할 때가 많아 능동적인 가이드가 필요',
        finding: '텍스트만으로는 고통 정도 파악 불가. 표정·음성 톤 분석이 진단 정확도를 높임. 증상 모호 시 카메라 촬영으로 유도.',
      },
      {
        code: 'Accuracy for Decision Delegation',
        codeKr: 'AI 의사결정 위임을 위한 정확도',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: 'AI에게 의사결정을 위임하고자 함 / 인간의 실수 가능성을 AI의 정밀함이 대체',
        finding: '근거 중심의 정보 전달이 신뢰 형성의 조건. 정확도가 충분하면 AI에게 위임하려는 의향 있음.',
      },
    ],
    designIntent: [
      { point: 'SVG 아바타 (감정 표현)', rationale: '말할 때 입이 움직임. 텍스트 채팅보다 사람과 대화하는 느낌.' },
      { point: '표정·음성 분석 배너', rationale: '전면 카메라 표정 감지 + 음성 톤 결과를 상단에 표시. 멀티모달 입력 가시화.' },
      { point: '공감 줄 → 선택지 순서', rationale: '"힘드셨겠어요" 공감 먼저, 선택지 나중. 의료 AI의 차가움 완화.' },
      { point: '카메라 촬영 자동 유도', rationale: '증상 키워드 등장 시 촬영 버튼이 대화 안에 자연스럽게 등장.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 3. 사진 화면
  // 연구 주제: Self-management as a substitute for inaccessible healthcare
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'photo',
    label: '사진으로 보여주기',
    title: '보건소 선생님께 사진 보내듯이',
    researchTopics: [
      'Self-management as a substitute for inaccessible healthcare',
    ],
    desc: '"멀티모달 진단"이라는 말 대신 "사진으로 보여주기"를 씁니다. 고령자가 이미 아는 행동(카카오톡 사진 전송)과 연결합니다. 보건소 공무원 인터뷰에서 "약 중복 처방 확인 기능이 필요하다"는 직접 요청이 있었습니다.',
    themeCodes: [
      {
        code: 'Self-management as a substitute',
        codeKr: '접근 불가 의료의 대체로서 자가 관리',
        category: 'behavior',
        sourceTree: 'Self-management as a substitute for inaccessible healthcare',
        quote: '한 보건소 소장이 2천명 가까이 담당',
        finding: '보건소장 1인이 2천명 담당하는 현실. 의료 인력 공백을 AI가 채워야 함. 약 봉투 사진으로 DUR(의약품 중복 처방 확인) 기능 실현.',
      },
      {
        code: 'Necessity of Multimodal (시각 진단)',
        codeKr: '멀티모달 — 시각 진단',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '증상 표현이 모호할 때가 많아 능동적인 가이드가 필요',
        finding: '말로 설명하기 어려운 증상을 사진으로 대체. 상처 깊이·색상·범위를 AI가 분석해 자가치료 가능 여부 판단.',
      },
    ],
    designIntent: [
      { point: '상처 / 약봉투 두 모드 탭', rationale: '두 기능을 탭으로 명확히 분리. 혼란 방지.' },
      { point: '스캔 라인 가이드', rationale: '카메라 코너 + 스캔 라인으로 올바른 촬영 유도. 설명 없이 행동으로 이해.' },
      { point: '건너뛰기 항상 노출', rationale: '사진 없이도 진행 가능. 부담 제거.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 4. 판단 분기 화면
  // 연구 주제: Self-management · collapse of trust · Healthcare decision-making
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'decision',
    label: '판단 분기',
    title: 'AI가 먼저 판단을 제안한다',
    researchTopics: [
      'Self-management as a substitute for inaccessible healthcare',
      'The collapse of trust in regional healthcare overriding physical barriers',
      'Healthcare decision-making patterns of senior patients',
    ],
    desc: '"자신의 상태를 객관적으로 판단하지 못하며 민간요법에 의존한다"는 패턴이 반복 확인되었습니다. 동시에 지역 의료 불신 및 동네 의원 기피로 인한 의료 공백이 있습니다. MEDial이 근거 기반 판단을 먼저 제시합니다.',
    themeCodes: [
      {
        code: 'Judge himself',
        codeKr: '자가 판단의 한계',
        category: 'behavior',
        sourceTree: 'Self-management as a substitute for inaccessible healthcare',
        quote: '자신의 상태를 객관적으로 판단하지 못함 / 경험 및 민간요법에 의존하는 자가 판단',
        finding: '"별거 아니겠지" 과소평가와 "큰일 났어" 과대평가가 교차. 잘못된 민간요법 의존이 치료 지연으로 이어짐. AI 권고가 이를 대체.',
      },
      {
        code: 'Distrust toward local clinics',
        codeKr: '동네 의원에 대한 불신',
        category: 'behavior',
        sourceTree: 'The collapse of trust in regional healthcare overriding physical barriers',
        quote: '동네 의원은 짧은 진료 시간과 낮은 서비스의 사유로 안 감',
        finding: '짧은 진료 시간 + 낮은 서비스 품질로 동네 의원 기피. MEDial 보건소 연결이 이 공백을 채우는 합리적 대안.',
      },
      {
        code: 'Accuracy for Decision Delegation',
        codeKr: 'AI 의사결정 위임을 위한 정확도',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: 'AI에게 의사결정을 위임하고자 함',
        finding: '정확도가 충분하면 AI에게 위임하려는 의향 있음. 근거 중심 정보 전달이 신뢰의 조건.',
      },
      {
        code: 'Overcoming physical constraints',
        codeKr: '물리적 제약 극복',
        category: 'behavior',
        sourceTree: 'The collapse of trust in regional healthcare overriding physical barriers',
        quote: '부산까지 병원을 다닌다 / 광주까지 병원을 다닌다',
        finding: '지역 의료 불신으로 도시 원정을 감수. MEDial이 신뢰할 수 있는 판단을 제공하면 불필요한 이동을 줄일 수 있음.',
      },
    ],
    designIntent: [
      { point: 'AI 권고 문구 먼저', rationale: '세 버튼 전에 MEDial 권고 문구 표시. 민간요법 의존 대신 근거 기반 판단 제공.' },
      { point: '색상으로 긴급도 구분', rationale: '적색(응급)/청색(보건소)/녹색(자가). 글 없이 색만으로 상황의 무게 전달.' },
      { point: '"권고" 태그', rationale: 'AI 추천 옵션 강조. 판단 위임 욕구를 명시적으로 지원.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 5. 응급 화면
  // 연구 주제: The collapse of trust in regional healthcare
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'emergency',
    label: '응급 연결',
    title: '응급 상황에서 UI는 방해가 된다',
    researchTopics: [
      'The collapse of trust in regional healthcare overriding physical barriers',
    ],
    desc: '지역 의료 불신과 대중교통 열악함으로 인해 응급 시 이동 자체가 불가능한 사례가 반복 확인되었습니다. 시골 의사에 대한 불신, 대중교통 부재, 과잉 진료 경험이 맞물려 119 즉시 연결이 유일한 신뢰 옵션이 됩니다.',
    themeCodes: [
      {
        code: 'Distrust toward rural doctors',
        codeKr: '시골 의사에 대한 불신',
        category: 'behavior',
        sourceTree: 'The collapse of trust in regional healthcare overriding physical barriers',
        quote: '시골 의사들은 실력도 없고 과잉 진료를 하려고 해서 주민들에게 신뢰도가 없음 / 시골에서 제때 치료를 못 받아 다행히 도시로 가서 치료 완료',
        finding: '지역 병원 방문 대신 도시 원정·자가치료를 선택하는 이유. 응급 상황에서 "지역 병원 가기"는 선택지가 아님. 119 직접 연결이 신뢰를 받음.',
      },
      {
        code: 'The collapse of trust in regional healthcare',
        codeKr: '물리적 장벽을 넘는 지역 의료 신뢰 붕괴',
        category: 'behavior',
        sourceTree: 'The collapse of trust in regional healthcare overriding physical barriers',
        quote: '대중교통의 열악함과 시간적 비용으로 이동 힘들어',
        finding: '대중교통 부족 + 시골 의사 불신이 겹쳐 응급 발생 시 119만이 실질적 옵션. 앱이 직접 연결해야 함.',
      },
    ],
    designIntent: [
      { point: '전면 적색 배경', rationale: '화면 전체가 빨간색. 어느 각도에서도 긴급 상황임을 인지.' },
      { point: '구급대원 환자 카드', rationale: '대기 중 환자 정보 카드 표시. 구급대원이 폰을 보면 즉시 파악. 소통 단절 해소.' },
      { point: '깜빡임 연결 상태', rationale: '진행 중임을 시각적으로 확인. 불안 감소.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 6. 보건소 연결 화면
  // 연구 주제: Healthcare decision-making · Self-management · collapse of trust
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'healthCenter',
    label: '보건소 연결',
    title: '진료 전에 의사가 이미 알고 있다',
    researchTopics: [
      'Healthcare decision-making patterns of senior patients',
      'Self-management as a substitute for inaccessible healthcare',
      'The collapse of trust in regional healthcare overriding physical barriers',
    ],
    desc: '보건소 소장 1인이 2천명을 담당하는 현실, 짧은 진료 시간, 그리고 "아는 의사에게 연결된다"는 느낌이 핵심입니다. 인터뷰에서 지인 추천으로 병원을 선택하는 패턴이 확인되었습니다 — MEDial이 이 신뢰 관계를 대체합니다.',
    themeCodes: [
      {
        code: 'Recommendation of Close Person',
        codeKr: '지인 추천으로 병원 선택',
        category: 'behavior',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '고령자들은 자신의 경험이나 지인의 추천을 강하게 신뢰 / 지인의 병원에 방문',
        finding: '자인의 추천을 통해 도시의 큰 병원으로 가는 경우가 대부분. "알고 신뢰하는 사람의 추천"이 병원 선택의 핵심 기준. → MEDial이 "아는 선생님께 연결" 느낌 제공.',
      },
      {
        code: 'Building Rapport with PCP',
        codeKr: '주치의와의 라포 형성',
        category: 'behavior',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '전문적인 의료 멘트가 필요할 때는 근거를 들며 판단을 내리는 것이 중요. 환자가 해당 내용을 잘 받아들이도록 라포가 잘 쌓여야 함.',
        finding: '공감 대화 → 전문적 판단 순서로 신뢰 형성. 라포가 없으면 치료 지시도 받아들이지 않음. 의사 아바타로 친근감 제공.',
      },
      {
        code: 'Someone\'s help (의료 인력 공백)',
        codeKr: '의료 인력 공백과 지역사회 의존',
        category: 'behavior',
        sourceTree: 'Self-management as a substitute for inaccessible healthcare',
        quote: '한 보건소의 소장이 2천명 가까이 담당 / 전문 의료·돌봄 인력의 빈자리를 이웃 & 리더가 대신 봐줌',
        finding: '간병인 수요 많으나 인력 턱없이 부족. 전문 의료 빈자리를 이웃이 채움. AI가 이 공백을 일부 구조적으로 채울 수 있음.',
      },
      {
        code: 'Disruption of Communication and Trust',
        codeKr: '소통과 신뢰의 단절',
        category: 'barrier',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '짧은 진료 시간, 의사가 환자에게 상황 맞추며 소통해 단절이 생김',
        finding: '짧은 진료 시간 안에 증상 모두 설명하기 어려움. 사전 리포트 전달이 이 문제를 해결.',
      },
      {
        code: 'Overcoming physical constraints',
        codeKr: '물리적 제약 극복 — 비대면 연결',
        category: 'behavior',
        sourceTree: 'The collapse of trust in regional healthcare overriding physical barriers',
        quote: '좋은 의료 서비스를 받기 위해 주기적으로 도시 병원 방문',
        finding: '도시 원정 없이 보건소 선생님과 직접 연결. 비대면이 물리적 장벽을 우회.',
      },
    ],
    designIntent: [
      { point: '의사 아바타 + 이름', rationale: '"아는 선생님께 연결"되는 라포 형성 기대 반영. 지인 추천 신뢰 패턴 모사.' },
      { point: '리포트 자동 선전달', rationale: '연결 전 기본 정보·투약·증상이 이미 전달됨. 짧은 진료 시간 소통 단절 해소.' },
      { point: '전화 + 리포트 보기', rationale: '전화 부담스러운 고령자를 위한 대안 경로.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 7. 자가 치료 화면
  // 연구 주제: Self-management · Cause of Withdrawal
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'selfCare',
    label: '자가 치료 안내',
    title: '구체적이고 단순하게, 단계별로',
    researchTopics: [
      'Self-management as a substitute for inaccessible healthcare',
      'Cause of Withdrawal 3가지',
    ],
    desc: '"신뢰할 만한 병원을 못 찾으면 민간요법과 자가 치료로 집에서 해결한다"는 패턴이 반복 확인되었습니다. MEDial은 정확한 단계별 가이드를 제공해 잘못된 민간요법 의존을 줄입니다.',
    themeCodes: [
      {
        code: 'Self-management as a substitute',
        codeKr: '접근 불가 의료의 대체로서 자가 관리',
        category: 'behavior',
        sourceTree: 'Self-management as a substitute for inaccessible healthcare',
        quote: '만약 신뢰할만한 병원을 못 찾을 경우 간병인/자가 치료 등으로 집에서 해결',
        finding: '신뢰 병원 부재 시 집에서 해결. 이때 잘못된 민간요법 의존이 많아 정확한 가이드가 필요.',
      },
      {
        code: 'Aging-related Limitations (기억)',
        codeKr: '노화 관련 한계 — 기억 상실',
        category: 'barrier',
        sourceTree: 'Cause of Withdrawal 3가지',
        quote: '노화로 인한 기억 상실이 지속 사용의 가장 큰 기술적 걸림돌',
        finding: '자가 치료 단계는 기억하기 쉬운 짧은 문장 + 번호로. 복잡한 설명은 따라하기 어려움.',
      },
      {
        code: 'Judge himself (민간요법 의존)',
        codeKr: '민간요법 의존 자가 판단',
        category: 'behavior',
        sourceTree: 'Self-management as a substitute for inaccessible healthcare',
        quote: '경험 및 민간요법에 의존하는 자가 판단',
        finding: '잘못된 민간요법을 MEDial 단계별 가이드로 대체. 의료 접근성 문제를 정보 정확도로 보완.',
      },
    ],
    designIntent: [
      { point: '번호 + 한 문장', rationale: '이모지 금지. 한 단계 = 한 문장. 기억 한계 대응.' },
      { point: '30분 재확인 타이머', rationale: '상태 악화 시 판단 화면으로 돌아가는 경로 명확화.' },
      { point: '악화 경고 버튼 항상 노출', rationale: '숨기지 않아야 제때 눌림.' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 8. 리포트 화면
  // 연구 주제: Conclusion · Healthcare decision-making · collapse of trust
  // ══════════════════════════════════════════════════════════════════
  {
    screenId: 'report',
    label: '의사용 리포트',
    title: '의사가 5초 안에 파악할 수 있어야 한다',
    researchTopics: [
      'Conclusion',
      'Healthcare decision-making patterns of senior patients',
      'The collapse of trust in regional healthcare overriding physical barriers',
    ],
    desc: '인터뷰 Conclusion에서 정리된 AI Doctor 4조건(멀티모달·정확도·초개인화·공감) 중 "정확도"와 "초개인화"를 의사에게 가시적으로 전달하는 도구입니다. Process 5단계 — 물리적 제약 → 신뢰 상실 → 도시 원정 → 라포 형성 → 자가치료 — 의 마지막 대안으로 기능합니다.',
    themeCodes: [
      {
        code: 'Conclusion: AI Doctor 4조건',
        codeKr: 'AI Doctor의 조건 (인터뷰 최종 결론)',
        category: 'insight',
        sourceTree: 'Conclusion',
        quote: '멀티모달로 진찰 필요 / 의사결정을 위임할 정도의 정확도 / 초개인화를 통한 지속 관계 / 공감형 AI',
        finding: '리포트는 이 중 "정확도"(음성·표정 분석 수치화)와 "초개인화"(과거 기록 + 현재 투약 포함)를 실현. 멀티모달·공감은 채팅 화면에서 구현.',
      },
      {
        code: 'Conclusion: Process Pathway',
        codeKr: '고령 환자 의료 이용 5단계 경로',
        category: 'insight',
        sourceTree: 'Conclusion',
        quote: '1) 물리적 제약으로 시골 병원 → 신뢰 상실 2) 지인 추천 받아 도시 원정 3) 여러 병원 후 신중히 선정 4) 라포 축적 → 무조건 신뢰 5) 신뢰 병원 없으면 자가/간병으로 집에서 해결',
        finding: 'MEDial 리포트는 4번(라포 축적)을 AI 기반으로 실현하고, 5번(자가치료 시 정보 부재)을 정확한 가이드로 보완하는 도구.',
      },
      {
        code: 'Continuity of Care',
        codeKr: '진료 연속성',
        category: 'condition',
        sourceTree: 'Healthcare decision-making patterns of senior patients',
        quote: '전담의가 되어 나를 봐주는 느낌이 신뢰와 지속 사용으로 이어짐',
        finding: '과거 기록 + 오늘 기록 포함 리포트 = "나를 기억하는 AI"의 증거. 의사도 맥락 이해 가능.',
      },
      {
        code: 'Disruption of Communication',
        codeKr: '소통 단절 해소',
        category: 'barrier',
        sourceTree: 'The collapse of trust in regional healthcare overriding physical barriers',
        quote: '시골 의료 시스템에 대해 신뢰 상실',
        finding: '짧은 진료 시간에 모든 정보를 설명하기 어려운 고령자. 구조화된 4섹션 리포트가 소통 단절을 해소.',
      },
    ],
    designIntent: [
      { point: '4개 섹션 구조', rationale: '기본 정보 / 현재 투약 / 오늘 증상 / 약 충돌. 의사가 한눈에 파악.' },
      { point: '음성·표정 분석 수치화', rationale: '"통증 7/10 (음성·표정 분석)" — 멀티모달 정성 데이터를 수치화해 의사 판단 지원.' },
      { point: '투약 경고 구역', rationale: '약 충돌 경고 별도 섹션. 보건소 공무원이 직접 요청한 DUR 기능.' },
    ],
  },
];
