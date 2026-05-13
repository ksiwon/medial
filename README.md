# MEDial — 고령층 원격 문진 AI 프로토타입 뷰어

고령층(65세+) 농촌 지역 의료 취약계층을 위한 음성 기반 AI 의료 상담 서비스 연구 프로토타입입니다.

## 기술 스택

- React 18 + Vite + TypeScript
- styled-components (CSS Modules/Tailwind 사용 안 함)
- Zustand (전역 상태 관리)

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 폰트 파일 설치

아래 Pretendard 폰트 파일을 `public/fonts/` 폴더에 복사하세요:

```
public/
  fonts/
    Pretendard-Regular.otf
    Pretendard-Medium.otf
    Pretendard-SemiBold.otf
    Pretendard-Bold.otf
```

> 폰트 파일은 [Pretendard GitHub](https://github.com/orioncactus/pretendard)에서 다운로드하거나,
> 연구 패키지에 포함된 `.otf` 파일을 사용하세요.

### 3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

### 4. 빌드

```bash
npm run build
```

## 프로토타입 구성

```
왼쪽: 폰 목업 (320×620px 앱 화면)
가운데: 인터뷰 분석 패널 (화면별 주제 코딩 + 디자인 의도)
오른쪽: Tweaks 패널 (케이스 전환 / 표시 설정 / 지역 설정)
```

## 케이스

| 케이스 | 환자 | 증상 | 결과 |
|---|---|---|---|
| 1 | 박순옥 (71세) | 두통 · 혈압약 변경 | 보건소 연결 |
| 2 | 김영배 (78세) | 발 상처 (당뇨) | 자가 치료 |
| 3 | 이정숙 (83세) | 흉통 · 왼팔 저림 | 119 응급 |

## 화면 순서

홈 → 아바타 대화 → 사진 촬영 → 판단 분기 → (응급 / 보건소 / 자가치료) → 리포트

## 연구 배경

- KAIST 산업디자인학과 URP 프로그램 (2026 겨울/봄학기)
- 연구자: 박정원 (20220279)
- 지도교수: 이탁연 교수님

논문 투고 목표: ACM CHI / ACM CUI / Ubicomp
