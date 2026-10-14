import { useEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import type { AttemptDetail, DomainEvent, VillagePayload } from '../api/types';
import DayTimeline from '../components/DayTimeline';
import DaySummary from '../components/DaySummary';
import MedialDashboard from '../components/MedialDashboard';
import VillageMap from '../components/VillageMap';
import { formatClock, medialKnowledge, placeLabel, posesAt } from '../positions';
import { openRequests, requestColour } from '../scene/colours';
import { judgmentOf } from '../scene/judgment';
import { DAY_START_MS, usePlayback } from '../scene/playback';
import { useLineVoice } from '../scene/voice';
import { REVEAL_STEP_S, REVEAL_STEPS } from '../scene/reel';
import SceneStage from '../scene/SceneStage';
import type { Beat, Episode, SegmentVideo } from '../scene/types';
import { ledgerAt, routineAt, timelineAt } from '../selectors/dayLedger';
import { beckon, pill } from '../ui/primitives';
import { accentA, night, px, radius } from '../ui/theme';

// 사례와 서비스 경험 - watching one run.
//
// Three columns (2026-10-07). The village map stands upright on the left and never
// moves or shrinks: it is the one thing that is always there. In the middle, the
// stage over the playback bar. On the right, the day's timeline down a rail:
// what has happened, what is happening, and what was scheduled - nothing else
// ahead (components/DayTimeline).
//
// The stage is a request's scene when it has one - a frame per place, the people
// there, their words as bubbles, and MEDial, which has no body, as its judgement
// panel - and MEDial's dashboard when it does not, so it is never empty. The
// ledger is one line per request up to the playhead.
//
// Before this the day's ledger sat under the stage and the playback track drew
// every scene of the day as a coloured bar, which showed the evening's emergency
// at five in the morning. Both are gone; the timeline is the one record.

const Screen = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  /* The map column is as wide as the village at its height (VillageMap onFitWidth),
     within sensible bounds; the stage takes the rest. */
  grid-template-columns: var(--map-w, minmax(280px, 24%)) minmax(0, 1fr) minmax(252px, 19%);
  gap: 12px;
  padding: 12px;
  background: ${night.ground};
  color: ${night.ink};

  /* A narrow window cannot hold the village and the timeline beside a filmed
     scene. They stack: the map above, shorter, then the stage, then the timeline. */
  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 36%) minmax(520px, 1fr) minmax(320px, auto);
    overflow-y: auto;
  }
`;

const MapColumn = styled.div`
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${night.panel};
  border-radius: ${radius.panel};
