# 출처 목록

확인일 2026-09-10. 원논문/저자 공개본/공식 기관·기술 문서를 우선했다. 웹 검색 snippet만으로 구체적인 수치나 구현을 확정하지 않았다. 아래 열람 범위는 읽은 범위의 한계를 뜻한다.

| ID | 출처 | 열람 범위·사용 |
|---|---|---|
| R01 | [Park et al., Social Simulacra, UIST 2022](https://arxiv.org/abs/2208.04024) / [저자 PDF](https://hci.stanford.edu/publications/2022/Park_SocialSimulacra_UIST22.pdf) | 초록·도입/방법 개요. 설계 변경과 what-if 프로토타이핑 |
| R02 | [Park et al., Generative Agents, UIST 2023](https://arxiv.org/abs/2304.03442) | 초록·구조 개요. 기억·계획·반성 |
| R03 | [Park et al., Generative Agent Simulations of 1,000 People](https://arxiv.org/abs/2411.10109) | 초록·연구 소개. 인터뷰 기반 개인 모사 및 평가 범위 |
| R04 | [Samuel et al., PersonaGym, 2024](https://arxiv.org/abs/2407.18416) | 초록·저자 프로젝트. 페르소나 일관성 시험 |
| R05 | [Zhou et al., SOTOPIA](https://arxiv.org/abs/2310.11667) | 초록·공식 저장소 개요. 상호작용의 다면 평가 |
| R06 | [Agnew et al., The Illusion of Artificial Inclusion, CHI 2024](https://research.google/pubs/the-illusion-of-artificial-inclusion/) / [논문](https://doi.org/10.1145/3613904.3642703) | 초록·핵심 논증/결론. 인간 참여자의 권한과 대체의 한계 |
| R07 | [Jo et al., CareCall, CHI 2023](https://younghokim.net/files/papers/jo-carecall-chi2023.pdf) | 초록·도입·현장 배치/방법 일부. 돌봄 업무 맥락 |
| R08 | [Jo et al., Public Agencies' Expectations and Realities, CHI 2025](https://younghokim.net/files/papers/carecall-stakeholders-chi25.pdf) | 초록·도입·결과 개요. 소장·현장 인력·유지 업무 |
| R09 | [Piao et al., AgentSociety](https://arxiv.org/abs/2502.08691) | 초록·환경/실험 개요. 2026 개정판 페이지 확인 |
| R10 | [Piao et al., AgentSociety 2, 2026 preprint](https://arxiv.org/abs/2607.11895) | 초록·공식 문서. 연구 진행과 참여자 역할 분리 |
| R11 | [Anthis et al., LLM Social Simulations Are a Promising Research Method, 2025](https://arxiv.org/abs/2504.02234) | 초록·입장과 적용범위. 탐색 연구 근거; 실증 성능 자료 아님 |
| R12 | [Chen et al., When Synthetic Users Fail, 2026 preprint](https://arxiv.org/abs/2607.26348) | 초록. 인구통계 기반 설문 모사의 한계; 본 자료 조건과 구분 |
| R13 | [Zimmerman et al., Research through Design, CHI 2007](https://courses.ischool.berkeley.edu/i262/s13/readings_pdf/Zimmerman_Research_Through_Design_as_a_Method_for_IaD_in_HCI_0.pdf) | 초록·도입. 설계 아티팩트와 지식 생산 |
| I01 | [남해군 방문건강관리 안내](https://www.namhae.go.kr/modules/welfare/info/info.do?amode=view&pageCd=DE0101000000&siteGubun=depart&sno=152) | 공식 서비스 설명. 현재 인력·대기시간·연계 계약의 근거는 아님 |
| I02 | [남해군 보건소 소개](https://www.namhae.go.kr/health/Index.do) | 보건소의 공공 건강관리 범위 |
| I03 | [소방청 119구급과](https://www.nfa.go.kr/nfa/introduce/organizationidfo/firstaid/) | 공식 역할 목록. 접수·지도·이송 연계 책임 |
| I04 | [소방청 구급차 도착 전 준비](https://nfsa.go.kr/nfa/safetyinfo/emergencyservice/emergencydeclarationbefore%3Bjsessionid%3DNL3bLvCO6e%2BIiwUK8wvxpXGy.nfa22) | 인계할 환자·상황 정보의 범위 |
| I05 | [소방청 안심콜](https://www.nfa.go.kr/nfa/safetyinfo/emergencyservice%3Bjsessionid%3DexOkbrUu0tywuLCJIRhXdgUi.nfa21) | 사전 등록 정보 활용 개념. MEDial 연동 API 확보 의미 아님 |
| T01 | [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/) | HTTP/WS 서버 기능 참고 |
| T02 | [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/) | 구조화 모델·validation |
| T03 | [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview) | 상태 기반 agent orchestration의 선택적 구현 대안 |

## 로컬 자료

참여자 정보 폴더의 은점마을_페르소나.json, 은점마을_페르소나_익명.json, 은점마을_시뮬레이터.html, 기획안_주민에이전트_평가.html, 연구_파이프라인.md, gap_주장구조.md 및 핵심 연구 요약을 검토했다. source-manifest.json에 파일 hash를 기록한다.

문서에는 실명·임상 정보 원문을 복제하지 않고 P번호와 설계상 필요한 요약만 사용했다. 원전 전사를 전부 재열람한 것은 아니므로 JSON의 모든 요약을 원전 검증 완료라고 하지 않는다.
