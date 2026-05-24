# MEDial Live Demo Server

라이브 AI 데모 전시 (`MEDial_전시기획서_FINAL.html` v3.0) 백엔드.

> 환자 마이크 입력 → Whisper STT → PubMed + DDXPlus RAG → Gemini LLM
> → Google Cloud TTS → (선택) Wav2Lip 립싱크 → 클라이언트 + 의료진 대시보드

엘리스 H100 SXM5 80GB 한 대에 모든 모델이 적재됩니다 (~8 GB VRAM 사용).

## Formative Study (IRB-2026-56) → 시스템 설계 매핑

| 디자인 요구사항 | 인터뷰 근거 | 서버 구현 |
|---|---|---|
| **DR1** 학습 가능성 | P1 텍스트 입력 부담, P2 단조로움 거부 | `system_prompt.py` 150자 한도, "친근한 어조" PERSONA |
| **DR2** 의료 공백 보완 | P1/P11 1-2시간 거리, P6 "3분 진료" 좌절, 약국·민간요법 의존 | `rag_ddxplus.py` 사전 트리아지, `system_prompt.py` ROLE="pre-consultation triage" |
| **DR3** 신뢰 구축 | P11 15년 의사 관계, P10 보이스피싱 경계, P1 "데이터에 의해서" | `session/manager.py` `archive_visit`+`recent_visits`, `WELCOME_BACK_GREETING`, `/api/visits`, `notes_for_clinician` |
| **DR4** 능동적 공감 질문 | P7 "일일이 설명을 해 주는 게 낫다", P2 폼 거부 | `system_prompt.py` 공감→질문 강제, 최대 5턴 능동 질문, DDXPlus `next_symptoms` |

---

## 디렉토리 구조

```
server/
├── app/
│   ├── main.py                       # FastAPI entry
│   ├── config.py                     # pydantic-settings (.env 로드)
│   ├── prompts/system_prompt.py      # MEDI 시스템 프롬프트 (기획서 §3b)
│   ├── modules/
│   │   ├── stt.py                    # Whisper large-v3-turbo + Silero VAD
│   │   ├── tts.py                    # OpenAI gpt-4o-mini-tts (Korean)
│   │   ├── llm.py                    # Gemini primary + fallback (google-genai)
│   │   ├── rag_pubmed.py             # FAISS IVFPQ + MedCPT
│   │   ├── rag_ddxplus.py            # 증상 트리 기반 미수집 증상 추출
│   │   └── avatar.py                 # Wav2Lip + CSS fallback
│   ├── session/
│   │   ├── manager.py                # 세션 상태
│   │   └── dashboard_broadcaster.py  # /ws/dashboard fan-out
│   ├── ws/
│   │   ├── consultation.py           # /ws/consultation (메인)
│   │   └── dashboard.py              # /ws/dashboard
│   ├── api/
│   │   ├── report.py                 # POST /api/report
│   │   └── health.py                 # GET  /api/health
│   └── data/
│       ├── ddxplus_tree.json         # ← 빌드 스크립트가 채움 (stub 포함)
│       └── ddxplus_kr.json           # 49개 질환 한국어
├── scripts/
│   ├── build_pubmed_index.py         # Week 1 선행 작업 (4–6h)
│   ├── build_ddxplus_tree.py         # figshare 다운로드 후 즉시 실행
│   └── test_pipeline.py              # 빠른 LLM 스모크 테스트
├── requirements.txt
├── .env.example
└── README.md
```

---

## 설치

### 1. 시스템 의존성

* Python 3.11 권장 (3.10 / 3.12 동작 확인됨)
* CUDA 12.x + NVIDIA driver (H100 운영 시)
* **FFmpeg** — MediaRecorder webm/opus 디코딩에 필수
  ```bash
  # Ubuntu
  sudo apt install ffmpeg
  # macOS
  brew install ffmpeg
  # Windows: 공식 빌드 다운로드 후 PATH 추가, 또는 imageio-ffmpeg 사용
  ```

