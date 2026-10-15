# 2026-10-07 전시 발표 · 전시 영상

저장소에 있는 것(HTML 원본·설계서)과 git 밖에 두는 산출물(`out/`)이 나뉘어 있다.

```
2026-10-07-exhibition/
├─ slides/            발표자료·대본 원본: deck(.en).html · script(.en).html · 폰트 · 캡처(shot-*.webp, 폰트·캡처는 git 밖)
├─ design/            ver3-design.md — 3안(대화 장면을 생성 영상으로) 설계
└─ out/               (git 밖)
   ├─ pdf/            발표자료_한글·English · 발표대본_한글·English
   ├─ audio/          배경음_시안.mp3
   ├─ video/
   │  ├─ 확정본/       1안(10-13)·2안(10-14) 영상 + 확정본_SHA256.txt — 비교용, 바꾸지 않는다(읽기 전용)
   │  ├─ 3안_영상모드/   3안(10-15, 영상 모드, 480p 베타)
   │  └─ 시안_이전/      7분 시연영상 · 10-10 · 10-13 webm 등 옛 시안
   └─ work/            녹화 원본·중간 산출물(영상을 다시 합성할 때만 쓴다)
      ├─ 이전_녹화원본/  1안의 원본 (run/ = webm · plays.json · frames)
      ├─ 2안_녹화원본/
      ├─ 3안_녹화원본/
      └─ tts-sample/    음성 시험 파일
```

- 확정본 확인: `cd out/video/확정본 && sha256sum -c 확정본_SHA256.txt`
- 새 녹화는 `node scripts/record_walk.cjs <out/work/새_폴더> [video]` → `python scripts/mux_voice.py <그 폴더>/run <out/video/…/새이름.mp4>`.
  영상은 덮어쓰지 말고 새 이름으로 만든다.
- 3안 영상 만드는 법과 앱의 영상 모드(`?video=1`)는 `DEVELOPMENT.md` 2026-10-15 항목.