`;

/** What the header used to say, now a strip on top of the map column: which day
 *  this is, and that every person here is invented (the way back to the start is in the foot). */
const MapStrip = styled.div`
  flex: none;
  padding: 12px 16px;
  font-size: calc(12px * var(--k, 1));
  color: ${night.mute};
  > div { display: flex; align-items: center; gap: 8px; }
  > div > b { font-size: calc(16px * var(--k, 1)); font-weight: 800; color: ${night.ink}; letter-spacing: 0.02em; }
  > div > em { ${pill('xs')} font-style: normal; font-weight: 800; color: #fff; background: ${night.accent}; }
  > ol { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  > ol > li { display: flex; flex-direction: column; gap: 2px; padding-left: 8px; border-left: 4px solid ${night.accent}; line-height: 1.35; }
  > ol > li > span { color: ${night.mute}; }
  > ol > li > b { font-weight: 800; color: ${night.ink}; }
`;

const MapBody = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const Right = styled.div`
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Stage = styled.div`
  position: relative;
  flex: 1 1 0;
  min-height: 300px;
`;

/* The two layers take turns, never share the stage: whichever is leaving goes
   at once and the one arriving waits for it. Cross-faded, a scene's captions and
   the dashboard's numbers sat on top of each other and neither could be read. */
const SceneLayer = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${(p) => (p.$on ? 1 : 0)};
  transform: ${(p) => (p.$on ? 'none' : 'scale(1.02)')};
  transition: opacity ${(p) => (p.$on ? '0.5s ease 0.25s' : '0.2s ease')},
    transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: ${(p) => (p.$on ? 'auto' : 'none')};
`;

const DashLayer = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${(p) => (p.$on ? 1 : 0)};
  transition: opacity ${(p) => (p.$on ? '0.5s ease 0.25s' : '0.2s ease')};
  pointer-events: ${(p) => (p.$on ? 'auto' : 'none')};
`;

/** What happened in the stretch the day passes over: the clock stands still and one sentence says it. */
const NoteVeil = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${px(48)};
  background: rgba(21, 21, 15, 0.84);
  border-radius: inherit;
  animation: ${keyframes`from { opacity: 0 } to { opacity: 1 }`} 0.35s ease both;
  pointer-events: none;
`;

const NoteCard = styled.div`
  max-width: ${px(960)};
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${px(20)};
  word-break: keep-all;
  animation: ${keyframes`from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none }`} 0.5s ease 0.1s both;
  > b { ${pill('md')} background: ${night.accent}; color: #fff; font-weight: 800; letter-spacing: 0.04em; }
  > p { margin: 0; font-size: ${px(40)}; font-weight: 800; line-height: 1.35; letter-spacing: -0.03em; color: ${night.ink}; text-wrap: balance; }
`;

const DayEnd = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 12px 20px;
  border-radius: ${radius.panel};
  background: ${night.accentSoft};
  box-shadow: inset 0 0 0 1px ${accentA(0.5)};
  font-size: calc(16px * var(--k, 1));
  color: ${night.ink};
  /* The title is one line and the facts are another: two weights of text that
     share a line wrap in the middle of a phrase. Each fact is kept whole. */
  > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  > div > p { margin: 0; display: flex; flex-wrap: wrap; gap: 0 12px; font-size: calc(12px * var(--k, 1)); color: ${night.mute}; }
  > div > p > span { white-space: nowrap; }
  > button { flex: none; font: inherit; ${pill('md')} ${beckon} font-weight: 800; cursor: pointer; border: none;
             background: ${night.accent}; color: #fff; }
  > small { flex: none; margin-left: auto; font-size: calc(12px * var(--k, 1)); color: ${night.mute}; font-variant-numeric: tabular-nums; }
`;

/** How long the end of a day waits before it goes on to the residents' evaluations by itself, in seconds. A touch goes at once. */
export const DAYEND_WAIT_S = 5;

interface Props {
  village: VillagePayload;
  detail: AttemptDetail;
  events: DomainEvent[];
  art: ReadonlySet<string>;
  /** What the strip says at 22:00, and its button; `note` is a line of facts. */
  dayEnd: { text: string; action: string; note?: string | null };
  /** The day is over: the evaluations are the next thing to read. */
  onReadEvaluations: () => void;
  /** Which day this is and the way back, for a record that is walked day by day. */
  strip?: { day: string; /** The requests picked on the way here, so the day reads as their result. */ chosen?: readonly string[] };
  /** The rules the visitor changed on the way here, by the name the judgement panel gives them. */
  changedRules?: readonly string[];
}

export default function ObserveScreen({ village, detail, events, art, dayEnd: ending, onReadEvaluations, strip, changedRules = [] }: Props) {
  const p = usePlayback();
  /** To the next scene, and on playing from there (jumpScene stops the clock). */
  const skip = async () => {
    const { jumpScene, play, reel: current } = usePlayback.getState();
    await jumpScene(1);
    const { rt } = usePlayback.getState();
    if (current && rt < current.total - 0.01) await play();
  };
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const reel = p.reel;
  const position = p.position;
  useLineVoice(position, p.playing);

  const atMs = position?.atMs ?? DAY_START_MS;
  const cursorSeq = position?.cursorSeq ?? 0;
  const poses = useMemo(() => posesAt(detail.timeline ?? null, atMs), [detail.timeline, atMs]);
  const medialKnown = useMemo(() => medialKnowledge(events, cursorSeq), [events, cursorSeq]);
  const colours = useMemo(() => {
    const all = requestColour(reel?.episodes ?? []);
    const open = openRequests(events, cursorSeq);
    return new Map([...all].filter(([id]) => open.has(id)));
  }, [reel, events, cursorSeq]);

  const segment = position?.segment ?? null;
  const inScene = segment !== null && segment.kind !== 'map';
  // A skipped stretch's note: "09:30 · sentence" is the time, then what the record says it was.
  const noteRaw = segment?.kind === 'map' ? segment.note ?? null : null;
  const note = noteRaw ? { when: noteRaw.split(' · ')[0], text: noteRaw.split(' · ').slice(1).join(' · ') } : null;
  // The last scene stays mounted while it fades out into the map.
  const last = useRef<{ episode: Episode; beat: Beat; e: number; b: number } | null>(null);
  if (reel && segment && segment.kind !== 'map') {
    const episode = reel.episodes[segment.episode];
    last.current = { episode, beat: episode.beats[segment.beat], e: segment.episode, b: segment.beat };
  }
  const scene = last.current;
  // The video mode: the clip of this moment; the scene fading out into the map keeps its last one.
  const lastVideo = useRef<SegmentVideo | null>(null);
  if (segment?.kind === 'line' || segment?.kind === 'lead') lastVideo.current = segment.video ?? null;
  const video = lastVideo.current;

  // Where the stage is: its frames, marked on the map while the scene is on.
  const spotlight = useMemo(
    () => (inScene && scene ? scene.beat.frames.map((f) => ({ place: f.place, who: f.who, label: f.label })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inScene, scene?.e, scene?.b],
  );

  const line = segment?.kind === 'line' ? segment.line : null;
  const typing = segment?.kind === 'line' && position!.offset < segment.typing;
  // A record that carries its scenes carries MEDial's panel for each Task too.
  // Its verdicts stay "묻는 중" until the Task's last line has been said: the
  // answer is known when the call ends, not when it starts.
  const stored = scene ? detail.scenes?.panels[scene.episode.requestId] ?? null : null;
  const lastOfTask = scene && reel
    ? !reel.episodes.slice(scene.e + 1).some((ep) => ep.requestId === scene.episode.requestId)
      && scene.b === scene.episode.beats.length - 1
    : false;
  const resolved = lastOfTask && scene !== null
    && (segment?.kind === 'hold' || (line !== null && line >= scene.beat.lines.length - 1 && !typing));
  const judgment = useMemo(() => {
    if (!scene) return null;
    if (stored) {
      return resolved ? stored.judgment : {
        ...stored.judgment,
        asked: stored.judgment.asked.map((a) => ({ ...a, verdict: 'asking' as const, heard: null })),
      };
    }
    return judgmentOf(scene.episode.requestId, cursorSeq, events, detail.decisions, detail.rules ?? []);
  }, [scene?.episode.requestId, stored, resolved, cursorSeq, events, detail.decisions, detail.rules]);
  const beatSeconds = useMemo(() => {
    if (!reel || !scene) return 1;
    return reel.segments.filter((s) => s.kind !== 'map' && s.episode === scene.e && s.beat === scene.b)
      .reduce((sum, s) => sum + s.dur, 0);
  }, [reel, scene?.e, scene?.b]);

  const lit = segment?.kind === 'lead' && segment.reveal
    ? Math.max(0, Math.min(REVEAL_STEPS, Math.floor((position!.offset - segment.enter) / REVEAL_STEP_S) + 1))
    : REVEAL_STEPS;
  const dayEnd = reel?.dayEndMs ?? DAY_START_MS;
  const dayOver = reel !== null && p.rt >= reel.total;
  // The day is over: the way on is one touch, or it goes by itself after a few seconds.
  const [wait, setWait] = useState(DAYEND_WAIT_S);
  const goOn = useRef(onReadEvaluations);
  goOn.current = onReadEvaluations;
  useEffect(() => {
    if (!dayOver) { setWait(DAYEND_WAIT_S); return undefined; }
    const tick = window.setInterval(() => setWait((n) => n - 1), 1000);
    return () => window.clearInterval(tick);
  }, [dayOver]);
  useEffect(() => { if (dayOver && wait <= 0) goOn.current(); }, [dayOver, wait]);
  const tint = scene ? (requestColour(reel?.episodes ?? []).get(scene.episode.requestId) ?? night.accent) : night.accent;

  // What the stage says between scenes: the day so far, read off the playhead.
  const subtitleOf = (requestId: string) => detail.scenes?.panels[requestId]?.subtitle ?? null;
  // Who a Task asked for help: the people its panel says MEDial asked, less the
  // person the request is about (calling someone to check on them is not asking
  // them to help). Without this the dashboard's "asked today" was always empty.
  const askedOf = (requestId: string) => {
    const subject = reel?.episodes.find((e) => e.requestId === requestId)?.subjectId ?? null;
    return (detail.scenes?.panels[requestId]?.judgment.asked ?? []).map((a) => a.actorId).filter((id) => id !== subject);
  };
  const ledger = useMemo(
    () => ledgerAt(reel?.episodes ?? [], atMs, subtitleOf, askedOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reel, atMs, detail.scenes],
  );
  // What MEDial held about a request: its stored panel's facts, and what the
  // record says it did not and could not know (unknown stays unknown).
  const holdsOf = (requestId: string) => {
    const j = detail.scenes?.panels[requestId]?.judgment;
    if (!j) return null;
    const unknown = (j.knows ?? []).filter((k) => /모른다|알 수 없|불명/.test(k));
    return { knows: (j.knows ?? []).filter((k) => !unknown.includes(k)), unknown };
  };
  const routine = useMemo(
    () => routineAt(poses, (place, id) => placeLabel(village, place, id)),
    [poses, village],
  );
  // Only what was scheduled is known ahead: the dashboard's "다음은" and the
  // timeline's faint lines both read this set (the record's `scheduled`).
  const scheduled = useMemo(() => new Set(detail.scenes?.scheduled ?? []), [detail.scenes]);
  const next = useMemo(() => {
    const episode = reel?.episodes.find((e) => e.startMs > atMs && scheduled.has(e.requestId)) ?? null;
    return episode ? { startMs: episode.startMs, title: episode.title } : null;
  }, [reel, atMs, scheduled]);
  const timeline = useMemo(
    () => timelineAt(reel?.episodes ?? [], atMs, scheduled, subtitleOf, p.viewMode === 'researcher'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reel, atMs, scheduled, detail.scenes, p.viewMode],
  );

  return (
    <Screen style={mapWidth ? ({ '--map-w': `clamp(200px, ${mapWidth}px, 34%)` } as React.CSSProperties) : undefined}>
      <MapColumn>
        {/* The column's head: which day, the way back, the village's name and the
            requests chosen so far. The name used to be a badge on the map's corner,
            where it covered the people who live in the village's north end. */}
        <MapStrip>
          <div>
            <b>MEDial</b>
            {strip && <em>{strip.day}</em>}
          </div>
          {strip?.chosen && strip.chosen.length > 0 && (
            <ol aria-label="내가 고른 수정 요청">
              {strip.chosen.map((label, i) => <li key={label}><span>{i + 1}일차 끝에 고른 수정 요청</span><b>{label}</b></li>)}
            </ol>
          )}
        </MapStrip>
        <MapBody>
        <VillageMap
          village={village}
          poses={poses}
          viewMode={p.viewMode}
          medialKnown={medialKnown}
          seatsPerVehicle={detail.timeline?.reservations?.seatsPerVehicle ?? detail.resources.assumedVehicleSeats ?? 0}
          taskColours={colours}
          selectedCluster={p.selectedCluster}
          selectedActor={p.selectedActor}
          onSelectCluster={p.selectCluster}
          spotlight={spotlight}
          onFitWidth={setMapWidth}
        />
        </MapBody>
      </MapColumn>

      <Right>
        <Stage>
          {note && (
            <NoteVeil key={segment!.r0} aria-live="polite">
              <NoteCard><b>{note.when}</b><p>{note.text}</p></NoteCard>
            </NoteVeil>
          )}
          {/* Not mounted behind a scene: an invisible layer would still be read out,
              and would say twice what the judgement panel says once. */}
          <DashLayer $on={!inScene}>
            {!inScene && (dayOver
              ? <DaySummary items={timeline} />
              : (
                <MedialDashboard ledger={ledger} next={next} holdsOf={holdsOf}
                  routine={p.viewMode === 'researcher' ? routine : null} />
              ))}
          </DashLayer>
          <SceneLayer $on={inScene} aria-hidden={!inScene}>
            {scene && judgment && (
              <SceneStage
                beat={scene.beat}
                beatKey={`${scene.e}:${scene.b}`}
                village={village}
                art={art}
                line={line}
                typing={typing}
                seconds={beatSeconds}
                video={video}
                playing={p.playing && segment?.kind === 'line'}
                panel={{ title: scene.episode.title, subtitle: stored?.subtitle ?? null, tint, judgment, lit, changedRules }}
              />
            )}
          </SceneLayer>
        </Stage>

      {dayOver && (
        <DayEnd>
          <div>
            <strong>{formatClock(dayEnd)} · {ending.text}</strong>
            {ending.note && <p>{ending.note.split(' · ').map((fact) => <span key={fact}>{fact}</span>)}</p>}
          </div>
          <small aria-live="off">{Math.max(wait, 0)}초 뒤 자동으로 넘어갑니다</small>
          <button type="button" onClick={onReadEvaluations}>{ending.action} →</button>
        </DayEnd>
      )}

      </Right>

      <DayTimeline
        items={timeline}
        atMs={atMs}
        dayStartMs={DAY_START_MS}
        dayEndMs={dayEnd}
        playing={p.playing}
        onTogglePlay={() => void (p.playing ? p.pause() : p.play())}
        onSeek={(ms) => p.seekTime(ms)}
        onCommit={() => void p.commit()}
        onSkip={() => void skip()}
        canSkip={!!reel && p.rt < reel.total - 0.01}
      />
    </Screen>
  );
}