### 2. Python 패키지

```bash
cd server
python -m venv .venv
source .venv/bin/activate                # Windows: .venv\Scripts\activate
pip install --upgrade pip
# (선택) PyTorch CUDA 12.1 인덱스 강제
pip install torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

### 3. 환경 변수

```bash
cp .env.example .env
# .env 열어서:
#   - GOOGLE_API_KEY              (Gemini,  https://aistudio.google.com/apikey)
#   - OPENAI_API_KEY              (TTS,     https://platform.openai.com/api-keys)
#   - LLM_PRIMARY_MODEL           (배포 시점 모델 확인)
#   - STT_MODEL_ID                (한국어 정확도 우선이면 ghost613/whisper-large-v3-turbo-korean)
#   - TTS_VOICE                   (coral 권장. alloy/shimmer/nova/sage 등 가능)
```

> **Gemini 모델 이름** — 기획서는 `gemini-3.5-flash` / `gemini-3.1-flash-lite` (2026.05
> 릴리즈)를 명시합니다. 만약 사용 시점에 해당 ID가 활성화되지 않았다면 `.env`에서
> `gemini-2.5-flash` / `gemini-2.5-flash-lite`로 임시 변경하세요. 코드에 하드코딩
> 되어 있지 않습니다.

### 4. RAG 데이터 빌드

#### PubMed (전시 1주 전, ~4–6시간 H100)

```bash
python scripts/build_pubmed_index.py
# 옵션: --limit 100000 으로 빠른 동작 확인
```

* `MedRAG/pubmed` 23.9M 스니펫 → `ncbi/MedCPT-Article-Encoder` 임베딩 → IVFPQ
  (`nlist=4096, m=64, bits=8`) 압축 후 `data_cache/pubmed_ivfpq.faiss` (~3GB)
  로 저장됩니다.
* 사전 계산된 PubMed embeddings 가 NCBI에 공개되어 있어 다운로드 후 임베딩
  단계를 건너뛸 수도 있습니다:
  https://ftp.ncbi.nlm.nih.gov/pub/lu/MedCPT/pubmed_embeddings/

#### DDXPlus (즉시)

1. https://figshare.com/articles/dataset/DDXPlus_Dataset/20043374 에서
   `release_evidences.json`, `release_conditions.json`,
   `release_train_patients.csv` 다운로드 → `data_cache/ddxplus/` 에 배치
2. 빌드 실행:
   ```bash
   python scripts/build_ddxplus_tree.py
   ```
3. `app/data/ddxplus_tree.json` 가 6개 질환 stub → 49개 전체로 교체됩니다.

> 빌드 전에도 stub 데이터로 서버는 동작합니다 (감별진단 6종으로 제한).

### 5. (선택) Wav2Lip 셋업

기본은 `AVATAR_MODE=css` (서버는 비디오를 생성하지 않고 프론트가 CSS 아바타 표시).

실제 Wav2Lip 사용 시:
```bash
git clone https://github.com/Rudrabha/Wav2Lip
# Wav2Lip 폴더의 README 지시대로 face_detection 모델 + Wav2Lip 체크포인트 다운로드
# 체크포인트를 ./data_cache/wav2lip_gan.pth 에 배치
# MEDI 정면 사진을 ./data_cache/medi_face.jpg 에 배치 (1024×1024 권장)
# .env 에서 AVATAR_MODE=wav2lip 으로 변경
```

`app/modules/avatar.py` 의 `Wav2LipAvatar._run_sync` 가 `python Wav2Lip/inference.py`
서브프로세스를 호출합니다. Repo 경로가 다르면 그 라인을 수정하세요.

---

## 실행

```bash
# 개발 (자동 리로드)
RELOAD=true python -m app.main

