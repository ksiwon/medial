# MEDial 서버 — GPU 환경 구동 가이드

전체 음성 루프(마이크 → **Whisper STT** → Gemini LLM → OpenAI TTS → 응답)를
실제로 돌리기 위한 가이드. **GPU가 필요한 부분은 Whisper STT 하나뿐**입니다.
(LLM은 Gemini API, TTS는 OpenAI API — 둘 다 클라우드라 GPU 불필요.)

> 데모만 빠르게 볼 거면 GPU 없이도 됩니다: STT만 못 쓰고, IoT 이상치 주입·식사
> 사진·커뮤니티·escalation·리포트는 모두 동작합니다. 본 가이드는 **음성 대화까지**
> 포함한 풀 구동용입니다.

---

## 0. 사전 요구사항

| 항목 | 권장 |
|---|---|
| GPU | NVIDIA, VRAM **8GB+** (whisper-large-v3-turbo 기준; 6GB도 가능) |
| CUDA 드라이버 | 12.x (PyTorch 2.4 cu121 호환) |
| OS | Linux 권장 (faiss-gpu 지원). Windows는 faiss-cpu로 동작 |
| Python | 3.10 – 3.12 |
| Node | 18+ (프론트) |
| FFmpeg | 필수 (브라우저 webm/opus 디코딩). 없으면 `imageio-ffmpeg` 번들 사용 |
| API 키 | `GOOGLE_API_KEY`(Gemini), `OPENAI_API_KEY`(TTS) |

---

## 1. 설치

```bash
cd server
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# (1) PyTorch — CUDA 빌드로 먼저 설치 (PyPI 기본은 CPU 빌드일 수 있음)
pip install torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121

# (2) 나머지 의존성
pip install -r requirements.txt
```

- Linux GPU 박스: `faiss-gpu` 자동 설치됨. Windows: `faiss-cpu`.
- `silero-vad`, `transformers`, `accelerate` 등은 requirements에 포함.

---

## 2. 환경 변수 (`.env`)

`.env.example`를 복사해 채웁니다.

```bash
cp .env.example .env
```

핵심 값:

```ini
# 키
GOOGLE_API_KEY=...        # https://aistudio.google.com/apikey (gemini-3.5-flash 접근 권한 필요)
OPENAI_API_KEY=...        # https://platform.openai.com/api-keys

# LLM (검증된 권장값)
LLM_PRIMARY_MODEL=gemini-3.5-flash
LLM_FALLBACK_MODEL=gemini-3.1-flash-lite
LLM_TIMEOUT_SECONDS=6.0       # thinking off 시 ~1.5s, 여유 포함
LLM_MAX_OUTPUT_TOKENS=1024    # 리포트 JSON 트렁케이션 방지

# STT (GPU)
STT_MODEL_ID=openai/whisper-large-v3-turbo
STT_DEVICE=cuda               # GPU 사용. (CPU면 cpu — 매우 느림)
STT_DTYPE=float16             # VRAM 부족 시 그대로, 정밀도 문제 시 float32
STT_VAD_ENABLED=true          # silero-vad 미설치면 false 로
```

> **참고**: `gemini-3.5-flash`는 thinking(추론) 모델이라 서버(`app/modules/llm.py`)에서
> `thinking_budget=0`으로 thinking을 꺼 둡니다 — 별도 설정 불필요. (켜면 지연 폭증 +
> 출력 토큰 잠식으로 JSON이 잘립니다.)

---

## 3. 지식베이스 빌드

```bash
# (필수, 수 초) DDXPlus 감별진단 트리
python scripts/build_ddxplus_tree.py

# (선택, H100 기준 4–6시간) PubMed FAISS 인덱스
# 없어도 서버는 동작합니다 — RAG 컨텍스트만 비게 됩니다.
python scripts/build_pubmed_index.py
```

---

## 4. 실행

```bash
python -m app.main          # http://0.0.0.0:8000
```

기동 로그에 모델/STT/TTS 로딩이 표시됩니다. Whisper가 가장 무거워 첫 기동 시
모델 다운로드(~1.6GB)로 시간이 걸릴 수 있습니다.

프론트(별도 터미널):

```bash
cd ..        # 프로젝트 루트
npm install
npm run dev  # http://localhost:5173
```

브라우저에서:
1. 상단 토글 **2.0** (또는 Live) 선택
2. 우측 TweaksPanel의 서버 URL이 `ws://localhost:8000/ws/consultation` 인지 확인
3. **마이크 권한 허용** → 소통 탭에서 마이크 버튼으로 말하기

---

## 5. 검증

```bash
curl -s http://localhost:8000/api/health | python -m json.tool
```

확인 포인트:
- `"gpu": { "available": true, "name": "..." }`  ← GPU 인식
- `"google_api_key_set": true`, `"openai_api_key_set": true`
- `"rag": { "ddxplus_ready": true, ... }`
- `"llm_primary": "gemini-3.5-flash"`

`/api/health`가 200이면 프론트 상단의 연결 표시가 점등됩니다.

오케스트레이션 로직 회귀 테스트(키 불필요):

```bash
python tests/test_orchestration.py     # 14 passed 기대
```

---

## 6. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `torch.cuda.is_available() == False` | CPU 빌드 설치됨 → 1번의 cu121 index-url로 재설치 |
| CUDA out of memory | 더 작은 STT 모델(`whisper-base`/`small`) 또는 `STT_DTYPE=float16` 유지, 다른 GPU 프로세스 종료 |
| `ModuleNotFoundError: faiss` | PubMed RAG용 — 없으면 `STT`/대화엔 무관. 필요 시 `pip install faiss-cpu` |
| `silero_vad` 관련 에러 | `.env`에서 `STT_VAD_ENABLED=false` |
| 음성이 인식 안 됨 | FFmpeg 경로 확인 → `.env`의 `FFMPEG_BINARY`에 절대경로 지정 |
| 403 `API key ... leaked` / `PERMISSION_DENIED` | Gemini 키 폐기됨 → AI Studio에서 새 키 발급 후 `.env` 교체 |
| 첫 LLM 응답만 느림/폴백 | 콜드 스타트(일시적). 지속 시 `LLM_TIMEOUT_SECONDS` 상향 |
| 마이크 자동 첫인사 음성 안 나옴 | 브라우저 자동재생 정책 — 첫 사용자 조작(마이크 탭) 이후 재생됨 |

---

## 7. 아키텍처 요약 (어디에 무엇이 도는가)

```
브라우저(프론트, :5173)
  · IoT 시뮬 · 식사 촬영 · 소통/정보 탭 · HealthPanel
        │  WebSocket  ws://…:8000/ws/consultation
        ▼
FastAPI 서버(:8000)
  · STT  : Whisper large-v3-turbo   ← GPU
  · LLM  : Gemini 3.5 Flash (API)   ← 클라우드 (thinking off)
  · TTS  : OpenAI gpt-4o-mini-tts (API) ← 클라우드
  · Orchestrator : 신호 통합 → companion↔triage escalation
  · RAG  : DDXPlus(필수) · PubMed FAISS(선택)
```
