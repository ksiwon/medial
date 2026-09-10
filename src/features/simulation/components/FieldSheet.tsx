import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { SessionDetail } from '../api/iteration';
import {
  Button,
  Disclosure,
  Field,
  Input,
  Line,
  Mono,
  PanelTitle,
  Row,
  Select,
  Sub,
  Tag,
  TextArea,
  versionName,
} from '../ui/primitives';
import { colour, font, radius } from '../ui/theme';

// The side sheet that opens from the comparison when the designer picks
// something to take to the field. One layer, never a modal on a modal.
//
// Two things are kept apart on purpose, because collapsing them is the mistake
// that later gets quoted as a finding:
//
//  - the *decision* is the designer's, and it is recorded with its reasons, the
//    burden being accepted and the questions still open;
//  - the *interview answers* are a real person's, and they live in their own
//    section, labelled source=human, never averaged into the simulated reviews.

const Scrim = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(29, 41, 53, 0.28);
  z-index: 20;
`;

const Sheet = styled.aside`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(560px, 100vw);
  background: ${colour.surface};
  border-left: 1px solid ${colour.border};
  box-shadow: -6px 0 24px rgba(29, 41, 53, 0.16);
  z-index: 21;
  display: flex;
  flex-direction: column;
`;

const Head = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid ${colour.border};
`;

const Bodyy = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

const Block = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid ${colour.border};
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SubHead = styled.h3`
  margin: 0;
  font-size: ${font.body};
  font-weight: 600;
  color: ${colour.text};
`;

