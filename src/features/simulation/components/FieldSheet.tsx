import { useEffect, useState } from 'react';
import styled from 'styled-components';
import {
  CORRECTION_TARGET_LABELS,
  CORRESPONDENCE_LABELS,
  DIMENSION_LABELS,
  type SessionDetail,
} from '../api/iteration';
import { personName } from '../selectors/story';
import {
  Button,
  Disclosure,
  Field,
  Hint,
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
//
// The answers follow the protocol's order (26번 D, F07), and the screen makes
// the order the only way through:
//
//   1 the scene and the question, with the agent's evaluation hidden;
//   2 the respondent's own answer, saved before anything is shown;
//   3 the disclosure, recorded as an event;
//   4 the comparison - agreement, correction, explicit disagreement, unknown -
//     and, if something should change, which layer should change.
//
// Who answers and who is answered *about* are separate fields throughout, so a
// family member's answer is their own record and never overwrites the
// resident's. The app can only record what it did itself, and the screen says
// so rather than claiming an unanchored answer.

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

/** Packages stored before 2026-09-15 titled a scene "P6 · time_labour". The
 *  record is not rewritten; the key is named when it is read. */
const episodeTitle = (title: string): string =>
  title.replace(/[a-z]+(?:_[a-z]+)+$/, (key) =>
    key in DIMENSION_LABELS ? DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS] : key,
  );

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
  onSubmitHuman: (body: Record<string, unknown>) => void;
  onRecordDisclosure: (body: {
    packageId: string;
    episodeId: string;
    respondentId: string;
    shownReviewIds: string[];
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
  onRecordDisclosure,
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
  const [respondentId, setRespondentId] = useState('');
  const [respondentRole, setRespondentRole] = useState('self');
  const [answer, setAnswer] = useState('');
  const [reason, setReason] = useState('');
  const [correspondence, setCorrespondence] = useState('agreement');
  const [correctionTarget, setCorrectionTarget] = useState('');
  const [consentScope, setConsentScope] = useState('');
  const selectedEpisode = episodes.find((e) => e.id === episodeId) ?? episodes[0];

  // Which stage this respondent is at *for this scene*. Both are read from the
  // stored records rather than from local state, so reloading the sheet cannot
  // put somebody back before a disclosure that already happened.
  const ownPre = detail.humanReviews.find(
    (r) =>
      r.respondentId === respondentId.trim() &&
      r.episodeId === selectedEpisode?.id &&
      r.responseStage === 'pre_disclosure',
  );
  const disclosure = detail.disclosures?.find(
    (d) => d.respondentId === respondentId.trim() && d.episodeId === selectedEpisode?.id,
  );
  const disclosed = Boolean(disclosure);

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
            <Field>
              <span>
                어떻게 할까요
                <Hint label="이 결정">
                  여기서 고르는 것은 현장에서 사람에게 물어볼 운영안입니다. 의료적 타당성 확인도,
                  서비스 도입 승인도 아닙니다. 마지막 버전이 자동으로 답이 되지 않습니다.
                </Hint>
              </span>
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
              <TextArea
                aria-label="현장 검토 결정 이유"
                value={reasons}
                onChange={(e) => setReasons(e.target.value)}
              />
            </Field>
            {/* The decision needs a reason; the other four boxes are things
                worth recording and not things to stare at before deciding. */}
            <Disclosure>
              <summary>조건 · 부담 · 반대 의견 · 남은 질문 (선택)</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              </div>
            </Disclosure>
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
              <Row style={{ gap: 2 }}>
                <Sub as="span">동의 안내</Sub>
                <Hint label="동의 안내">{latestPackage.consentNote}</Hint>
              </Row>
              {latestPackage.dissentToShow.length > 0 && (
                <Sub>함께 보여줄 반대 의견: {latestPackage.dissentToShow.join(', ')}</Sub>
              )}
              {episodes.map((episode) => (
                <Line key={episode.id} style={{ padding: '8px 0' }}>
                  <Row>
                    <strong style={{ fontSize: font.body }}>{episodeTitle(episode.title)}</strong>
                    <Tag $kind="unknown">
                      사건 {episode.fromSeq}–{episode.toSeq}
                    </Tag>
                  </Row>
                  <Sub>{episode.summary}</Sub>
                  {/* The two questions are asked one stage at a time below, and
                      the second one must not be read before the disclosure.
                      Here they are a reference, not the script. */}
                  <Disclosure>
                    <summary>물어볼 두 질문</summary>
                    <div>
                      <Sub>
                        <strong>먼저:</strong> {episode.preQuestion}
                      </Sub>
                      <Sub>
                        <strong>보여 준 뒤:</strong> {episode.postQuestion}
                      </Sub>
                    </div>
                  </Disclosure>
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

          {/* The only thing in the build that produces source="human", and the
              only place the protocol's order is enforced on screen. */}
          {latestPackage && selectedEpisode && (
            <Block>
              <Row>
                <SubHead>현장 기록 · 실제 응답</SubHead>
                <Tag $kind="human">source = human</Tag>
                <Hint label="현장 기록">
                  사람이 실제로 답한 것만 넣습니다. 예시나 시연용 제출을 만들지 않으며, 저장된
                  응답은 모의 평가와 같은 표에 합산하지 않습니다.
                </Hint>
              </Row>

              <Field>
                어느 장면에 대한 기록인가
                <Select
                  value={selectedEpisode.id}
                  onChange={(e) => setEpisodeId(e.target.value)}
                >
                  {episodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {episodeTitle(episode.title)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Row>
                <Field style={{ flex: 1 }}>
                  <span>
                    응답자 (가명 ID)
                    <Hint label="가명 ID">
                      이름을 적지 않습니다. 연구 안에서만 통하는 가명입니다.
                    </Hint>
                  </span>
                  <Input
                    aria-label="응답자 가명 ID"
                    value={respondentId}
                    placeholder="예: R-01"
                    onChange={(e) => setRespondentId(e.target.value)}
                  />
                </Field>
                <Field style={{ flex: 1 }}>
                  <span>
                    응답자의 입장
                    <Hint label="응답자의 입장">
                      답하는 사람과 이야기의 대상({personName(selectedEpisode.actorId)})은 다른
                      항목입니다. 가족의 답이 본인의 답을 덮어쓰지 않습니다.
                    </Hint>
                  </span>
                  <Select value={respondentRole} onChange={(e) => setRespondentRole(e.target.value)}>
                    <option value="self">본인</option>
                    <option value="family">가족</option>
                    <option value="institution_staff">기관 종사자</option>
                    <option value="researcher">연구자 메모</option>
                  </Select>
                </Field>
              </Row>

              {/* Stage 1. Nothing about the agent's evaluation is on screen. */}
              {ownPre && !disclosed && (
                <Sub>
                  <Tag $kind="unknown">1단계 · 공개 전</Tag> 독립 응답 저장됨
                </Sub>
              )}
              {!ownPre && !disclosed && (
                <>
                  <Line style={{ padding: '8px 0' }}>
                    <Tag $kind="unknown">1단계 · 공개 전</Tag>
                    <Sub style={{ marginTop: 4 }}>
                      <strong>먼저 물을 것:</strong> {selectedEpisode.preQuestion}
                    </Sub>
                    <Hint label="공개 전">
                      이 단계에서는 모의 평가를 화면에 보여 주지 않습니다. 독립 응답을 먼저
                      저장해야 다음 단계가 열립니다.
                    </Hint>
                  </Line>
                  <Field>
                    본인이 답한 내용
                    <TextArea
                      aria-label="공개 전 응답 내용"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                  </Field>
                  <Field>
                    동의 범위
                    <Input
                      value={consentScope}
                      onChange={(e) => setConsentScope(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={busy || !respondentId.trim() || answer.trim().length === 0}
                    onClick={() => {
                      onSubmitHuman({
                        packageId: latestPackage.id,
                        reviewerRole:
                          respondentRole === 'researcher' ? 'researcher_note'
                            : respondentRole === 'family' ? 'family'
                              : respondentRole === 'institution_staff' ? 'institution_staff'
                                : 'participant',
                        elicitation: 'pre_simulation_response',
                        respondentId: respondentId.trim(),
                        respondentRole,
                        subjectActorId: selectedEpisode.actorId,
                        actorId: selectedEpisode.actorId,
                        episodeId: selectedEpisode.id,
                        selectedEpisodeIds: [selectedEpisode.id],
                        responses: [
                          { question: selectedEpisode.preQuestion, answer: answer.trim() },
                        ],
                        corrections: [],
                        agreement: 'unknown',
                        responseStage: 'pre_disclosure',
                        responseKind:
                          respondentRole === 'researcher' ? 'researcher_note' : 'resident_response',
                        consentScope: consentScope.trim() || 'unknown',
                      });
                      setAnswer('');
                    }}
                  >
                    공개 전 독립 응답으로 저장
                  </Button>
                </>
              )}

              {/* Stage 2. Disclosure is an event, not a checkbox. */}
              {ownPre && !disclosure && (
                <Line style={{ padding: '8px 0' }}>
                  <Tag $kind="warn">2단계 · 모의 평가 공개</Tag>
                  <Sub style={{ marginTop: 4 }}>
                    독립 응답이 저장되었습니다. 이제 모의 평가를 보여 주고 그 시점을 기록합니다.
                    <Hint label="공개 기록">
                      앱 밖에서 이미 들었을 수 있으므로 이 기록이 무편향 응답을 보증하지는
                      않습니다.
                    </Hint>
                  </Sub>
                  <Button
                    style={{ marginTop: 8 }}
                    disabled={busy}
                    onClick={() =>
                      onRecordDisclosure({
                        packageId: latestPackage.id,
                        episodeId: selectedEpisode.id,
                        respondentId: respondentId.trim(),
                        shownReviewIds: selectedEpisode.simulatedReviewId
                          ? [selectedEpisode.simulatedReviewId]
                          : [],
                      })
                    }
                  >
                    모의 평가를 보여 주었음을 기록
                  </Button>
                </Line>
              )}

              {/* Stage 3. Now, and only now, the comparison. */}
              {disclosure && (
                <>
                  <Line style={{ padding: '8px 0' }}>
                    <Tag $kind="positive">3단계 · 공개 후 비교</Tag>
                    <Sub style={{ marginTop: 4 }}>
                      <strong>모의 반응을 보여 준 뒤:</strong> {selectedEpisode.postQuestion}
                    </Sub>
                    <Sub>공개 시점 {disclosure.disclosedAt}</Sub>
                  </Line>
                  <Field>
                    이번에 답한 내용
                    <TextArea
                      aria-label="공개 후 응답 내용"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                  </Field>
                  <Row>
                    <Field style={{ flex: 1 }}>
                      모의 평가와 비교하면
                      <Select
                        aria-label="모의 평가와의 비교"
                        value={correspondence}
                        onChange={(e) => setCorrespondence(e.target.value)}
                      >
                        <option value="agreement">{CORRESPONDENCE_LABELS.agreement}</option>
                        <option value="correction">{CORRESPONDENCE_LABELS.correction}</option>
                        <option value="disagreement">{CORRESPONDENCE_LABELS.disagreement}</option>
                        <option value="unknown">{CORRESPONDENCE_LABELS.unknown}</option>
                      </Select>
                    </Field>
                    <Field style={{ flex: 1 }}>
                      <span>
                        고쳐야 할 것은 무엇인가
                        <Hint label="고쳐야 할 것">
                          정정은 지난 실행을 바꾸지 않습니다. 다음 실행의 입력으로 남습니다.
                        </Hint>
                      </span>
                      <Select
                        aria-label="고쳐야 할 것"
                        value={correctionTarget}
                        onChange={(e) => setCorrectionTarget(e.target.value)}
                      >
                        <option value="">고칠 것 없음</option>
                        {Object.entries(CORRECTION_TARGET_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </Row>
                  <Field>
                    왜 그렇게 보는지
                    <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <Button
                    disabled={busy || answer.trim().length === 0}
                    onClick={() => {
                      onSubmitHuman({
                        packageId: latestPackage.id,
                        reviewerRole:
                          respondentRole === 'researcher' ? 'researcher_note'
                            : respondentRole === 'family' ? 'family'
                              : respondentRole === 'institution_staff' ? 'institution_staff'
                                : 'participant',
                        elicitation: 'after_simulation_response',
                        respondentId: respondentId.trim(),
                        respondentRole,
                        subjectActorId: selectedEpisode.actorId,
                        actorId: selectedEpisode.actorId,
                        episodeId: selectedEpisode.id,
                        selectedEpisodeIds: [selectedEpisode.id],
                        responses: [
                          { question: selectedEpisode.postQuestion, answer: answer.trim() },
                        ],
                        corrections: reason.trim() ? [{ correction: reason.trim() }] : [],
                        agreement: 'unknown',
                        responseStage: 'post_disclosure',
                        disclosureRecordId: disclosure.id,
                        correspondence,
                        correctionTarget: correctionTarget || null,
                        reason: reason.trim(),
                        responseKind:
                          respondentRole === 'researcher' ? 'researcher_note' : 'resident_response',
                        consentScope: consentScope.trim() || 'unknown',
                      });
                      setAnswer('');
                      setReason('');
                    }}
                  >
                    공개 후 응답으로 저장
                  </Button>
                </>
              )}

              {/* What is on file, with each record's stage and whose it is. */}
              {detail.humanReviews.length === 0 ? (
                <Sub>
                  실제 사람의 응답은 아직 0건입니다. 사람이 제출하기 전에는 아무것도 만들지
                  않습니다.
                </Sub>
              ) : (
                detail.humanReviews.map((review) => (
                  <Line key={review.id} style={{ padding: '8px 0' }}>
                    <Row style={{ flexWrap: 'wrap' }}>
                      <Tag $kind="human">
                        {review.responseKind === 'researcher_note' ? '연구자 메모' : '실제 사람'}
                        {' · '}
                        {review.respondentId ?? '미상'}
                      </Tag>
                      <Tag $kind={review.responseStage === 'pre_disclosure' ? 'unknown' : 'positive'}>
                        {review.responseStage === 'pre_disclosure' ? '공개 전' : '공개 후'}
                      </Tag>
                      {review.subjectActorId && (
                        <Tag $kind="neutral">대상 {personName(review.subjectActorId)}</Tag>
                      )}
                      {review.correspondence && (
                        <Tag
                          $kind={review.correspondence === 'disagreement' ? 'negative' : 'unknown'}
                        >
                          {CORRESPONDENCE_LABELS[review.correspondence] ?? review.correspondence}
                        </Tag>
                      )}
                      {!review.correspondence && review.agreement !== 'unknown' && (
                        <Tag $kind="unknown">
                          {CORRESPONDENCE_LABELS[review.agreement] ?? review.agreement}
                        </Tag>
                      )}
                    </Row>
                    {review.responses.map((response, index) => (
                      <Sub key={index}>
                        {String((response as { question?: string }).question ?? '')} →{' '}
                        <strong>{String((response as { answer?: string }).answer ?? '')}</strong>
                      </Sub>
                    ))}
                    {review.correctionTarget && (
                      <Sub style={{ color: colour.error }}>
                        고칠 곳: {CORRECTION_TARGET_LABELS[review.correctionTarget]}
                        {review.reason ? ` — ${review.reason}` : ''}
                      </Sub>
                    )}
                  </Line>
                ))
              )}
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
                  실제 사람 응답 {detail.humanReviews.length}건 · 공개 기록{' '}
                  {detail.disclosures?.length ?? 0}건 · 모의 평가와 합산하지 않습니다.
                </Sub>
              </div>
            </Disclosure>
          </Block>
        </Bodyy>
      </Sheet>
    </>
  );
}
