import styled, { css } from 'styled-components';
import { api } from '../api/client';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';
import { accentA, inkA, night, px, radius, space } from '../ui/theme';
import { dayOf, eventsInOrder, progress } from './selectors';
import type { Week, WeekEvent } from './types';

// The week: seven days down the page, an event on a day, and some days with nothing.
//
// The wall is read-only, so nothing here is pressed: the tablet chooses an event and the wall lights it. What
// has to read at a glance from across a room is which days have something, which one is up now, and which have
// already been read. A day with no event is left empty on purpose - the week is not one event a day, and an
// empty day says so rather than being filled.

const Page = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 4fr) minmax(0, 9fr);
  gap: ${space.xxl};
  padding: ${space.xxl} ${space.xxl} ${space.lg};
  background: ${night.ground};
  color: ${night.ink};
`;

const Side = styled.aside`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: ${space.xl};
  min-height: 0;
`;

const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm};
  font-size: ${px(12)};
  font-weight: 800;
  letter-spacing: 0.08em;
  color: ${night.accent};
  &::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
`;

const Title = styled.h1`
  margin: ${space.md} 0 0;
  font-size: ${px(64)};
  line-height: 1.06;
  font-weight: 800;
  letter-spacing: -0.045em;
  word-break: keep-all;
`;

const Lead = styled.p`
  margin: ${space.lg} 0 0;
  max-width: calc(520px * var(--k, 1));
  font-size: ${px(20)};
  line-height: 1.7;
  letter-spacing: -0.01em;
  color: ${night.mute};
  word-break: keep-all;
`;

const Count = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${space.md};
  > b { font-size: ${px(64)}; line-height: 1; font-weight: 800; letter-spacing: -0.04em; color: ${night.accent}; }
  > span { font-size: ${px(16)}; line-height: 1.5; color: ${night.mute}; }
`;

const Days = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 0;
  display: grid;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: ${space.sm};
`;

const Row = styled.li<{ $empty: boolean }>`
  display: grid;
  grid-template-columns: ${px(72)} minmax(0, 1fr);
  align-items: stretch;
  gap: ${space.lg};
  min-height: 0;
  ${(p) => p.$empty && css`opacity: 0.55;`}
`;

const Day = styled.div<{ $empty: boolean }>`
  display: grid;
  place-items: center;
  border-radius: ${radius.card};
  font-size: ${px(24)};
  font-weight: 800;
  color: ${(p) => (p.$empty ? night.faint : night.ink)};
  background: ${(p) => (p.$empty ? 'transparent' : night.panel)};
  border: 1px solid ${night.line};
`;

const Slot = styled.div`
  min-height: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: ${space.sm};
`;

const Quiet = styled.div`
  display: flex;
  align-items: center;
  padding: 0 ${space.lg};
  border-radius: ${radius.card};
  border: 1px dashed ${night.line};
  font-size: ${px(16)};
  color: ${night.faint};
`;

const Card = styled.div<{ $now: boolean; $seen: boolean }>`
  position: relative;
  min-height: 0;
  display: grid;
  grid-template-columns: ${px(96)} minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space.lg};
  padding: ${space.sm} ${space.lg} ${space.sm} ${space.sm};
  border-radius: ${radius.card};
  overflow: hidden;
  background: ${night.panel};
  border: 1px solid ${(p) => (p.$now ? night.accent : night.line)};
  ${(p) => p.$now && css`
    background: ${night.accentSoft};
    box-shadow: 0 0 0 ${px(2)} ${accentA(0.5)};
  `}
  ${(p) => p.$seen && !p.$now && css`opacity: 0.62;`}
`;

const Shot = styled.div<{ $src: string | null }>`
  align-self: stretch;
  border-radius: ${radius.control};
  background: ${(p) => (p.$src ? `${inkA(0.06)} center / cover url(${p.$src})` : inkA(0.06))};
`;

