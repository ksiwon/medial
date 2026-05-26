# MEDial 3.0

남해군 보건소 농촌 고령층을 위한 **AI 동반자 + 의료 커뮤니티** 데모.
"아플 때 한 번 쓰는 도구"에서 **매일 곁에 있는 음성 AI 말동무**로 전환 —
일상 대화 속에서 건강을 살피다가 이상이 감지되면 자연스럽게 상담(트리아지)으로
넘어가 보건소에 리포트를 전합니다. ACM CHI '27 + KAIST 산업디자인학과 전시 출품작.

```
┌──────────────────────────┐  WebSocket   ┌──────────────────────────┐
│  React Frontend (Vite)   │ ───────────► │  FastAPI Server (./server)│
│  · 소통(AI 말동무)        │  STT/LLM/    │  STT (모드별)             │
│  · 내 건강(나의 데이터)    │  TTS/오케스  │  Gemini 3.5 · OpenAI TTS │
│  · 정보(소식·건강영상)     │ ◄─────────── │  DDXPlus · PubMed FAISS  │
│  + 손목밴드(IoT, 전제)     │  report      │  오케스트레이터            │
└──────────────────────────┘              └──────────────────────────┘
```

| | 경로 | 스택 |
|---|---|---|
| 프론트엔드 | `./` | React + Vite + TS + styled-components + Zustand |
| 백엔드 | `./server/` | FastAPI + Gemini + OpenAI TTS + FAISS |

**실행 환경 (`RUN_MODE`):**

| `RUN_MODE` | STT | PubMed 인코더 | 시작 시간 | 요구 사양 |
|---|---|---|---|---|
| `notebook` (기본: 노트북) | OpenAI Whisper API | 스킵 | **~2 s** | CPU, OPENAI_API_KEY |
| `gpu_server` (발표 서버) | 로컬 Whisper large-v3-turbo | MedCPT (~400 MB) | ~10 s | GPU, CUDA |

설계 사양: [`docs/REDESIGN_MEDial_3.0.md`](docs/REDESIGN_MEDial_3.0.md) ·
서버 GPU 구동: [`server/GPU_SETUP.md`](server/GPU_SETUP.md)

---

## 빠른 시작 (프론트만)

