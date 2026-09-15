import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { ASSESSMENT_LABELS,
  DIMENSION_LABELS,
  USAGE_LABELS,
  type AgentReview,
  type GenerationDetail,
} from '../api/iteration';
import type { DomainEvent } from '../api/types';
import { formatClock } from '../positions';
import { hiddenRows, personName, storyRows, type StoryTone } from '../selectors/story';
import {
  Disclosure,
  Hint,
  Mono,
  Panel,
  PanelHead,
  PanelTitle,
  Scroll,
  Sub,
  Tag,
  TextLink,
} from '../ui/primitives';
import { colour, font } from '../ui/theme';

// Bottom right: what just happened, in sentences - and, once the day is over,
// what the residents said about it, in the same place.
//
// Two things this panel is careful about. It never fabricates a summary: a row
// is one event and carries that event's id, so "which record is this" is always
// answerable. And when the day's reviews arrive they do not replace the day -
// both are here, and the majority summary never deletes the person who came off
// worse.

const Tabs = styled.div`
  display: flex;
  gap: 4px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  border: none;
  background: none;
  font-family: inherit;
  font-size: ${font.small};
  padding: 4px 8px;
  border-radius: 999px;
  cursor: pointer;
  color: ${(p) => (p.$active ? colour.primary : colour.secondary)};
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

const Item = styled.button<{ $tone: StoryTone; $active: boolean; $task?: string | null }>`
  display: grid;
  grid-template-columns: 46px 1fr;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid ${colour.border};
  background: ${(p) => (p.$active ? colour.selected : 'transparent')};
  padding: 9px 16px 9px 14px;
  cursor: pointer;
  font-family: inherit;
  /* A line from a request that is still running is marked in that request's
     colour - the same colour the map rings those people with. Tone is the
     fallback for everything else. */
  border-left: ${(p) => (p.$task ? '4px' : '2px')} solid
    ${(p) =>
      p.$task
        ? p.$task
        : p.$tone === 'good'
        ? colour.primary
        : p.$tone === 'bad'
          ? colour.error
          : p.$tone === 'attention'
            ? colour.warn
            : 'transparent'};
  &:hover {
    background: ${(p) => (p.$active ? colour.selected : '#f4f6f8')};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: -2px;
  }
`;

const Clock = styled.span`
  font-size: ${font.small};
  color: ${colour.secondary};
  font-variant-numeric: tabular-nums;
  padding-top: 1px;
`;

const Text = styled.span`
  font-size: ${font.body};
  line-height: 1.5;
  color: ${colour.text};
`;

const Quote = styled.div`
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid ${colour.border};
  font-size: ${font.small};
  color: ${colour.secondary};
`;

const Block = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${colour.border};
  font-size: ${font.body};
  line-height: 1.55;
  color: ${colour.text};
`;

const Empty = styled.div`
  padding: 16px;
  font-size: ${font.small};
  color: ${colour.secondary};
`;

const worstOf = (review: AgentReview): 'negative' | 'mixed' | 'positive' | 'unknown' => {
  const kinds = review.items.map((i) => i.assessment);
  if (kinds.includes('negative')) return 'negative';
  if (kinds.includes('mixed')) return 'mixed';
  if (kinds.includes('positive')) return 'positive';
  return 'unknown';
};

interface Props {
  events: DomainEvent[];
  cursorSeq: number;
  /** The clock, so the panel can say how long nothing has happened. */
  atMs: number;
  /** Total events in the run, so the panel can tell that the day is over. */
  eventCount: number;
  /** The generation whose day just finished, when there is one. */
  generation: GenerationDetail | null;
  /** Colour per still-running request (see selectors/taskColour). */
  taskColours: Map<string, string>;
  onSeek: (seq: number) => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
}

