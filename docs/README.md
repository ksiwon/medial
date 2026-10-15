# 어디에 무엇이 있나

저장소 밖(`local-data/`, git 제외)까지 포함한 안내. 앱이 읽는 것과 영상·발표 작업물을 구분한다.

## docs/ (저장소 안)

| 위치 | 내용 |
|---|---|
| `research/` | **지금 기준** 연구 문서(19·22·23번이 최우선) · `DECISIONS.md` · `contracts/`(데이터 계약). `AGENTS.md`가 읽는 순서를 정한다 |
| `research/history/` | 지나온 기획·명세·프롬프트. 역사 기록이며 지금 구조를 정당화하지 않는다 |
| `presentations/2026-09/` | 9월 발표자료(전시 · 랩 세미나 · 후속)와 연구노트 1·2탄. HTML이 원본, PDF는 git 밖 |
| `presentations/2026-10-07-exhibition/` | 10월 전시 발표·영상. 안쪽 `README.md` 참고(`slides/` 원본 · `design/` 3안 설계 · `out/` 산출물) |

## local-data/ (git 제외, 앱과 스크립트가 읽는다)

| 위치 | 내용 | 누가 읽나 |
|---|---|---|
| `normalized/` | 원자료에서 만든 마을 레지스트리·장부·지도 | `scripts/import_village/` |
| `runs/sim.sqlite3` | 전시 기록(사흘·27경로) — **유일한 사본, 지우지 말 것** | sim 서버 |
| `runs/real.sqlite3` | real 버전의 기록 | real 서버 · `freeze_sim.py` |
| `runs/backup/` | sim.sqlite3의 옛 백업 3개 + 새 대사 줄 JSON | 읽는 곳 없음(되돌릴 때만) |
| `art/` | 장면 그림(배경·인물·소개 영상 컷) 47장 | 서버 `GET /village/art` |
| `audio/gemini-3.8-flash-tts/` | 지금 쓰는 줄별 음성 + `manifest.json` · `scenes.json` | 서버 `GET /village/voice` · `video3*.py` · `mux_voice.py` |
| `audio/` 나머지 | `…v1-2026-10-13`(옛 음성 백업) · `lite-tts` · `calibration`(시험) | 읽는 곳 없음 |
| `tts/voices.json` | 주민별 목소리 id | `tts_scenes.py` · `tts_voices.py` |
| `tts/old/` | 옛 목소리·연기 지시 사본 | 읽는 곳 없음 |
| `video/clips/` | 3안 생성 영상(`*.480p.mp4`)·듣는 영상·`manifest.json`·받아쓰기 `stt480.txt` | 서버 `GET /village/video`(`?video=1`) · `video3*.py` |
| `video/lab/` | 3안 시험 결과(기준 인물 `faces/`, 비교 사진, 시험 영상 `watch/`) | `face_lab.py` · `seedance_lab*.py` · `video3.py`(기준 인물) |

앱이 읽는 경로는 코드에 있고(`server/app/simulation/village.py`의 `art_dir` · `voice_dir` · `video_dir`, 환경변수 `MEDIAL_ART_DIR` · `MEDIAL_VOICE_DIR` · `MEDIAL_VIDEO_DIR`로 바꿀 수 있다), 위 표의 "읽는 곳 없음"은 지워도 앱이 돌아간다.