서버가 없어도 UI는 동작합니다(상단 `연결됨/오프라인` 표시, IoT 시뮬은 정지).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 타입체크 + 프로덕션 빌드
```

폰트는 `public/fonts/` (Pretendard `.otf`), 아바타는 `public/avatar/medi.png`.

---

## 제품: MEDial 3.0 (companion)

기본 진입 화면이자 **유일한 제품**. 하단 3탭:

| 탭 | 내용 |
|---|---|
| **소통** | AI 말동무 '메디'와 음성 대화(push-to-talk). 이상 감지 시 **자동으로 상담 모드**로 전환(설명가능 escalation), 5턴 후 보건소 리포트 |
| **내 건강** | 어르신이 **자기 데이터를 직접** 봄(걸음·혈압·심박·수면·식사) + 데이터 흐름 투명성 + 수집 동의 토글 + 메디 말 속도 |
| **정보** | 동네·보건소 소식(보건소 우선) + 큐레이션 건강 영상(인라인 재생). AI가 공지를 일상 대화에 자연스럽게 녹임 |

핵심 메커니즘 — **오케스트레이터**가 4종 신호(IoT 바이탈·식사 사진·대화 단서·커뮤니티
공지)를 통합해, 임계치를 넘으면 companion → triage 전환을 판정합니다
(`server/app/modules/orchestrator.py`, 임계치 단일 소스: `src/config/escalation.json` —
프론트·서버가 같은 파일을 읽어 드리프트를 방지). 안전장치로 LLM severity와 무관한
독립 red-flag backstop과 RAG 근거 기반 불확실성 인계를 둠.

> 초기 연구 아카이브(단발 문진 **Mock**·실시간 **Live** 화면)는 제품을 companion으로
> 단일화하면서 제거했습니다 — 필요 시 git 히스토리(main)에서 복구할 수 있습니다.

---

## 서버 실행 — 노트북 모드 (CPU, 빠른 시작)

GPU 없이 노트북에서 전체 음성 루프를 돌릴 수 있습니다.  
STT를 OpenAI Whisper API로 처리하므로 로컬 모델 다운로드가 없고 시작이 ~2초입니다.

```bash
cd server
cp .env.example .env
# .env 상단의 GOOGLE_API_KEY + OPENAI_API_KEY 채우기 (RUN_MODE=notebook 기본값)
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/build_ddxplus_tree.py
python -m app.main        # http://localhost:8000
```

```bash
npm run dev               # 다른 터미널 → http://localhost:5173 → 마이크 권한 허용
```

`/api/health`에서 `"run_mode": "notebook"`, `"stt_model": "openai/whisper-1 (api)"` 확인.

---

## 서버 실행 — GPU 서버 모드 (발표 / 풀 스택)

로컬 Whisper + PubMed MedCPT 인코더 풀 로드. GPU(CUDA) 필요.  
자세한 절차: [`server/GPU_SETUP.md`](server/GPU_SETUP.md)

```bash
cd server
cp .env.example .env
# .env 상단 GOOGLE_API_KEY + OPENAI_API_KEY 채우고, RUN_MODE=gpu_server 로 변경
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/build_ddxplus_tree.py
# (선택) python scripts/build_pubmed_index.py   ← PubMed FAISS 빌드 (~수 시간)
python -m app.main        # http://localhost:8000
```

```bash
npm run dev               # 다른 터미널
```

`/api/health`에서 `"run_mode": "gpu_server"`, `"stt_model": "openai/whisper-large-v3-turbo (cuda)"` 확인.

---

## 검증 / 테스트

```bash
npm run build                              # 프론트 타입체크+빌드
cd server && python tests/test_orchestration.py   # escalation 로직 14 케이스
```

검증 완료: 빌드, 오케스트레이션 14/14, escalation WS E2E, 브라우저 전 페이지,
notebook 모드 서버 시작(~2 s) + `/api/health` + WS 핸드셰이크 + 빈 오디오 에러 처리 + BP 위기 에스컬레이션.  
미검증(환경 제약): 실제 마이크 음성 루프·서버 VAD/barge-in·Wav2Lip 립싱크(GPU+마이크 필요).

---

## 연구 배경 (Formative Study, IRB-2026-56)

남해군 농촌 의료취약지 노인 11명 반구조화 인터뷰(N=11, M=64.6세, SD=7.9)에서 도출된
**4가지 디자인 요구사항(DR1–DR4)**, 그리고 2026 최신 연구에 근거합니다.

| DR | 이름 | 3.0 반영 |
|---|---|---|
| **DR1** | 학습 가능성 | 음성 우선·push-to-talk·큰 글씨·전역 글자확대·1회 온보딩 |
| **DR2** | 의료 공백 보완 | 상시 모니터링 → escalation → triage → 보건소 리포트 |
| **DR3** | 지속성·신뢰 | 전담 동반자·지역 책임소재 명시·데이터 보호·상시 면책 |
| **DR4** | 능동적 공감 | 공감 1문장 + 질문 1문장, 설명가능 전환 |

2026 근거: WCAG 2.2(터치 24→48px), CHI 2025(음성 에이전트 턴테이킹),
JMIR 2025(고령 웨어러블: 손목·동기>기능), AIES 2025(신뢰형성),
Frontiers 2025(존엄·감시윤리), KOCCA(고령 숏폼 이용률).

주요 인용: P10 보이스피싱→데이터 보호, P1 음성 편함, P6 3분 진료→트리아지,
P11 15년 단골→지속 관계, P7 감정 담긴 음성→대화형.

연구자 박정원 (KAIST 20220279) · 지도교수 이탁연 (산업디자인학과) ·
ACM CHI '27 / KAIST 학과 전시 출품
