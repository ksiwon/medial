import styled from 'styled-components';
import type { DecisionRecord, DomainEvent } from '../api/types';
import {
  STAGE_LABELS,
  askedPeople,
  currentSentence,
  institutionsInvolved,
  latestReasoning,
  reasonsInOrder,
  type AskedRow,
  type RequestFlow,
} from '../selectors/requests';
import { personName, storyRows, withParticle } from '../selectors/story';
import { ruleName } from '../selectors/words';
import { formatClock } from '../positions';
import {
  Disclosure,
  Mono,
  Panel,
  PanelHead,
  PanelTitle,
  Scroll,
  Sub,
  Tag,
  type TagKind,
} from '../ui/primitives';
import { colour, font } from '../ui/theme';

// The middle column: the AI care orchestrator's own dashboard.
//
// Everything here is scoped to *one* request, chosen from the list at the top.
// The panel this replaced counted event types across the whole day and lit a
// seven-step graph from the totals, so two unrelated requests painted each other
// complete. The grouping key is now the event's own ``correlationId``; nothing
// on screen guesses which events belong together.
//
// What the orchestrator knows is shown as what it *was told*: the reasoning line
// comes from the decision it recorded, and the facts behind it from the matching
// DecisionRecord. `world.*` events are excluded upstream, so the world's reason
// for an unanswered phone cannot appear in MEDial's own status line.

const Now = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${colour.border};
`;

const Sentence = styled.div`
  font-size: ${font.body};
  line-height: 1.5;
  color: ${colour.text};
`;

const Requests = styled.div`
  border-bottom: 1px solid ${colour.border};
`;

const RequestRow = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid ${colour.border};
  border-left: 3px solid ${(p) => (p.$active ? colour.primary : 'transparent')};
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  padding: 8px 16px 8px 13px;
  cursor: pointer;
  font-family: inherit;
  font-size: ${font.small};
  color: ${colour.text};
  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: ${(p) => (p.$active ? colour.selected : '#f4f6f8')};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: -2px;
  }
`;

const Stages = styled.ol`
  list-style: none;
  margin: 0;
  padding: 8px 16px 12px;
  border-bottom: 1px solid ${colour.border};
`;

const Stage = styled.li<{ $state: 'done' | 'current' | 'future' }>`
  display: grid;
  grid-template-columns: 54px 1fr;
  gap: 10px;
  padding: 6px 0 6px 10px;
  font-size: ${font.small};
  line-height: 1.5;
  border-left: 2px solid
    ${(p) =>
      p.$state === 'done' ? colour.primary : p.$state === 'current' ? colour.warn : colour.border};
  color: ${(p) => (p.$state === 'future' ? colour.unknown : colour.text)};
  font-weight: ${(p) => (p.$state === 'current' ? 600 : 400)};
`;

const StageLines = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const Section = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${colour.border};
  display: flex;
  flex-direction: column;
  gap: 6px;
  &:last-child {
    border-bottom: none;
  }
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: ${font.small};
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${colour.secondary};
`;

const Facts = styled.ul`
  margin: 2px 0 0;
  padding-left: 16px;
  line-height: 1.7;
  color: ${colour.secondary};
  font-size: ${font.small};
`;

const Empty = styled.div`
  padding: 16px;
  font-size: ${font.small};
  color: ${colour.unknown};
  line-height: 1.5;
`;

const shortType = (event: DomainEvent) => event.type.split('.').slice(1).join('.');

const Asked = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: ${font.small};
  line-height: 1.5;
`;

const AskedLine = styled.li`
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
`;

const TABLE_WORD: Record<string, string> = {
  accept: '수락',
  decline: '거절',
  relay_or_defer: '넘기거나 미룸',
};

const ANSWER: Record<AskedRow['answer'], { text: string; kind: TagKind }> = {
  accepted: { text: '수락', kind: 'positive' },
  declined: { text: '거절', kind: 'negative' },
  deferred: { text: '나중에', kind: 'warn' },
  relayed: { text: '다른 사람에게 넘김', kind: 'warn' },
  told: { text: '어디 있을지 답함', kind: 'positive' },
  pending: { text: '답 기다리는 중', kind: 'unknown' },
};

