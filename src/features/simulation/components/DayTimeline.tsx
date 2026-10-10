import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styled, { keyframes } from 'styled-components';
import { formatClock } from '../positions';
import type { TimelineItem } from '../selectors/dayLedger';
import { personName } from '../selectors/story';
import { accentA, font, inkA, night, px, radius, shadeA } from '../ui/theme';
import { pill } from '../ui/primitives';

// 오늘의 타임라인: the right-hand column of the observe screen, and the day's
// playback control (2026-10-07).
//
// One line per Task down a rail, the way an incident log reads: what is over is
// quiet, what is happening now is lit and says which request it belongs to, and
// what is planned but not begun is faint and says so. Nothing else ahead is
// listed (selectors/dayLedger timelineAt) - the timeline is what has happened and
// what was scheduled, not the day's script.
//
// The rail is the scrubber. It runs from 05:00 at the top to the day's end at the
// bottom and passes each line's dot at that line's time, so dragging along it
// moves the clock through the day, slowly where the day is busy and quickly
// where it is quiet. Play, the clock, the reading pace and the settings sit above
// it. This replaced the horizontal playback bar under the stage, whose coloured
// bars drew every scene of the day - the evening's emergency included - before it
// had happened, and 오늘의 요약 (a request per line under the stage).

const INK = night.panel;
const PAPER = night.ink;
const LIVE = night.accent;
/** The rail's centre line, in px from the track's left. The line, every dot, the
 *  handle and the hour ticks are all centred on it (each with border-box sizing
 *  and a -50% shift), so none of them sits a pixel or three off the line. */
const RAIL_X = 18;
/** Where a line's dot sits, from the line's top: also the rail anchor's height. */
const DOT_Y = 23;
/** Every line's title row is this tall, whatever its font size, and starts this
 *  far down: so the dot (at DOT_Y) is on the title's centre line in every state,
 *  and every line has the same space above as below its content. */
const TITLE_H = 24;
const PAD_Y = DOT_Y - TITLE_H / 2;

const glow = keyframes`0%, 100% { box-shadow: 0 0 0 0 ${accentA(0.55)} } 50% { box-shadow: 0 0 0 8px ${accentA(0)} }`;

const Box = styled.section`
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: ${INK};
  color: ${PAPER};
  border-radius: ${radius.panel};
  overflow: hidden;
`;

/** An hour on the rail where no line is: the quiet stretch reads as time. */
const Hour = styled.span`
  position: absolute;
  left: ${RAIL_X + 12}px;
  transform: translateY(-50%);
  font-size: calc(12px * var(--k, 1));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: ${night.faint};
  pointer-events: none;
  &::before {
    content: '';
    position: absolute;
    left: -16px;
    top: 50%;
    width: 8px;
    border-top: 1px solid ${night.faint};
  }
`;

const Head = styled.header`
  flex: none;
  padding: 16px 16px 12px;
  border-bottom: 1px solid ${inkA(0.1)};
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Play = styled.button`
  ${pill('md')}
  flex: none;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  border: none;
  background: ${LIVE};
  color: #fff;
  &:focus-visible { outline: 2px solid ${PAPER}; outline-offset: 2px; }
`;

const Clock = styled.time`
  flex: 1;
  text-align: right;
  font-size: calc(36px * var(--k, 1));
  line-height: 1;
  font-weight: 800;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
`;

const Paces = styled.div`
  display: flex;
  gap: 4px;
  flex: 1;
`;

const Pace = styled.button<{ $on: boolean }>`
  ${pill('sm')}
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? PAPER : 'rgba(246, 241, 232, 0.25)')};
  background: ${(p) => (p.$on ? PAPER : 'transparent')};
  color: ${(p) => (p.$on ? INK : 'rgba(246, 241, 232, 0.75)')};
