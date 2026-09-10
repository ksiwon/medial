import { useMemo, useState } from 'react';
import styled from 'styled-components';
import type { AgentReview, GenerationDetail } from '../api/iteration';
import { ASSESSMENT_LABELS, DIMENSION_LABELS, USAGE_LABELS } from '../api/iteration';
import type { AttemptDetail, DomainEvent, PersonaProfile, ViewMode } from '../api/types';
import { formatClock, segmentAt, type MedialKnown } from '../positions';
import { personName, sentenceFor } from '../selectors/story';
import {
  IconButton,
  Disclosure,
  Mono,
  Panel,
  PanelHead,
  PanelTitle,
  Scroll,
  Select,
  Sub,
  Tag,
  TextLink,
  type TagKind,
} from '../ui/primitives';
import { colour, font } from '../ui/theme';
import { FaceChip } from './Marks';

// The third column: one person, and everything the run recorded about them.
//
// This is the old ResidentDetail drawer promoted to a standing panel, because a
// panel you have to open and close is a panel you stop opening. Its two
// load-bearing separations are unchanged:
//
//  - what is true *now* (at the replay cursor) is kept apart from the
//    retrospective. The whole-day review and the events after the cursor sit
//    behind a 회고 toggle, because showing them at 09:30 lets a reader draw on
//    information nobody had yet;
//  - in the 'MEDial이 아는 것' view this panel shows MEDial's observations, not
//    the world's truth. Otherwise the view mode would filter a list while the
//    panel beside it kept leaking positions.
//
// Two things it deliberately does not have. There is no satisfaction score: the
// reviews produce assessments per dimension and averaging them would invent a
// number the run never measured. And there is no free chat - this build has no
// conversational agent, so the 주고받은 말 section prints utterances the log
// actually stored and says so when there are none.

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const Name = styled.div`
  font-size: ${font.section};
  font-weight: 600;
  color: ${colour.text};
  line-height: 1.2;
`;

const Section = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${colour.border};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: ${font.small};
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${colour.secondary};
`;

const Text = styled.div`
  font-size: ${font.body};
  line-height: 1.5;
  color: ${colour.text};
`;

const Plan = styled.div`
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 4px 8px;
  font-size: ${font.small};
  line-height: 1.5;
`;

const When = styled.span`
  color: ${colour.secondary};
  font-variant-numeric: tabular-nums;
`;

const What = styled.span<{ $changed?: boolean }>`
  color: ${(p) => (p.$changed ? colour.warn : colour.text)};
  font-weight: ${(p) => (p.$changed ? 600 : 400)};