const Close = styled.button`
  border: 1px solid ${colour.border};
  background: ${colour.surface};
  border-radius: ${radius.control};
  width: 32px;
  height: 32px;
  cursor: pointer;
  font-size: 15px;
  color: ${colour.secondary};
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

interface Props {
  detail: SessionDetail;
  /** The version the comparison had selected, offered as the default choice. */
  suggestedGenerationId: string | null;
  busy: boolean;
  onClose: () => void;
  onDecide: (body: {
    disposition: 'adopt_for_field_review' | 'hold' | 'reject';
    generationId: string | null;
    reasons: string[];
    supportedConditions: string[];
    tradeoffs: string[];
    dissent: string[];
    unansweredQuestions: string[];
  }) => void;
  onSubmitHuman: (body: {
    packageId: string;
    reviewerRole: string;
    elicitation: string;
    actorId: string | null;
    selectedEpisodeIds: string[];
    responses: Record<string, unknown>[];
    corrections: Record<string, unknown>[];
    agreement: string;
    consentScope: string;
  }) => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
}

export default function FieldSheet({
  detail,
  suggestedGenerationId,
  busy,
  onClose,
  onDecide,
  onSubmitHuman,
  onOpenScene,
}: Props) {
  const generations = [...detail.generations].sort((a, b) => a.index - b.index);
  const [generationId, setGenerationId] = useState(
    suggestedGenerationId ?? generations[generations.length - 1]?.id ?? '',
  );
  const [disposition, setDisposition] =
    useState<'adopt_for_field_review' | 'hold' | 'reject'>('adopt_for_field_review');
  const [reasons, setReasons] = useState('');
  const [conditions, setConditions] = useState('');
  const [tradeoffs, setTradeoffs] = useState('');
  const [dissent, setDissent] = useState('');
  const [unanswered, setUnanswered] = useState('');

  const latestPackage = detail.fieldPackages[detail.fieldPackages.length - 1];
  const episodes = latestPackage?.episodes ?? [];
  const [episodeId, setEpisodeId] = useState('');
  const [reviewerRole, setReviewerRole] = useState('participant');
  const [elicitation, setElicitation] = useState('pre_simulation_response');
  const [answer, setAnswer] = useState('');
  const [correction, setCorrection] = useState('');
  const [agreement, setAgreement] = useState('unknown');
  const [consentScope, setConsentScope] = useState('');
  const selectedEpisode = episodes.find((e) => e.id === episodeId) ?? episodes[0];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = generations.find((g) => g.id === generationId) ?? null;
  const canDecide =
    !busy &&
    lines(reasons).length > 0 &&
    (disposition === 'hold' || disposition === 'reject' || chosen != null);

  return (
    <>
      <Scrim onClick={onClose} />
      <Sheet role="dialog" aria-label="현장 검토 선택">
        <Head>
          <PanelTitle>현장에서 검토할 안</PanelTitle>
          <Close onClick={onClose} aria-label="닫기">
            ✕
          </Close>
        </Head>

        <Bodyy>
          <Block>
            <Sub>
              여기서 고르는 것은 <strong>현장에서 사람에게 물어볼 운영안</strong>입니다. 의료적
              타당성 확인도, 서비스 도입 승인도 아닙니다. 마지막 버전이 자동으로 답이 되지
              않습니다.
            </Sub>
            <Field>
              어떻게 할까요
              <Select
                value={disposition}
                onChange={(e) =>
                  setDisposition(e.target.value as 'adopt_for_field_review' | 'hold' | 'reject')
                }
              >
                <option value="adopt_for_field_review">이 안을 현장 검토로 가져간다</option>
                <option value="hold">보류한다 (이것도 결정입니다)</option>
                <option value="reject">기각한다</option>
              </Select>
            </Field>
            {disposition === 'adopt_for_field_review' && (
              <Field>
                가져갈 버전
                <Select value={generationId} onChange={(e) => setGenerationId(e.target.value)}>
                  {generations.map((g) => (
                    <option key={g.id} value={g.id}>
                      {versionName(g.index, g.label)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field>
              이유 (한 줄에 하나)
              <TextArea value={reasons} onChange={(e) => setReasons(e.target.value)} />
            </Field>
            <Field>
              이 안이 성립하는 조건
              <TextArea value={conditions} onChange={(e) => setConditions(e.target.value)} />
            </Field>
            <Field>
              감수하는 부담
              <TextArea value={tradeoffs} onChange={(e) => setTradeoffs(e.target.value)} />
            </Field>
            <Field>
              함께 남길 반대·소수 의견
              <TextArea value={dissent} onChange={(e) => setDissent(e.target.value)} />
            </Field>
            <Field>
              현장에서 물어볼 질문 (아직 답하지 못한 것)
              <TextArea value={unanswered} onChange={(e) => setUnanswered(e.target.value)} />
            </Field>
            <Row>
              <Button
                $primary
                disabled={!canDecide}
                onClick={() =>
                  onDecide({
                    disposition,
                    generationId: disposition === 'adopt_for_field_review' ? generationId : null,
                    reasons: lines(reasons),
                    supportedConditions: lines(conditions),
                    tradeoffs: lines(tradeoffs),
                    dissent: lines(dissent),
                    unansweredQuestions: lines(unanswered),
                  })
                }
              >
                이 결정으로 기록
              </Button>
              {lines(reasons).length === 0 && <Sub>이유를 한 줄이라도 적어야 기록합니다.</Sub>}
            </Row>
          </Block>

          {detail.decisions.length > 0 && (
            <Block>
              <SubHead>기록된 결정 {detail.decisions.length}건</SubHead>
              {detail.decisions.map((decision) => (
                <Line key={decision.id} style={{ padding: '8px 0' }}>
                  <Row>
                    <Tag $kind={decision.disposition === 'hold' ? 'warn' : 'positive'}>
                      {decision.disposition === 'hold'
                        ? '보류'
                        : decision.disposition === 'reject'
                          ? '기각'
                          : '현장 검토로 채택'}
                    </Tag>
                    <Sub as="span">{decision.createdAt}</Sub>
                  </Row>
                  <Sub>이유: {decision.reasons.join(' · ') || '—'}</Sub>
                  {decision.tradeoffs.length > 0 && (
                    <Sub>감수한 부담: {decision.tradeoffs.join(' · ')}</Sub>
                  )}
                  {decision.unansweredQuestions.length > 0 && (
                    <Sub>남은 질문: {decision.unansweredQuestions.join(' · ')}</Sub>
                  )}
                </Line>
              ))}
            </Block>
          )}

          {latestPackage && (
            <Block>
              <SubHead>현장에서 보여줄 장면 {episodes.length}개</SubHead>
              {latestPackage.policySummary.length > 0 && (
                <>
                  <Sub>현장에서 설명할 운영안</Sub>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                    {latestPackage.policySummary.map((line) => (
                      <li key={line} style={{ fontSize: font.small, color: colour.text }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {latestPackage.openQuestions.length > 0 && (
                <Sub>아직 답이 없는 질문: {latestPackage.openQuestions.join(' · ')}</Sub>
              )}
              <Sub>{latestPackage.consentNote}</Sub>
              {latestPackage.dissentToShow.length > 0 && (
                <Sub>함께 보여줄 반대 의견: {latestPackage.dissentToShow.join(', ')}</Sub>
              )}
              {episodes.map((episode) => (
                <Line key={episode.id} style={{ padding: '8px 0' }}>
                  <Row>
                    <strong style={{ fontSize: font.body }}>{episode.title}</strong>
                    <Tag $kind="unknown">
                      사건 {episode.fromSeq}–{episode.toSeq}
                    </Tag>
                  </Row>
                  <Sub>{episode.summary}</Sub>
                  <Sub>
                    <strong>먼저 물을 것:</strong> {episode.preQuestion}
                  </Sub>
                  <Sub>
                    <strong>모의 반응을 보여 준 뒤:</strong> {episode.postQuestion}
                  </Sub>
                  {episode.eventIds[0] && (
                    <Button
                      style={{ minHeight: 30, fontSize: font.small, marginTop: 6 }}
                      onClick={() => onOpenScene(episode.attemptId, episode.eventIds[0])}
                    >
                      이 장면 열기
                    </Button>
                  )}
                </Line>
              ))}
            </Block>
          )}

          {/* A separate area, inside the field review document, for what real
              people actually answered. This is the only thing in the build that
              produces source="human". */}
          {latestPackage && (
            <Block>
              <Row>
                <SubHead>실제 인터뷰 응답 입력</SubHead>
                <Tag $kind="human">source = human</Tag>
              </Row>
              <Sub>
                사람이 실제로 답한 것만 넣습니다. 예시나 시연용 제출을 만들지 않으며, 저장된 응답은
                모의 리뷰와 같은 표에 합산하지 않고 다른 라벨·다른 시점으로 보존합니다.
              </Sub>
              <Field>
                어느 장면에 대한 답인가
                <Select
                  value={selectedEpisode?.id ?? ''}
                  onChange={(e) => setEpisodeId(e.target.value)}
                >
                  {episodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {episode.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Row>
                <Field style={{ flex: 1 }}>
                  답한 사람
                  <Select value={reviewerRole} onChange={(e) => setReviewerRole(e.target.value)}>
                    <option value="participant">본인 (인터뷰 참여자)</option>
                    <option value="family">가족</option>
                    <option value="institution_staff">기관 종사자</option>
                    <option value="researcher_note">연구자 정리 메모</option>
                  </Select>
                </Field>
                <Field style={{ flex: 1 }}>
                  물어본 시점
                  <Select value={elicitation} onChange={(e) => setElicitation(e.target.value)}>
                    <option value="pre_simulation_response">모의 반응 공개 전</option>
                    <option value="after_simulation_response">모의 반응 공개 후</option>
                    <option value="concept_review">운영안 자체에 대한 의견</option>
                    <option value="actual_use">실제 사용 경험</option>
                  </Select>
                </Field>
              </Row>
              <Field>
                답변
                <TextArea value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </Field>
              <Field>
                모델을 고쳐야 할 정정 사항
                <TextArea value={correction} onChange={(e) => setCorrection(e.target.value)} />
              </Field>
              <Row>
                <Field style={{ flex: 1 }}>
                  모의 반응과 일치했는가
                  <Select value={agreement} onChange={(e) => setAgreement(e.target.value)}>
                    <option value="unknown">판단 불가</option>
                    <option value="agreement">대체로 일치</option>
                    <option value="partial">일부 일치</option>
                    <option value="correction">정정 필요</option>
                  </Select>
                </Field>
                <Field style={{ flex: 1 }}>
                  동의 범위
                  <Input value={consentScope} onChange={(e) => setConsentScope(e.target.value)} />
                </Field>
              </Row>
              <Button
                disabled={busy || !selectedEpisode || answer.trim().length === 0}
                onClick={() => {
                  onSubmitHuman({
                    packageId: latestPackage.id,
                    reviewerRole,
                    elicitation,
                    actorId: selectedEpisode?.actorId ?? null,
                    selectedEpisodeIds: selectedEpisode ? [selectedEpisode.id] : [],
                    responses: [
                      {
                        question:
                          elicitation === 'pre_simulation_response'
                            ? selectedEpisode?.preQuestion
                            : selectedEpisode?.postQuestion,
                        answer: answer.trim(),
                      },
                    ],
                    corrections: correction.trim() ? [{ correction: correction.trim() }] : [],
                    agreement,
                    consentScope: consentScope.trim() || 'unknown',
                  });
                  setAnswer('');
                  setCorrection('');
                }}
              >
                사람의 응답으로 저장
              </Button>

              {detail.humanReviews.map((review) => (
                <Line key={review.id} style={{ padding: '8px 0' }}>
                  <Row>
                    <Tag $kind="human">실제 사람 · {review.reviewerRole}</Tag>
                    <Tag $kind="unknown">{review.elicitation}</Tag>
                    <Tag $kind="unknown">{review.agreement}</Tag>
                  </Row>
                  {review.responses.map((response, index) => (
                    <Sub key={index}>
                      {String((response as { question?: string }).question ?? '')} →{' '}
                      <strong>{String((response as { answer?: string }).answer ?? '')}</strong>
                    </Sub>
                  ))}
                  {review.corrections.map((row, index) => (
                    <Sub key={`c-${index}`} style={{ color: colour.error }}>
                      정정: {String((row as { correction?: string }).correction ?? '')}
                    </Sub>
                  ))}
                </Line>
              ))}
            </Block>
          )}

          <Block>
            <Disclosure>
              <summary>기술 정보</summary>
              <div>
                <Sub>
                  session <Mono>{detail.session.id}</Mono>
                </Sub>
                <Sub>
                  초기 상태 해시 <Mono>{detail.session.initialSnapshotHash}</Mono>
                </Sub>
                <Sub>
                  실제 사람 응답 {detail.humanReviews.length}건 · 모의 리뷰와 합산하지 않습니다.
                </Sub>
              </div>
            </Disclosure>
          </Block>
        </Bodyy>
      </Sheet>
    </>
  );
}
