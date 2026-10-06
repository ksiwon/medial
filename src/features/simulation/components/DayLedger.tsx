import styled from 'styled-components';
import { requestColour } from '../scene/colours';
import type { Episode } from '../scene/types';
import type { LedgerRow } from '../selectors/dayLedger';
import { personName } from '../selectors/story';
import { formatClock } from '../positions';
import { colour, font, radius } from '../ui/theme';

// 오늘의 요약: one line per request, in the order they began, up to the playhead.
//
// A request is what the day was about ("응답 없는 안부 확인 · P1"), not every call.
// The line that is happening now is lifted; the Tasks inside a request sit under
// it so a reader can see how it went without a second screen. Nothing past the
// playhead is listed - the ledger is a record of what has happened, not a plan.

/* As tall as its lines, up to a cap: a day with one request gives the stage
   the room; a day with eight scrolls inside. */
const Box = styled.section`
  flex: 0 1 auto;
  max-height: 34%;
  min-height: 92px;
  display: flex;
  flex-direction: column;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.panel};
  overflow: hidden;
`;

const Head = styled.header`
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid ${colour.border};
  > h2 { margin: 0; font-size: ${font.body}; font-weight: 800; }
  > span { font-size: ${font.small}; color: ${colour.secondary}; }
`;

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 6px 8px 10px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Row = styled.li<{ $tint: string; $live: boolean }>`
  display: grid;
  grid-template-columns: 54px 1fr;
  gap: 4px 10px;
  padding: 8px 10px;
  border-radius: ${radius.control};
  border-left: 3px solid ${(p) => p.$tint};
  background: ${(p) => (p.$live ? colour.selected : 'transparent')};
  > time { font-variant-numeric: tabular-nums; font-weight: 800; color: ${colour.text}; }
  > div > b { font-size: ${font.body}; font-weight: 700; }
  > div > i { font-style: normal; color: ${colour.secondary}; font-size: ${font.small}; margin-left: 8px; }
  > div > p { margin: 3px 0 0; font-size: ${font.small}; color: ${colour.secondary}; line-height: 1.5; }
`;

const Steps = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  > span { white-space: nowrap; }
  > span[data-now='true'] { color: ${colour.text}; font-weight: 700; }
  > span[data-wait='true'] { color: ${colour.unknown}; }
`;

const Empty = styled.p`
  margin: 0;
  padding: 18px 14px;
  font-size: ${font.small};
  color: ${colour.secondary};
`;

interface Props {
  rows: LedgerRow[];
  episodes: Episode[];
  onSeek: (ms: number) => void;
}

export default function DayLedger({ rows, episodes, onSeek }: Props) {
  const tints = requestColour(episodes);
  return (
    <Box aria-label="오늘의 요약">
      <Head>
        <h2>오늘의 요약</h2>
        <span>{rows.length === 0 ? '아직 접수된 요청이 없습니다' : `요청 ${rows.length}건`}</span>
      </Head>
      {rows.length === 0 ? (
        <Empty>하루가 시작되면 MEDial이 받은 요청이 시각 순으로 여기에 쌓입니다.</Empty>
      ) : (
        <List>
          {rows.map((row) => {
            const live = row.state === 'open';
            const tint = tints.get(row.steps[0].requestId) ?? colour.primary;
            return (
              <Row key={row.key} $tint={tint} $live={live}>
                <time>{formatClock(row.firstMs)}</time>
                <div>
                  <b>{row.need}</b>
                  {row.subjectId && <i>{personName(row.subjectId)}</i>}
                  <p>
                    <Steps>
                      {row.steps.map((step, i) => (
                        <span key={step.requestId} data-now={step.live} data-wait={!step.started}>
                          {i > 0 && <span aria-hidden> → </span>}
                          <a role="button" tabIndex={0} style={{ cursor: 'pointer' }}
                            title={`${formatClock(step.atMs)}로 이동`}
                            onClick={() => onSeek(step.atMs)}
                            onKeyDown={(e) => { if (e.key === 'Enter') onSeek(step.atMs); }}>
                            {step.title}
                          </a>
                          {/* A request can run across the day (the trip out at seven, the
                              trip back at one), so each step says when it was. */}
                          <small style={{ marginLeft: 4, color: colour.unknown }}>{formatClock(step.atMs)}</small>
                        </span>
                      ))}
                    </Steps>
                  </p>
                </div>
              </Row>
            );
          })}
        </List>
      )}
    </Box>
  );
}