/** One line per ask: who, what they said, and - for the researcher - whether
 *  MEDial was even told. A refusal carries the sentence the person gave. */
function AskedList({ rows }: { rows: AskedRow[] }) {
  return (
    <Asked>
      {rows.map((row) => {
        const answer = ANSWER[row.answer];
        return (
          <AskedLine key={`${row.actorId}-${row.seq}`}>
            <strong>{personName(row.actorId)}</strong>
            {row.askedBy !== 'MEDial' && (
              <Sub as="span">← {withParticle(personName(row.askedBy), 'subject')} 부탁</Sub>
            )}
            <Tag $kind={answer.kind}>
              {answer.text}
              {row.answer === 'relayed' && row.passedTo && ` · ${personName(row.passedTo)}`}
            </Tag>
            {row.reason && <span>{row.reason}</span>}
            {row.rule && !row.reason && <span>{ruleName(row.rule)}</span>}
            {row.tableSaid && (
              <Tag $kind="warn" title="원자료 조건으로 만든 거절 표는 이렇게 답했을 것입니다">
                규칙표라면 {TABLE_WORD[row.tableSaid] ?? row.tableSaid}
              </Tag>
            )}
            {!row.seenByMedial && <Tag $kind="unknown">MEDial은 모름</Tag>}
          </AskedLine>
        );
      })}
    </Asked>
  );
}

interface Props {
  flows: RequestFlow[];
  decisions: DecisionRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (seq: number) => void;
}