`;

/** Everything secondary to watching, behind one gear. Opens downwards. */
const Settings = styled.details`
  position: relative;
  flex: none;
  > summary {
    cursor: pointer;
    list-style: none;
    color: ${inkA(0.75)};
    font-size: calc(16px * var(--k, 1));
    padding: 4px 8px;
    border-radius: ${radius.control};
  }
  > summary::-webkit-details-marker { display: none; }
  > summary:focus-visible { outline: 2px solid ${PAPER}; }
  > div {
    position: absolute;
    right: 0;
    top: 36px;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: #fff;
    color: #1d2935;
    border-radius: ${radius.control};
    padding: 12px;
    box-shadow: 0 8px 20px ${shadeA(0.35)};
    z-index: 8;
    font-size: ${font.small};
  }
`;

const Note = styled.p`
  margin: 0;
  font-size: calc(12px * var(--k, 1));
  color: ${inkA(0.55)};
`;

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  > ol { flex: 1 0 auto; }
`;

/* At least as tall as the column, with the day's end at the bottom: the quiet
   hours after the last line get the rail's remaining length, not a few pixels. */
const Track = styled.ol`
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0 16px 0 0;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  > li:last-child { margin-top: auto; }
`;

/** The rail's hit area and its two strokes: the day so far, and the rest. */
const Rail = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${RAIL_X - 14}px;
  width: 28px;
  cursor: ns-resize;
  touch-action: none;
  z-index: 2;
  &::before {
    content: '';
    position: absolute;
    left: 12px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: ${inkA(0.16)};
  }
  > i {
    position: absolute;
    left: 12px;
    top: 0;
    width: 2px;
    background: ${LIVE};
  }
`;

/** The playhead: a handle on the rail. */
const Playhead = styled.div`
  position: absolute;
  left: ${RAIL_X}px;
  right: 0;
  height: 0;
  z-index: 3;
  pointer-events: none;
  > b {
    position: absolute;
    left: 0;
    top: 0;
    box-sizing: border-box;
    width: 20px;
    height: 20px;
    transform: translate(-50%, -50%);
    border-radius: ${radius.round};
    background: ${PAPER};
    border: 4px solid ${LIVE};
    pointer-events: auto;
    cursor: grab;
  }
`;

const Item = styled.li<{ $state: TimelineItem['state'] | 'edge' }>`
  position: relative;
  padding: ${PAD_Y}px 0 ${PAD_Y}px 40px;
  cursor: pointer;
  border-bottom: 1px solid ${inkA(0.08)};
  > i {
    position: absolute;
    left: ${RAIL_X}px;
    top: ${DOT_Y}px;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    transform: translate(-50%, -50%);
    border-radius: ${radius.round};
    z-index: 2;
    background: ${(p) => (p.$state === 'now' ? LIVE : p.$state === 'done' ? 'rgba(246, 241, 232, 0.55)' : INK)};
    border: 1px ${(p) => (p.$state === 'planned' ? 'dashed' : 'solid')} ${(p) => (p.$state === 'now' ? LIVE : 'rgba(246, 241, 232, 0.55)')};
    animation: ${(p) => (p.$state === 'now' ? glow : 'none')} 1.6s ease-in-out infinite;
  }
  > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  > div > b {
    font-size: ${(p) => px(p.$state === 'now' ? 20 : p.$state === 'edge' ? 13 : 16)};
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: ${TITLE_H}px;
    word-break: keep-all;
    color: ${(p) => (p.$state === 'now' ? LIVE
      : p.$state === 'done' ? 'rgba(246, 241, 232, 0.62)'
        : p.$state === 'edge' ? 'rgba(246, 241, 232, 0.5)' : 'rgba(246, 241, 232, 0.36)')};
  }
  > div > time {
    flex: none;
    font-size: ${font.small};
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: ${(p) => (p.$state === 'now' ? PAPER : 'rgba(246, 241, 232, 0.5)')};
  }
  &:hover > div > b { color: ${(p) => (p.$state === 'now' ? LIVE : PAPER)}; }
`;

const Detail = styled.p`
  margin: 8px 0 0;
  font-size: calc(12px * var(--k, 1));
  line-height: 1.55;
  color: ${inkA(0.88)};
  word-break: keep-all;
  > span { display: block; color: ${inkA(0.6)}; }