const Words = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  > strong { font-size: ${px(24)}; line-height: 1.2; font-weight: 800; letter-spacing: -0.03em; word-break: keep-all; }
  > span { font-size: ${px(16)}; line-height: 1.4; color: ${night.mute}; word-break: keep-all;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
`;

const Faces = styled.div`
  display: flex;
  > div + div { margin-left: calc(-12px * var(--k, 1)); }
`;

const Mark = styled.span<{ $kind: 'now' | 'seen' | 'emergency' }>`
  ${pill('xs')}
  position: absolute;
  top: ${space.sm};
  right: ${space.sm};
  font-weight: 800;
  color: ${(p) => (p.$kind === 'now' ? '#fff' : p.$kind === 'emergency' ? night.deep : night.mute)};
  background: ${(p) => (p.$kind === 'now' ? night.accent : p.$kind === 'emergency' ? night.ink : inkA(0.1))};
`;

/** The picture an event is known by: the backdrop of its first scene. Not every event has a drawn one. */
export function coverOf(event: WeekEvent, art: ReadonlySet<string>): string | null {
  const place = event.before.scenes[0]?.frames.find((f) => art.has(f.place))?.place;
  return place ? api.artUrl(place) : null;
}

/** The residents of an event, in the order they appear: the faces a visitor learns to look for. */
export function peopleOf(event: WeekEvent): string[] {
  const seen: string[] = [];
  for (const scene of event.before.scenes) for (const id of scene.cast) if (id !== 'AI' && !seen.includes(id)) seen.push(id);
  return seen.slice(0, 3);
}

interface Props {
  week: Week;
  art: ReadonlySet<string>;
  /** The event the tablet has picked: the wall lights it. */
  now: string | null;
  seen: readonly string[];
}

export default function WeekScreen({ week, art, now, seen }: Props) {
  const events = new Map(eventsInOrder(week).map((e) => [e.id, e]));
  const read = progress(week, new Set(seen));
  return (
    <Page aria-label="이번 주">
      <Side>
        <div>
          <Eyebrow>Dially · 마을의 한 주</Eyebrow>
          <Title>이번 주,<br />마을에서<br />있었던 일</Title>
          <Lead>
            사건은 요일마다 하나씩 일어나지 않습니다. 하루에 둘이 겹치기도 하고, 아무 일 없이 지나가는 날도 있습니다.
            보고 싶은 사건 하나를 골라 보세요.
          </Lead>
        </div>
        <Count aria-live="polite">
          <b>{read.seen}</b>
          <span>/ {read.of}개 사건을 봤습니다<br />남은 사건은 태블릿에서 고를 수 있어요</span>
        </Count>
      </Side>

      <Days>
        {week.days.map(({ day, events: ids }) => (
          <Row key={day} $empty={ids.length === 0}>
            <Day $empty={ids.length === 0}>{day}</Day>
            <Slot>
              {ids.length === 0 && <Quiet>이날은 조용했습니다</Quiet>}
              {ids.map((id) => {
                const event = events.get(id)!;
                const isNow = id === now;
                const isSeen = seen.includes(id);
                return (
                  <Card key={id} $now={isNow} $seen={isSeen} aria-current={isNow}>
                    <Shot $src={coverOf(event, art)} />
                    <Words>
                      <strong>{event.title}</strong>
                      <span>{event.gist}</span>
                    </Words>
                    <Faces>
                      {peopleOf(event).map((p) => <Portrait key={p} actorId={p} art={art} size={40} />)}
                    </Faces>
                    {isNow ? <Mark $kind="now">지금 보는 중</Mark>
                      : event.noChoice ? <Mark $kind="emergency">응급</Mark>
                        : isSeen ? <Mark $kind="seen">읽음</Mark> : null}
                  </Card>
                );
              })}
            </Slot>
          </Row>
        ))}
      </Days>
    </Page>
  );
}

export { dayOf };