`;

const EventRow = styled.button<{ $future: boolean }>`
  display: grid;
  grid-template-columns: 46px 1fr;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 6px 0;
  border-bottom: 1px solid ${colour.border};
  cursor: pointer;
  font-family: inherit;
  font-size: ${font.small};
  line-height: 1.5;
  color: ${(p) => (p.$future ? colour.warn : colour.text)};
  &:hover {
    color: ${colour.primary};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

const Said = styled.div`
  font-size: ${font.body};
  line-height: 1.5;
  color: ${colour.text};
  padding: 8px 0 8px 10px;
  border-left: 2px solid ${colour.border};
  border-bottom: 1px solid ${colour.border};
`;

const Toggle = styled.button<{ $on: boolean }>`
  align-self: flex-start;
  border: 1px solid ${(p) => (p.$on ? colour.primary : colour.border)};
  background: ${(p) => (p.$on ? colour.selected : colour.surface)};
  color: ${(p) => (p.$on ? colour.primary : colour.text)};
  border-radius: 6px;
  padding: 5px 10px;
  font-family: inherit;
  font-size: ${font.small};
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

const Empty = styled.div`
  font-size: ${font.small};
  color: ${colour.unknown};
  line-height: 1.5;
`;

const ASSESS_KIND: Record<string, TagKind> = {
  positive: 'positive',
  mixed: 'mixed',
  negative: 'negative',
  unknown: 'unknown',
};

/** Attempt-level review dimensions use their own key set. */
const ATTEMPT_DIMENSION: Record<string, string> = {
  resolution: '해결 · 다음 담당자',
  time_respected: '일정과 노동',
  choice: '선택 가능성',
  disclosure: '정보 공개',
};

const TRISTATE = (value: boolean | null | undefined) =>
  value === null || value === undefined ? '원자료에 없음' : value ? '예' : '아니오';

interface Props {
  actorId: string | null;
  /** Everyone this run has a timeline for, so the panel can be steered on its own. */
  actorIds: string[];
  detail: AttemptDetail;
  events: DomainEvent[];
  cursorSeq: number;
  atMs: number;
  viewMode: ViewMode;
  persona: PersonaProfile | null;
  medialKnown: MedialKnown | null;
  /** The generation whose day just ended, for this person's own review. */
  generation: GenerationDetail | null;
  onSelectActor: (actorId: string) => void;
  /** Close this person and go back to the board of everyone. */
  onBack?: () => void;
  onSeek: (seq: number) => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
}

export default function PersonPanel({
  actorId,
  actorIds,
  detail,
  events,
  cursorSeq,
  atMs,
  viewMode,
  persona,
  medialKnown,
  generation,
  onSelectActor,
  onBack,
  onSeek,
  onOpenScene,
}: Props) {
  const [retrospective, setRetrospective] = useState(false);
  const medial = viewMode === 'medial';

  const actor = actorId ? detail.timeline?.actors[actorId] : undefined;
  const burden = actorId ? detail.metrics.residentBurden[actorId] : undefined;
  const attemptReview = actorId ? detail.reviews.find((r) => r.actorId === actorId) : undefined;
  const agentReview: AgentReview | undefined = actorId
    ? generation?.reviews.find((r) => r.actorId === actorId)
    : undefined;

  // Events addressed to this person, or acted by them. In MEDial's view only
  // what MEDial could read.
  const mine = useMemo(() => {
    if (!actorId) return [];
    return events.filter(
      (e) =>
        (e.visibility.includes(actorId) || e.actorId === actorId) &&
        (!medial || e.visibility.includes('MEDial')),
    );
  }, [events, actorId, medial]);

  const shownEvents = retrospective ? mine : mine.filter((e) => e.seq <= cursorSeq);

  // Only utterances the log stored. Nothing is written here.
  const said = useMemo(
    () =>
      shownEvents
        .map((event) => ({
          event,
          text: (event.payload as Record<string, unknown>).utterance,
        }))
        .filter((row): row is { event: DomainEvent; text: string } => typeof row.text === 'string'),
    [shownEvents],
  );

  const nowBaseline = actor ? segmentAt(actor.baseline, atMs) : null;
  const nowRealized = actor ? segmentAt(actor.realized, atMs) : null;

  return (
    <Panel>
      <PanelHead style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {actorId ? (
          <Head>
            {onBack && (
              <IconButton onClick={onBack} title="마을 사람들로 돌아가기">
                ←
              </IconButton>
            )}
            <FaceChip id={actorId} size={32} isVillageHead={Boolean(actor?.isVillageHead)} />
            <div style={{ minWidth: 0 }}>
              <Name>{actor?.isVillageHead ? '이장' : (actor?.displayName ?? actorId)}</Name>
              <Sub>
                {actorId}
                {actor?.isVillageHead && ' · 이장 역할과 주민 역할이 같은 한 사람'}
              </Sub>
            </div>
          </Head>
        ) : (
          <PanelTitle>주민 보기</PanelTitle>
        )}
        <Select
          aria-label="볼 사람"
          style={{ minHeight: 32, fontSize: font.small, padding: '4px 8px', maxWidth: 130 }}
          value={actorId ?? ''}
          onChange={(e) => onSelectActor(e.target.value)}
        >
          {!actorId && <option value="">고르세요</option>}
          {actorIds.map((id) => (
            <option key={id} value={id}>
              {id === 'P6' ? '이장 (P6)' : personName(id)}
            </option>
          ))}
        </Select>
      </PanelHead>

      {!actorId ? (
        <Section>
          <Empty>지도에서 사람을 누르거나 위에서 골라 주세요.</Empty>
        </Section>
      ) : (
        <Scroll>
          <Section>
            <SectionTitle>지금 {formatClock(atMs)} · 사건 {cursorSeq}</SectionTitle>
            {medial ? (
              <>
                <Text>
                  MEDial이 아는 위치:{' '}
                  <strong>{medialKnown?.place ?? '미확인'}</strong>
                </Text>
                <Sub>
                  근거: {medialKnown ? medialKnown.basis : '이 사람에 대한 관측이 아직 없습니다'}
                  {medialKnown &&
                    ` · ${medialKnown.confidence === 'reported' ? '보고받은 추정' : '보고된 관측'}`}
                </Sub>
                <Sub>
                  이 모드에서는 실제 위치와 일과를 표시하지 않습니다. 연구자 전체보기로 바꾸면
                  세계의 실제 상태를 볼 수 있습니다.
                </Sub>
              </>
            ) : (
              <>
                <Text>
                  {nowRealized?.label ?? '—'}{' '}
                  {nowRealized?.origin === 'task' && <Tag $kind="warn">조율 과업</Tag>}
                </Text>
                <Sub>원래 일과: {nowBaseline?.label ?? '—'}</Sub>
              </>
            )}
          </Section>

          {!medial && actor && (
            <Section>
              <SectionTitle>오늘 일정 · 계획과 실제</SectionTitle>
              <Sub>원래 계획과 실제로 한 일. 바뀐 구간은 굵게 표시합니다.</Sub>
              <Plan>
                {actor.realized.map((s, i) => {
                  const planned = segmentAt(actor.baseline, s.startMs);
                  const changed = s.origin === 'task' || planned?.label !== s.label;
                  return (
                    <span key={i} style={{ display: 'contents' }}>
                      <When>
                        {formatClock(s.startMs)}–{formatClock(s.endMs)}
                      </When>
                      <What $changed={changed}>
                        {s.label}
                        {changed && planned && planned.label !== s.label && (
                          <Sub as="span"> (원래: {planned.label})</Sub>
                        )}
                      </What>
                    </span>
                  );
                })}
              </Plan>
              {actor.planChanged && (
                <Sub>
                  이 사람의 하루는 조율 때문에 바뀌었습니다. 추가 과업{' '}
                  {Math.round(actor.addedTaskMs / 60000)}분 · 받은 연락 {actor.contactsReceived}건.
                </Sub>
              )}
            </Section>
          )}

          <Section>
            <SectionTitle>
              이 사람이 겪은 일 {shownEvents.length}
              {retrospective ? ' · 하루 전체' : ` / 전체 ${mine.length}`}
            </SectionTitle>
            <Toggle $on={retrospective} onClick={() => setRetrospective((v) => !v)}>
              {retrospective ? '회고 보기 끄기' : '회고 보기 (하루 전체)'}
            </Toggle>
            {retrospective && (
              <Sub style={{ color: colour.warn }}>
                지금 커서 이후의 사건까지 보고 있습니다. 이 시점에는 아무도 몰랐던 정보입니다.
              </Sub>
            )}
            {shownEvents.length === 0 ? (
              <Empty>이 시각까지 이 사람에게 일어난 일이 없습니다.</Empty>
            ) : (
              <div>
                {shownEvents.slice(0, 40).map((event) => {
                  const sentence = sentenceFor(event);
                  return (
                    <EventRow
                      key={event.id}
                      $future={event.seq > cursorSeq}
                      onClick={() => onSeek(event.seq)}
                      title="이 장면을 다시 봅니다 (저장된 기록 재생)"
                    >
                      <When>{formatClock(event.simTimeMs)}</When>
                      <span>{sentence ? sentence.text : event.type}</span>
                    </EventRow>
                  );
                })}
                {shownEvents.length > 40 && (
                  <Sub style={{ paddingTop: 6 }}>
                    이 목록은 40건까지 보여 줍니다. 전체는 아래 기술 정보에 있습니다.
                  </Sub>
                )}
              </div>
            )}
          </Section>

          <Section>
            <SectionTitle>주고받은 말</SectionTitle>
            {said.length === 0 ? (
              <Empty>
                이 시각까지 기록된 발화가 없습니다. 이 빌드에는 주민과의 자유 대화가 없고, 규칙
                어댑터가 만든 발화만 사건에 실려 있습니다. 없는 대화를 만들지 않습니다.
              </Empty>
            ) : (
              said.map(({ event, text }) => (
                <Said key={event.id}>
                  “{text}”
                  <Sub style={{ marginTop: 2 }}>
                    {formatClock(event.simTimeMs)} ·{' '}
                    <TextLink onClick={() => onSeek(event.seq)}>그 장면</TextLink>
                  </Sub>
                </Said>
              ))
            )}
          </Section>

          <Section>
            <SectionTitle>하루를 마친 뒤의 평가</SectionTitle>
            <Sub>
              모의 리뷰입니다. 점수가 아니고 실제 주민의 만족도도 아닙니다. 자기가 실제로 겪은
              사건만 근거로 쓰며, 근거가 없으면 판단 불가로 남습니다.
            </Sub>

            {agentReview ? (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag $kind={agentReview.usageStatus === 'no_experience' ? 'unknown' : 'neutral'}>
                    {USAGE_LABELS[agentReview.usageStatus]}
                  </Tag>
                  <Tag $kind="unknown">{agentReview.adapter} 어댑터</Tag>
                </div>
                <Text>{agentReview.overallNarrative}</Text>
                {agentReview.items.map((item, index) => (
                  <div key={index} style={{ marginTop: 4 }}>
                    <Tag $kind={ASSESS_KIND[item.assessment]}>
                      {DIMENSION_LABELS[item.dimension]} · {ASSESSMENT_LABELS[item.assessment]}
                    </Tag>
                    <Sub style={{ marginTop: 2 }}>{item.reason}</Sub>
                    {item.requestedChange && (
                      <Sub>
                        <strong>다음에 이용한다면:</strong> {item.requestedChange}
                      </Sub>
                    )}
                    {item.eventRefs.slice(0, 1).map((eventId) => (
                      <TextLink
                        key={eventId}
                        onClick={() => onOpenScene(agentReview.attemptId, eventId)}
                      >
                        근거 장면 보기
                      </TextLink>
                    ))}
                  </div>
                ))}
                {agentReview.unknowns.length > 0 && (
                  <Sub>모르는 것: {agentReview.unknowns.join(' · ')}</Sub>
                )}
              </>
            ) : attemptReview ? (
              <>
                <Tag $kind={ASSESS_KIND[attemptReview.assessment]}>
                  {ASSESSMENT_LABELS[attemptReview.assessment]}
                </Tag>
                {attemptReview.dimensions.map((d) => (
                  <div key={d.key} style={{ marginTop: 4 }}>
                    <Tag $kind={ASSESS_KIND[d.assessment]}>
                      {ATTEMPT_DIMENSION[d.key] ?? d.key} · {ASSESSMENT_LABELS[d.assessment]}
                    </Tag>
                    <Sub style={{ marginTop: 2 }}>{d.reason}</Sub>
                  </div>
                ))}
                <Sub>{attemptReview.comment}</Sub>
                {attemptReview.unknowns.length > 0 && (
                  <Sub>확인할 수 없는 것: {attemptReview.unknowns.join(' · ')}</Sub>
                )}
                <Sub>
                  본인이 겪은 사건 {attemptReview.experiencedEventIds.length}건만 근거로
                  씁니다.
                </Sub>
              </>
            ) : (
              <Empty>
                이 하루에 대한 이 사람의 리뷰가 아직 없습니다. 하루가 끝나야 수집됩니다.
              </Empty>
            )}
          </Section>

          <Section>
            <SectionTitle>원래 일과에서 벗어난 시간 (연구자 지표)</SectionTitle>
            {burden ? (
              <>
                <Text>
                  추가 과업 {burden.addedTaskMinutes}분 · 추가 이동{' '}
                  {Math.round(burden.addedTravelMetres)} m · 중단 {burden.interruptions}회 · 받은
                  연락 {burden.contactsReceived}건
                </Text>
                <Sub>{burden.basis}</Sub>
              </>
            ) : (
              <Empty>이 시도에서 이 사람에게 추가된 일이 없습니다.</Empty>
            )}
            <Sub>
              하루 전체를 합산한 로그 계산이며, 위 리뷰와는 다른 출처입니다. 둘을 합산하지
              않습니다. 이 값은 부탁을 들어준 시간과 본인이 도움을 받으려고 움직인 시간을
              구분하지 않습니다 — 그 구분은 엔진이 세지 않습니다.
            </Sub>
          </Section>

          {persona && (
            <Section>
              <SectionTitle>행동의 근거가 된 페르소나</SectionTitle>
              <Text>
                {persona.ageBand} · {persona.groupLabel}
              </Text>
              <Sub>
                혼자 사는가 {TRISTATE(persona.livesAlone)} · 직접 운전{' '}
                {TRISTATE(persona.drivesSelf)} · 차량 {TRISTATE(persona.hasVehicle)} · 좌석{' '}
                {persona.seatCapacity === null ? '원자료에 없음' : persona.seatCapacity}
              </Sub>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Tag
                  $kind={
                    persona.interviewBasis === 'none'
                      ? 'error'
                      : persona.interviewBasis === 'joint_interview'
                        ? 'warn'
                        : 'neutral'
                  }
                >
                  {persona.interviewBasis === 'none'
                    ? '인터뷰 없음'
                    : persona.interviewBasis === 'joint_interview'
                      ? '합동 인터뷰 (2인)'
                      : '인터뷰 1건'}
                </Tag>
                <Tag $kind="unknown">
                  발화 출처 {persona.speechSource === 'rule' ? '규칙' : persona.speechSource}
                </Tag>
              </div>
              {persona.acceptanceConditions.length > 0 && (
                <Sub>수락 조건: {persona.acceptanceConditions.join(' / ')}</Sub>
              )}
              {persona.declineConditions.length > 0 && (
                <Sub>거절 조건: {persona.declineConditions.join(' / ')}</Sub>
              )}
              <Sub>모르는 것: {persona.unknowns.join(' · ')}</Sub>
              <Disclosure>
                <summary>원자료 근거 카드 {persona.evidence.length}개</summary>
                <div>
                  {persona.evidence.map((card) => (
                    <div
                      key={card.id}
                      style={{
                        borderLeft: `2px solid ${colour.border}`,
                        paddingLeft: 8,
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Tag $kind={card.kind === 'fact' ? 'neutral' : 'warn'}>{card.kind}</Tag>
                        <Tag $kind="unknown">{card.field}</Tag>
                      </div>
                      <Sub style={{ color: colour.text }}>{card.claim}</Sub>
                      <Mono>{card.pointer}</Mono>
                      {card.note && <Sub>{card.note}</Sub>}
                    </div>
                  ))}
                  <Sub>
                    카드는 원자료의 위치(JSON pointer)만 가리킵니다. 이름·인터뷰 인용·역할
                    프롬프트는 컴파일 결과에 담기지 않습니다.
                  </Sub>
                </div>
              </Disclosure>
            </Section>
          )}

          <Section>
            <Disclosure>
              <summary>이 사람의 원 사건 {mine.length}건</summary>
              <div>
                {mine.map((event) => (
                  <div key={event.id} style={{ padding: '2px 0' }}>
                    <Mono>
                      #{event.seq} {event.type}
                    </Mono>
                  </div>
                ))}
              </div>
            </Disclosure>
            <Sub>
              이 빌드에 아직 없는 것: 주민과의 자유 대화, 실제 본인·기관 담당자의 검토 입력.
              요청 사건 수는 만족도를 뜻하지 않으므로 이용 통계로 만들지 않았습니다.
            </Sub>
          </Section>
        </Scroll>
      )}
    </Panel>
  );
}
