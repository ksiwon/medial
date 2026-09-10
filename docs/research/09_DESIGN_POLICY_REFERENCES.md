# MEDial 디자인·정책 탐색 도구를 위한 추가 레퍼런스

확인일: 2026-09-10. 목적 중심 문헌 탐색이며 체계적 문헌고찰/메타분석은 아니다. HCI 설계 지원, 참여 모델링, 정책 탐색, 생성형 에이전트를 검색했다. 논문·저자 공개본·공식 프로젝트를 우선했으며 출판 유형과 열람 범위를 구분한다. 아래 MEDial 적용은 논문의 직접 결론이 아니라 설계 제안이다.

| ID | 문헌 / 출판 유형 | 확인한 내용·열람 범위 | MEDial 적용과 한계 |
|---|---|---|---|
| N01 | [Zhong et al. AI-Assisted Causal Pathway Diagram for Human-Centered Design, CHI 2024](https://doi.org/10.1145/3613904.3642179) · [저자 PDF](https://prosocialcomputing.com/assets/pdf/publications/zhong-CHI2024-CPD.pdf) | 출판사 초록·§3~6 발췌. 디자이너20명, CPD와 Miro 플러그인을 연구. 설계 원인 경로의 분기·연결을 다룸. | Core item→작동 기제→기대 결과→방해 조건을 편집. CPD를 그렸다는 사실은 인과관계 실증이 아님. |
| N02 | [Huanxing Chen. Human-Simulation Interaction: From Prediction to Exploration in LLM Agent Simulations for Policy, PoliSim@CHI 2026](https://polisim.net/assets/papers/accepted_papers/Human-Simulation_Interaction_From_Prediction_to_Exploration_in_LLM_Agent_Simulat.pdf) | 4쪽 본문. 워크숍 입장 논문. 단일 답변 수용보다 가능성 공간 탐색이라는 상호작용 관점을 주장. | 시도 묶음·가정 변화·문제 재정의 UI. 실증 평가가 있는 CHI 본회의 시스템 논문으로 인용하면 안 됨. |
| N03 | [Noyman. CityScope: An Urban Modeling and Simulation Platform, MIT 2022](https://www.media.mit.edu/publications/cityscope/) · [CityScopeJS 공식 문서](https://cityscope.media.mit.edu/cityscopejs/Introduction/) | 학위논문 초록 및 공식 UI 설명. 공간 설계 입력과 여러 분석 모듈·지표 연결, 협업. | 지도 위의 변경과 비교 결과를 연결하는 공동 작업 공간. 도시 성과를 농촌 의료 효과 근거로 전용하지 않음. 3D 모방은 불필요. |
| N04 | [Zhang, Hugh, Bernstein. PolicyKit: Building Governance in Online Communities, UIST 2020](https://arxiv.org/abs/2008.04236) · [저자 PDF](https://policykit.org/static/policyengine/pdf/policykit_uist2020.pdf) | 초록·구현 개요. 누가 어떤 절차로 행동을 허용하는지 정책으로 표현. 정책 변경 절차도 다룸. | 연락 수치뿐 아니라 승인권·거절권·인계 절차를 설계. 실제 의료기관 권한을 이 논문에서 추정하지 않음. |
| N05 | [Barreteau et al. Our Companion Modelling Approach, JASSS 2003](https://jasss.soc.surrey.ac.uk/6/2/1.html) | 본문. 현장과 모델을 반복 왕복하고 서로 다른 관점을 토론하는 방법론적 입장. | 주민/이장/실무자가 모델 가정을 정정하고 이견을 유지. 기존 MEDial companion 앱과 무관한 모델링 방법론이다. |
| N06 | [Edmonds et al. Different Modelling Purposes, JASSS 2019](https://www.jasss.org/22/3/6.html) | 초록·목적 분류. 예측·설명·탐색·사회적 상호작용 등 모델 목적의 차이. | 실행의 목적을 exploration/stress-test/controlled-comparison으로 구분. 탐색적이라는 이유로 사실 일관성을 면제하지 않음. |
| N07 | [RAND TR747, Robustness Analysis 부분](https://www.rand.org/content/dam/rand/pubs/technical_reports/2009/RAND_TR747.pdf) | 검색에서 반환된 Elements of Robustness Analysis 본문 발췌. 여러 가능한 가정 아래 전략을 탐색하는 방법. 전체 보고서 정독 아님. | 가정×정책 실행 행렬, 실패 경계. 가정 조합 통과 비율을 현실 성공 확률로 표시하지 않음. |
| N08 | [Park et al. Social Simulacra, UIST 2022](https://arxiv.org/abs/2208.04024) | 초록·프로토타이핑 개요 재확인. 사람이 있는 사회적 프로토타입으로 설계 상황 탐색. | 완성품 평가 전에 서비스 방식의 여러 변형을 실행. 온라인 커뮤니티 결과의 의료 일반화 금지. |
| N09 | [Vezhnevets et al. Concordia, 2023 preprint](https://arxiv.org/abs/2312.03664) | 저자 초록·구조 개요. 에이전트의 자연어 행동과 환경 실행을 분리. | 주민/기관 행동 제안과 결정적 시간·예약 엔진 경계 유지. GM을 MEDial과 합치지 않음. 프레임워크 교체가 목적은 아님. |
| N10 | [Zhang et al. GPLab, JASSS 29(1), 2026](https://www.jasss.org/29/1/6.html) | 초록·구조·§한계·부록 UI 설명. 정책의 여러 하위 시스템과 에이전트를 결합. 저자들도 규칙 ABM과 직접 비교 증거의 부족을 인정. | 의료 요청이 노동·이동·기관 부담으로 전파되는 것을 모델링. LLM이 더 현실적이라는 전제를 두지 말고 rule 대비 평가. |
| N11 | [Yang, Dudley, Kristensson. Design Activity Simulation, CUI 2025](https://www.pokristensson.com/pubs/YangEtAlCUI2025.pdf) | 초록·§9.4~9.5. HCI 연구자5명 평가/전문가7명 contextual inquiry. 실용적이나 새로운 아이디어는 제한적이라는 보고. | 설계 조언 LLM은 대안·누락된 조건을 제안하고 사람은 문제와 선택을 소유. 자동 합의가 창의성을 보장하지 않음. |
| N12 | [Buçinca et al. AHA! Facilitating AI Impact Assessment by Generating Examples of Harms, 2023](https://www.microsoft.com/en-us/research/publication/aha-facilitating-ai-impact-assessment-by-generating-examples-of-harms/?lang=ko-kr) | 저자기관 초록; 해당 페이지는 arXiv로 표시. 문제 행동×영향받는 사람을 조합해 구체 사례 생성. 검토 부담도 논의. | 이슈 생성기에 failure mode×actor×context를 사용. 생성량을 제한하고 실제 외생 사건으로 실행할 수 있는지 확인. |
| N13 | [Agnew et al. The Illusion of Artificial Inclusion, CHI 2024](https://research.google/pubs/the-illusion-of-artificial-inclusion/) | 저자기관 논문 소개·초록 재확인. 합성 참여자를 실제 참여와 동일시할 위험. | 실제 사람의 이의 제기·가정 정정·기록 권한을 핵심 기능으로 둠. 주민을 닮은 발화가 대표성을 보증하지 않음. |
| N14 | [Pei et al. Generative AI-assisted Participatory Modeling …, arXiv v2, 2026-03-19](https://arxiv.org/abs/2603.17021v2) | 초록. 자연어 문제 기술에서 모델 구성요소를 도출하고 사람이 수정하는 workflow 사례. | 자연어 core item을 typed blueprint 초안으로 번역. 제안 수준이며 현장 공동설계 효과의 보증 아님. |

## 읽는 우선순위
N01(설계 기제), N02(상호작용 관점), N03(공유 공간), N04(권한과 절차), N05(현장 정정), N07(불확실성 탐색)를 먼저 읽는다. N09~N11은 AI 역할 경계와 실증 설계를 보완한다.

## 확보된 연구 방향의 함의
'여러 에이전트가 정책을 실행한다', '시도를 비교한다', '탐색을 지원한다'만으로 최초 기여를 주장하지 않는다. MEDial의 기여 후보는 실마을의 시간·이동·관계 제약을 바탕으로, 서비스 기제와 권한 구조를 편집하고 그 부담 전파와 근거의 취약점을 실제 이해관계자가 수정하는 상호작용이다. 이 후보 자체도 향후 사용자 연구로 입증해야 한다.

## 확인 범위의 한계
이번에는 최신 DEVELOPMENT.md와 기존 SOURCES.md를 읽었다. 보고된87개 테스트를 다시 실행하거나 코드 전부를 재감사하지 않았다. 새 설계가 이미 구현됐다는 뜻이 아니다. 문헌의 출판 연도는 페이지 본문/논문 표기를 따랐고 검색엔진의 상대적 날짜는 사용하지 않았다.
