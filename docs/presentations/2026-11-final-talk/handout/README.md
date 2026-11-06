# 영어 화면 유인물 (외국인 교수님용)

7분 발표 중 모니터에 뜨는 화면을 영어로 바꿔 가로 A4 2×2, 20장(5쪽)으로 모은 인쇄물이다. 앱 화면은 고치지 않는다.

- `ko_en_dictionary.json` — 화면 한글 문구 → 영어. 용어는 대본과 같다(AI Care Orchestrator · service designer · revision request · resident feedback).
- `capture_screens.cjs` — 전시 서버를 걸으며 사전으로 글자를 바꿔 캡처한다.
- `make_handout.py` — 캡처를 모아 `screens_in_english.html`을 만든다. PDF는 이 HTML을 브라우저로 인쇄한다(A4 가로, 배율 100%, 여백 없음).

`screens_in_english.html`(그림이 들어 있어 8MB)과 PDF는 저장소에 두지 않는다(.gitignore). 위 순서로 다시 만든다.
소개 영상은 장면이 서로 겹쳐 넘어가는 순간이 찍히기 쉬우니, 캡처 뒤 `make_handout.py`의 프레임 번호가 맞는지 눈으로 확인한다.