# 또는
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 프로덕션 (전시)
python -m app.main
```

상태 확인:
```bash
curl http://localhost:8000/api/health | jq
```

스모크 테스트:
```bash
python scripts/test_pipeline.py
```

---

## API 명세 (기획서 §3c)

| 엔드포인트 | 방식 | 입력 | 출력 |
|---|---|---|---|
| `/ws/consultation` | WebSocket | opus/webm 바이너리 + 제어 JSON | `stt_result`, `llm_response`, `tts_audio`, `avatar_video`, `report_ready`, `emergency` |
| `/ws/dashboard` | WebSocket | – (수신 전용) | `{"type":"new_report","report":{...}}` 브로드캐스트 |
| `/api/report` | POST | `{session_id, conversation:[{role,text}]}` | `{chief_complaint, symptoms, ddx[], medications[], triage, questions[]}` |
| `/api/health` | GET | – | `{status, llm_*, rag, gpu, ...}` |

### WebSocket 메시지

**클라이언트 → 서버**
```jsonc
// binary frame: opus/webm 오디오 청크 (MediaRecorder)
{ "type": "start", "case_id": "free_input" }
{ "type": "end_turn" }
{ "type": "finish" }     // 사용자가 5회 전 강제 리포트 생성
{ "type": "reset" }
```

**서버 → 클라이언트**
```jsonc
{ "type": "session_started", "session_id": "...", "session_code": "PT-AB12C" }
{ "type": "stt_result",  "text": "두통이 있어요" }
{ "type": "llm_response","text": "언제부터 시작됐나요?", "turn": 1, "max_turns": 5, "model": "gemini-3.5-flash" }
{ "type": "tts_audio",   "audio": "<base64 LINEAR16 wav>" }
{ "type": "avatar_video","video": "<base64 mp4>" }                  // AVATAR_MODE=wav2lip 일 때만
{ "type": "report_ready","report": { ... 기획서 §05 리포트 스키마 ... } }
{ "type": "emergency",   "level": "119" }
{ "type": "error",       "message": "음성이 인식되지 않았어요..." }
```

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `STT model load failed` | CUDA 미설치 / VRAM 부족 → `.env` 에서 `STT_DEVICE=cpu` (속도 매우 느림) |
| `OpenAI TTS synth failed` | `OPENAI_API_KEY` 미설정 또는 잔액 부족. `/api/health` 의 `openai_api_key_set` 확인 |
| `LLM primary timed out` | 정상 동작 — fallback 모델로 자동 전환. 자주 발생하면 `LLM_TIMEOUT_SECONDS` 증가 |
| `PubMed FAISS index not found` | `scripts/build_pubmed_index.py` 미실행. 임시로 LLM이 RAG 없이 동작 |
| `ffmpeg decode failed` | FFmpeg 미설치 / PATH 누락. `pip install imageio-ffmpeg` 가 fallback |
| 프론트 `Offline` 상태 지속 | `.env` 의 `CORS_ORIGINS` 에 프론트 URL (`http://localhost:5173`) 포함됐는지 확인 |

---

## 레이턴시 예산 (기획서 §02)

| 단계 | 목표 | 실측 (H100) |
|---|---|---|
| STT (Whisper large-v3-turbo) | ~0.4초 | – |
| FAISS IVFPQ 검색 | ~5ms | – |
| Gemini LLM | ~1.5초 | – |
| OpenAI TTS (gpt-4o-mini-tts) | ~0.5–0.8초 | – |
| Wav2Lip | ~0.3–0.8초 | – |
| **E2E** | **~3–4초** | – |

---

## 라이선스 & 면책

* 본 소프트웨어는 KAIST 산업디자인학과 URP 연구 데모용입니다 (IRB-2026-56).
* AI 응답은 실제 의료 진단이 아니며, 의사의 처방을 대체하지 않습니다.
* PubMed, DDXPlus, MedCPT, Wav2Lip 의 라이선스는 각 원저장소를 따릅니다.

문의: 박정원 (20220279) · 지도교수 이탁연 (KAIST)