export default function HappeningPanel({
  events,
  cursorSeq,
  atMs,
  eventCount,
  generation,
  taskColours,
  onSeek,
  onOpenScene,
}: Props) {
  const reviews = generation?.reviews ?? [];
  // null = follow the cursor; a click pins one side and stops it following.
  const [tab, setTab] = useState<'events' | 'reviews' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const dayOver = eventCount > 0 && cursorSeq >= eventCount;

  // Newest at the top: while the day plays, the line that just happened is
  // the one being read, and it should not arrive at the bottom of a list.
  const rows = useMemo(() => storyRows(events).reverse(), [events]);
  // The newest readable line, if it is more than half an hour behind the clock.
  const newestMs = rows[0]?.event.simTimeMs ?? null;
  const quietSince = newestMs !== null && atMs - newestMs > 30 * 60_000 ? newestMs : null;
  const hidden = useMemo(() => hiddenRows(events), [events]);

  // The day's reviews only exist once the loop has collected them; until then
  // there is nothing to switch to and the tab is not offered.
  //
  // Once the cursor reaches the end of the log, this area *becomes* the review
  // - doc 15 section 5 asks for the day to end here rather than on a screen the
  // reader has to go and find. Clicking either chip pins the choice, so a
  // reader who wants the event list back at the end of the day keeps it.
  const view = reviews.length === 0 ? 'events' : (tab ?? (dayOver ? 'reviews' : 'events'));

  const graded = reviews.filter((r) => r.usageStatus !== 'no_experience');
  const dissenting = graded.filter((r) => worstOf(r) === 'negative' || worstOf(r) === 'mixed');
  const shownReviews = showAll ? reviews : [...dissenting, ...graded.filter((r) => !dissenting.includes(r))].slice(0, 4);

  return (
    <Panel>
      <PanelHead style={{ justifyContent: 'space-between' }}>
        <PanelTitle>{view === 'reviews' ? '하루를 마친 주민들의 리뷰' : '지금 일어난 일'}</PanelTitle>
        {reviews.length > 0 && (
          <Tabs>
            <TabButton $active={view === 'events'} onClick={() => setTab('events')}>
              하루
            </TabButton>
            <TabButton $active={view === 'reviews'} onClick={() => setTab('reviews')}>
              리뷰 {reviews.length}
            </TabButton>
          </Tabs>
        )}
      </PanelHead>

      <Scroll>
        {view === 'events' ? (
          <>
            {rows.length === 0 && (
              <Empty>이 시각까지 읽을 만한 사건이 없습니다. 재생하거나 시점을 옮겨 보세요.</Empty>
            )}
            {/* At 19:47 with the last line at 09:40 the list looked stale. It
                is not: the incident ended and the day went on. Say so at the
                top, where the newest line is. */}
            {quietSince !== null && (
              <Item as="div" $tone="plain" $active={false} style={{ cursor: 'default' }}>
                <Clock>{formatClock(atMs)}</Clock>
                <span>
                  <Text style={{ color: colour.secondary }}>
                    {formatClock(quietSince)} 이후 새로운 일 없음
                    {dayOver ? '' : ' · 하루는 22:00에 마칩니다'}
                  </Text>
                </span>
              </Item>
            )}
            {rows.map((row) => (
              <Item
                key={row.event.id}
                $tone={row.tone}
                $task={taskColours.get(row.event.correlationId) ?? null}
                $active={row.event.seq === cursorSeq}
                onClick={() => onSeek(row.event.seq)}
                title="이 장면을 다시 봅니다 (저장된 기록 재생, 새 계산 없음)"
              >
                <Clock>{row.clock}</Clock>
                <span>
                  <Text>{row.text}</Text>
                  {row.utterance && <Quote>“{row.utterance}”</Quote>}
                </span>
              </Item>
            ))}
            {hidden.length > 0 && (
              <div style={{ padding: '10px 16px' }}>
                <Disclosure>
                  <summary>요약에서 뺀 기술 사건 {hidden.length}건</summary>
                  <div>
                    {hidden.map((event) => (
                      <div key={event.id} style={{ padding: '2px 0' }}>
                        <Mono>
                          #{event.seq} {event.type}
                        </Mono>{' '}
                        {event.actorId}
                      </div>
                    ))}
                    <Sub style={{ marginTop: 6 }}>
                      화면에서만 줄인 목록입니다
                      <Hint label="줄인 목록">
                        원 로그는 그대로입니다. 각 줄은 원 사건 번호로 되돌아갈 수 있습니다.
                      </Hint>
                    </Sub>
                  </div>
                </Disclosure>
              </div>
            )}
          </>
        ) : (
          <>
            <Block>
              <Sub>
                모의 리뷰 · 겪은 사건만 근거
                <Hint label="모의 리뷰">
                  주민 에이전트가 자기가 실제로 겪은 사건만 근거로 남긴 모의 리뷰입니다. 실제
                  주민의 발언도 만족도도 아니며, 점수로 합산하지 않습니다. 미경험은 관찰
                  결과이지 불만이 아닙니다.
                </Hint>
              </Sub>
            </Block>
            {shownReviews.map((review) => (
              <Block key={review.id}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <strong>{personName(review.actorId)}</strong>
                  <Tag $kind={worstOf(review)}>{USAGE_LABELS[review.usageStatus]}</Tag>
                  <Tag $kind="unknown">{review.adapter} 어댑터</Tag>
                </div>
                <div>{review.overallNarrative}</div>
                {review.items
                  .filter((item) => item.assessment !== 'unknown')
                  .map((item, index) => (
                    <div key={index} style={{ marginTop: 6 }}>
                      <Tag $kind={item.assessment}>
                        {DIMENSION_LABELS[item.dimension]} · {ASSESSMENT_LABELS[item.assessment]}
                      </Tag>
                      <Sub style={{ marginTop: 2 }}>{item.reason}</Sub>
                      {item.requestedChange && (
                        <Sub>
                          <strong>다음에 이용한다면:</strong> {item.requestedChange}
                        </Sub>
                      )}
                      {item.eventRefs.slice(0, 2).map((eventId) => (
                        <TextLink
                          key={eventId}
                          style={{ marginRight: 8 }}
                          onClick={() => onOpenScene(review.attemptId, eventId)}
                        >
                          근거 장면 보기
                        </TextLink>
                      ))}
                    </div>
                  ))}
                {review.unknowns.length > 0 && (
                  <Sub style={{ marginTop: 6 }}>모르는 것: {review.unknowns.join(' · ')}</Sub>
                )}
              </Block>
            ))}
            {reviews.length > shownReviews.length && (
              <div style={{ padding: '12px 16px' }}>
                <TextLink onClick={() => setShowAll(true)}>
                  주민 {reviews.length}명 리뷰 전부 보기
                </TextLink>
              </div>
            )}
            {showAll && (
              <div style={{ padding: '0 16px 16px' }}>
                <Sub>
                  부담이 늘었다고 답한 사람과 소수 의견을 위쪽에 먼저 둡니다. 대표 요약이 이들을
                  지우지 않도록 하기 위해서입니다.
                </Sub>
              </div>
            )}
          </>
        )}
      </Scroll>
    </Panel>
  );
}