export default function OrchestratorPanel({
  flows,
  decisions,
  selectedId,
  onSelect,
  onSeek,
}: Props) {
  const flow = flows.find((f) => f.id === selectedId) ?? flows[0] ?? null;
  const reasoning = flow ? latestReasoning(flow, decisions) : null;
  const earlier = flow ? reasonsInOrder(flow).slice(0, -1) : [];
  const asked = flow ? askedPeople(flow) : [];

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>MEDial · 조율 현황</PanelTitle>
        <Sub as="span">진행 중인 요청 {flows.filter((f) => f.closed === null).length}건</Sub>
      </PanelHead>

      {flows.length === 0 ? (
        <Empty>
          이 시점까지 MEDial이 처리 중인 요청이 없습니다. 재생하거나 시점을 옮겨 보세요.
        </Empty>
      ) : (
        <Scroll>
          {/* Every request of the day, not just the selected one: a request that
              was closed hours ago is still part of what happened. */}
          <Requests>
            {flows.map((row) => (
              <RequestRow
                key={row.id}
                $active={row.id === flow?.id}
                onClick={() => onSelect(row.id)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{row.title}</span>
                <Sub as="span">{formatClock(row.firstMs)}</Sub>
                {row.closed === 'resolved' && <Tag $kind="positive">종료</Tag>}
                {row.closed === 'unresolved' && <Tag $kind="negative">미해결</Tag>}
                {row.closed === null && <Tag $kind="warn">진행 중</Tag>}
              </RequestRow>
            ))}
          </Requests>

          {flow && (
            <>
              <Now>
                <Sentence>{currentSentence(flow)}</Sentence>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag $kind="unknown">관련자 {flow.participants.length}명</Tag>
                  {institutionsInvolved(flow).map((who) => (
                    <Tag key={who}>{personName(who)} 참여</Tag>
                  ))}
                </div>
              </Now>

              <Stages>
                {flow.stages.map((stage) => {
                  const rows = storyRows(stage.events);
                  return (
                    <Stage key={stage.key} $state={stage.state}>
                      <span>{STAGE_LABELS[stage.key]}</span>
                      <StageLines>
                        {stage.events.length === 0 ? (
                          <span style={{ color: colour.unknown }}>—</span>
                        ) : (
                          <>
                            {rows.slice(-2).map((row) => (
                              <span key={row.event.id}>
                                <Sub as="span">{row.clock}</Sub> {row.text}
                              </span>
                            ))}
                            {stage.events.length > 2 && (
                              <Sub as="span">이 단계에서 {stage.events.length}건</Sub>
                            )}
                          </>
                        )}
                      </StageLines>
                    </Stage>
                  );
                })}
              </Stages>

              <Section>
                <SectionTitle>이렇게 정한 이유</SectionTitle>
                {reasoning ? (
                  <>
                    {earlier.length > 0 && (
                      <Facts>
                        {earlier.map((row) => (
                          <li key={row.seq}>
                            {formatClock(row.atMs)} · {row.question} →{' '}
                            {row.chosen ? personName(row.chosen) : '없음'}: {row.rationale}
                          </li>
                        ))}
                      </Facts>
                    )}
                    <Sentence>{reasoning.rationale || '기록된 근거 문장이 없습니다.'}</Sentence>
                    <Disclosure>
                      <summary>
                        MEDial이 알고 있던 것 {reasoning.knownFacts.length}가지 · 고르지 않은 후보{' '}
                        {reasoning.excluded.length}명
                      </summary>
                      <div>
                        <Sub>
                          질문: {reasoning.question || '기록 없음'} → 선택: {reasoning.chosen}
                        </Sub>
                        <Facts>
                          {reasoning.knownFacts.map((fact) => (
                            <li key={fact}>{fact}</li>
                          ))}
                          {reasoning.knownFacts.length === 0 && <li>기록된 근거 항목 없음</li>}
                        </Facts>
                        {reasoning.excluded.length > 0 && (
                          <>
                            <Sub style={{ marginTop: 6 }}>고르지 않은 이유</Sub>
                            <Facts>
                              {reasoning.excluded.map((row) => (
                                <li key={row.actorId}>
                                  {personName(row.actorId)} — {row.reason}
                                </li>
                              ))}
                            </Facts>
                          </>
                        )}
                      </div>
                    </Disclosure>
                  </>
                ) : (
                  <Empty style={{ padding: 0 }}>
                    이 요청에 대해 MEDial이 내린 판단 기록이 아직 없습니다.
                  </Empty>
                )}
              </Section>

              <Section>
                <SectionTitle>누구에게 부탁했고, 뭐라고 했나</SectionTitle>
                {asked.length === 0 ? (
                  <Empty style={{ padding: 0 }}>아직 아무에게도 부탁하지 않았습니다.</Empty>
                ) : (
                  <AskedList rows={asked} />
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {flow.participants
                    .filter((id) => !asked.some((row) => row.actorId === id))
                    .map((id) => (
                      <Tag key={id} $kind={id === flow.subjectId ? 'neutral' : 'unknown'}>
                        {personName(id)}
                        {id === flow.subjectId && ' · 대상'}
                      </Tag>
                    ))}
                </div>
                <Sub>
                  이 요청의 사건에 실제로 등장한 사람만입니다. 거절 옆의 말은 그 사람이 남긴
                  사유이고, 점수로 합치지 않습니다.
                </Sub>
              </Section>

              <Section>
                <Disclosure>
                  <summary>이 요청의 원 사건 {flow.events.length}건</summary>
                  <div>
                    {flow.events.map((event) => (
                      <div key={event.id} style={{ padding: '2px 0' }}>
                        <Mono>
                          #{event.seq} {shortType(event)}
                        </Mono>{' '}
                        <button
                          type="button"
                          onClick={() => onSeek(event.seq)}
                          style={{
                            border: 'none',
                            background: 'none',
                            color: colour.primary,
                            cursor: 'pointer',
                            font: 'inherit',
                            padding: 0,
                          }}
                        >
                          {event.actorId}
                        </button>
                      </div>
                    ))}
                    <Sub style={{ marginTop: 6 }}>
                      correlationId <Mono>{flow.id}</Mono> 기준으로 묶었습니다. 다른 요청의 사건은
                      섞이지 않고, 세계 사건(<Mono>world.*</Mono>)은 이 흐름에 들어오지 않습니다 —
                      무응답의 세계 쪽 이유는 연락한 쪽이 알 수 없는 정보입니다.
                    </Sub>
                  </div>
                </Disclosure>
              </Section>
            </>
          )}
        </Scroll>
      )}
    </Panel>
  );
}