`;

const Tag = styled.u<{ $kind: 'planned' | 'unseen' }>`
  ${pill('xs')}
  margin-top: 8px;
  text-decoration: none;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: ${(p) => (p.$kind === 'unseen' ? '#f3c87a' : 'rgba(246, 241, 232, 0.6)')};
  border: 1px ${(p) => (p.$kind === 'unseen' ? 'solid' : 'dashed')} currentColor;
`;

/** A point of the rail: a height in the track and the time it stands for. */
type Anchor = { y: number; ms: number };

/** Piecewise-linear between the anchors, both ways. */
function along(anchors: Anchor[], from: 'y' | 'ms', value: number): number {
  const to = from === 'y' ? 'ms' : 'y';
  if (anchors.length === 0) return 0;
  if (value <= anchors[0][from]) return anchors[0][to];
  for (let i = 1; i < anchors.length; i += 1) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (value <= b[from]) {
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((value - a[from]) / span) * (b[to] - a[to]) : b[to];
    }
  }
  return anchors[anchors.length - 1][to];
}

interface Props {
  items: TimelineItem[];
  atMs: number;
  dayStartMs: number;
  dayEndMs: number;
  playing: boolean;
  onTogglePlay: () => void;
  /** Move the clock (while dragging), and settle it (on release). */
  onSeek: (ms: number) => void;
  onCommit: () => void;
  paces: readonly { value: number; label: string }[];
  pace: number;
  onPace: (pace: number) => void;
  /** What the gear opens. */
  settings: ReactNode;
}

export default function DayTimeline({
  items, atMs, dayStartMs, dayEndMs, playing, onTogglePlay, onSeek, onCommit, paces, pace, onPace, settings,
}: Props) {
  const track = useRef<HTMLOListElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  /** Where the lines sit, so an hour mark never lands on one. */
  const [rows, setRows] = useState<[number, number][]>([]);

  // The rail's anchors are the dots: the day's start, each line at its time, and its end.
  useLayoutEffect(() => {
    const measure = () => {
      const box = track.current;
      if (!box) return;
      const dots = [...box.querySelectorAll<HTMLElement>('[data-ms]')];
      const points = dots.map((li) => ({ y: li.offsetTop + li.clientTop + DOT_Y, ms: Number(li.dataset.ms) }));
      const sorted: Anchor[] = [];
      for (const point of points) if (!sorted.length || (point.ms >= sorted[sorted.length - 1].ms && point.y > sorted[sorted.length - 1].y)) sorted.push(point);
      setAnchors(sorted);
      setRows(dots.map((li) => [li.offsetTop, li.offsetTop + li.offsetHeight]));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer && track.current) observer.observe(track.current);
    return () => observer?.disconnect();
  }, [items]);

  const headY = along(anchors, 'ms', atMs);
  const hours: { ms: number; y: number; label: string }[] = [];
  for (let ms = Math.ceil(dayStartMs / 3_600_000) * 3_600_000; ms < dayEndMs; ms += 3_600_000) {
    const y = along(anchors, 'ms', ms);
    const clear = rows.every(([top, bottom]) => y < top - 10 || y > bottom + 10)
      && hours.every((h) => Math.abs(h.y - y) > 34);
    if (anchors.length > 1 && clear) hours.push({ ms, y, label: `${formatClock(ms).slice(0, 2)}시` });
  }

  // Keep the playhead in view while the day plays.
  useLayoutEffect(() => {
    const view = scroll.current;
    if (!view || !playing) return;
    if (headY < view.scrollTop + 40 || headY > view.scrollTop + view.clientHeight - 60) {
      view.scrollTo({ top: Math.max(0, headY - view.clientHeight / 2), behavior: 'smooth' });
    }
  }, [headY, playing]);

  const timeAt = useCallback((clientY: number) => {
    const box = track.current!.getBoundingClientRect();
    const ms = along(anchors, 'y', clientY - box.top);
    return Math.round(Math.min(dayEndMs, Math.max(dayStartMs, ms)) / 60_000) * 60_000;
  }, [anchors, dayStartMs, dayEndMs]);

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSeek(timeAt(e.clientY));
  };

  const seen = items.filter((item) => item.state !== 'planned').length;
  return (
    <Box aria-label="오늘의 타임라인">
      <Head>
        <Row>
          {/* This plays back a stored log. Stopping it stops nothing on the server. */}
          <Play type="button" onClick={onTogglePlay}>{playing ? '⏸ 정지' : '▶ 재생'}</Play>
          <Clock>{formatClock(atMs)}</Clock>
        </Row>
        <Row>
          <Paces role="group" aria-label="대사 속도">
            {paces.map((option) => (
              <Pace key={option.value} type="button" $on={pace === option.value} aria-pressed={pace === option.value}
                onClick={() => onPace(option.value)}>
                {option.label}
              </Pace>
            ))}
          </Paces>
          <Settings>
            <summary aria-label="재생 설정" title="재생 설정">⚙</summary>
            <div>{settings}</div>
          </Settings>
        </Row>
        <Note title="앞일은 예정된 것만 보입니다. 선을 끌어 시각을 옮깁니다.">
          {seen === 0 ? '아직 일어난 일이 없습니다' : `지금까지 ${seen}건`} · 선을 끌어 시각 이동
        </Note>
      </Head>
      <Scroll ref={scroll}>
        <Track ref={track}>
          <Rail
            role="slider"
            aria-label="시각"
            aria-orientation="vertical"
            aria-valuemin={dayStartMs}
            aria-valuemax={dayEndMs}
            aria-valuenow={atMs}
            aria-valuetext={formatClock(atMs)}
            tabIndex={0}
            onPointerDown={drag}
            onPointerMove={(e) => { if (e.buttons) onSeek(timeAt(e.clientY)); }}
            onPointerUp={onCommit}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowDown' ? 5 : e.key === 'ArrowUp' ? -5 : 0;
              if (!step) return;
              e.preventDefault();
              onSeek(Math.min(dayEndMs, Math.max(dayStartMs, atMs + step * 60_000)));
            }}
            onKeyUp={onCommit}
          >
            <i style={{ height: Math.max(0, headY) }} />
          </Rail>
          <Playhead style={{ top: headY }} aria-hidden><b /></Playhead>
          {hours.map((h) => <Hour key={h.ms} style={{ top: h.y }} aria-hidden>{h.label}</Hour>)}

          <Item $state="edge" data-ms={dayStartMs} onClick={() => { onSeek(dayStartMs); onCommit(); }}>
            <i aria-hidden />
            <div><b>하루 시작</b><time>{formatClock(dayStartMs)}</time></div>
          </Item>
          {items.map((item) => (
            <Item key={item.requestId} $state={item.state} data-state={item.state} data-ms={item.startMs}
              onClick={() => { onSeek(item.startMs); onCommit(); }} title={`${formatClock(item.startMs)}로 이동`}>
              <i aria-hidden />
              <div>
                <b>{item.title}</b>
                <time>{formatClock(item.startMs)}</time>
              </div>
              {item.state === 'now' && (
                <Detail>
                  {item.need}{item.subjectId ? ` · ${personName(item.subjectId)}` : ''}
                  <span>{formatClock(item.startMs)} – {formatClock(item.endMs)}</span>
                </Detail>
              )}
              {item.state === 'planned' && <Tag $kind="planned">예정{item.subjectId ? ` · ${personName(item.subjectId)}` : ''}</Tag>}
              {!item.medial && <Tag $kind="unseen">MEDial은 모름</Tag>}
            </Item>
          ))}
          <Item $state="edge" data-ms={dayEndMs} onClick={() => { onSeek(dayEndMs); onCommit(); }}
            style={{ borderBottom: 'none', borderTop: '1px solid ${inkA(0.08)}' }}>
            <i aria-hidden />
            <div><b>하루 끝 · 주민 평가</b><time>{formatClock(dayEndMs)}</time></div>
          </Item>
        </Track>
      </Scroll>
    </Box>
  );
}
