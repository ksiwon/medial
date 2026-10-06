import { useMemo, useRef } from 'react';
import styled from 'styled-components';
import type { AttemptDetail, DomainEvent, VillagePayload } from '../api/types';
import DayLedger from '../components/DayLedger';
import MedialDashboard from '../components/MedialDashboard';
import VillageMap from '../components/VillageMap';
import { formatClock, medialKnowledge, placeLabel, posesAt } from '../positions';
import { openRequests, requestColour } from '../scene/colours';
import { judgmentOf } from '../scene/judgment';
import { DAY_START_MS, usePlayback } from '../scene/playback';
import { PACES, REVEAL_STEP_S, REVEAL_STEPS } from '../scene/reel';
import SceneStage from '../scene/SceneStage';
import type { Beat, Episode } from '../scene/types';
import { ledgerAt, routineAt } from '../selectors/dayLedger';
import { dayChangeLines, dayLabel } from '../selectors/words';
import { IconButton, Select, Sub } from '../ui/primitives';
import { colour, font, radius } from '../ui/theme';

// 사례와 서비스 경험 - watching one run.
//
// Two columns (2026-10-06). The village map stands upright on the left and never
// moves or shrinks: it is the one thing that is always there. On the right, from
// top to bottom: the stage, the day's ledger, and the playback bar.
//
// The stage is a request's scene when it has one - a frame per place, the people
// there, their words as bubbles, and MEDial, which has no body, as its judgement
// panel - and MEDial's dashboard when it does not, so it is never empty. The
// ledger is one line per request up to the playhead.
//
// This replaced the one-stage arrangement (a map that filled the stage and shrank
// into a card for each scene) and, before it, three columns. Their panels are
// gone rather than hidden.

const Screen = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 26%) minmax(0, 1fr);
  gap: 12px;
  padding: 12px;

  /* A narrow window cannot hold the village beside a filmed scene. The map goes
     above, shorter, and the right column keeps the whole width. */
  @media (max-width: 1000px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 36%) minmax(0, 1fr);
    overflow-y: auto;
  }
`;

const MapColumn = styled.div`
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.panel};
`;

/** What the header used to say, now a strip on top of the map column: which day
 *  this is, the way back to the start, and that every person here is invented. */
const MapStrip = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid ${colour.border};
  font-size: ${font.small};
  color: ${colour.secondary};
  > b { font-size: ${font.body}; font-weight: 800; color: ${colour.text}; letter-spacing: -0.02em; }
  > em { font-style: normal; font-weight: 800; color: ${colour.surface}; background: ${colour.text};
         border-radius: 999px; padding: 2px 9px; }
  > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  > button { font: inherit; cursor: pointer; border: none; background: transparent; color: ${colour.secondary};
             padding: 2px 4px; border-radius: ${radius.control}; }
  > button:hover { color: ${colour.primary}; }
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
  gap: 10px;
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

const Transport = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.panel};
`;

const Clock = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: ${font.section};
  font-weight: 700;
  min-width: 58px;
`;

/** The day's track: a bar per scene, coloured by its request, over the clock. */
const Track = styled.div`
  flex: 1;
  min-width: 120px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  > input { width: 100%; margin: 0; accent-color: ${colour.primary}; }
`;

const Bars = styled.div`
  position: relative;
  height: 8px;
  > i { position: absolute; top: 0; height: 6px; border-radius: 999px; opacity: 0.85; }
`;

const Ticks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: ${font.micro};
  color: ${colour.unknown};
  font-variant-numeric: tabular-nums;
  > span:last-child { color: ${colour.primary}; }
`;

const Paces = styled.div`
  display: flex;
  gap: 4px;
  flex: none;
`;

const Pace = styled.button<{ $on: boolean }>`
  font: inherit;
  font-size: ${font.small};
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? colour.text : colour.border)};
  background: ${(p) => (p.$on ? colour.text : 'transparent')};
  color: ${(p) => (p.$on ? '#ffffff' : colour.secondary)};
`;

/** Everything secondary to watching - the MEDial-only view, scene by scene, a
 *  new case - behind one gear. */
const Settings = styled.details`
  position: relative;
  flex: none;
  > summary {
    cursor: pointer;
    list-style: none;
    color: ${colour.secondary};
    font-size: 16px;
    padding: 6px;
    border-radius: ${radius.control};
  }
  > summary::-webkit-details-marker { display: none; }
  > summary:focus-visible { outline: 2px solid ${colour.primary}; }
  > div {
    position: absolute;
    right: 0;
    bottom: 36px;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: ${colour.surface};
    border: 1px solid ${colour.border};
    border-radius: ${radius.control};
    padding: 12px;
    box-shadow: 0 4px 14px rgba(29, 41, 53, 0.14);
    z-index: 8;
    font-size: ${font.small};
  }
`;

const DayEnd = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  border-radius: ${radius.panel};
  background: ${colour.selected};
  font-size: ${font.small};
  color: ${colour.primary};
`;

interface Props {
  village: VillagePayload;
  detail: AttemptDetail;
  events: DomainEvent[];
  art: ReadonlySet<string>;
  /** Leave this run for another: set a new case up (real), or pick another
   *  recording (sim). The run stays stored either way. */
  caseAction?: { label: string; onClick: () => void };
  /** What the strip says at 22:00, and its button; `note` is a line of facts. */
  dayEnd: { text: string; action: string; note?: string | null };
  /** The day is over: the evaluations are the next thing to read. */
  onReadEvaluations: () => void;
  /** Which day this is and the way back, for a record that is walked day by day. */
  strip?: { day: string; note: string; onRestart: () => void };
}

export default function ObserveScreen({ village, detail, events, art, caseAction, dayEnd: ending, onReadEvaluations, strip }: Props) {
  const p = usePlayback();
  const reel = p.reel;
  const position = p.position;

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
  // The last scene stays mounted while it fades out into the map.
  const last = useRef<{ episode: Episode; beat: Beat; e: number; b: number } | null>(null);
  if (reel && segment && segment.kind !== 'map') {
    const episode = reel.episodes[segment.episode];
    last.current = { episode, beat: episode.beats[segment.beat], e: segment.episode, b: segment.beat };
  }
  const scene = last.current;

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
    ? Math.max(0, Math.min(REVEAL_STEPS, Math.floor((position!.offset - segment.enter) / (REVEAL_STEP_S * p.pace)) + 1))
    : REVEAL_STEPS;
  const dayEnd = reel?.dayEndMs ?? DAY_START_MS;
  const dayOver = reel !== null && p.rt >= reel.total;
  const tint = scene ? (requestColour(reel?.episodes ?? []).get(scene.episode.requestId) ?? colour.primary) : colour.primary;

  // What the stage says between scenes: the day so far, read off the playhead.
  const subtitleOf = (requestId: string) => detail.scenes?.panels[requestId]?.subtitle ?? null;
  const ledger = useMemo(
    () => ledgerAt(reel?.episodes ?? [], atMs, subtitleOf),
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
  const next = useMemo(() => {
    const episode = reel?.episodes.find((e) => e.startMs > atMs) ?? null;
    return episode ? { startMs: episode.startMs, title: episode.title } : null;
  }, [reel, atMs]);

  return (
    <Screen>
      <MapColumn>
        {strip && (
          <MapStrip>
            <b>MEDial</b>
            <em>{strip.day}</em>
            <span title={strip.note}>{strip.note}</span>
            <button type="button" onClick={strip.onRestart}>↺ 처음부터</button>
          </MapStrip>
        )}
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
          title={village.isSynthetic ? '합성 마을' : '은점마을'}
          onSelectCluster={p.selectCluster}
        />
        </MapBody>
      </MapColumn>

      <Right>
        <Stage>
          {/* Not mounted behind a scene: an invisible layer would still be read out,
              and would say twice what the judgement panel says once. */}
          <DashLayer $on={!inScene}>
            {!inScene && (
              <MedialDashboard ledger={ledger} atMs={atMs} next={next} holdsOf={holdsOf} routine={routine} />
            )}
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
                panel={{ title: scene.episode.title, subtitle: stored?.subtitle ?? null, tint, judgment, lit }}
              />
            )}
          </SceneLayer>
        </Stage>

        <DayLedger rows={ledger.rows} episodes={reel?.episodes ?? []}
          onSeek={(ms) => { p.seekTime(ms); void p.commit(); }} />

      {dayOver && (
        <DayEnd>
          <span>
            <strong>{formatClock(dayEnd)} · {ending.text}</strong>
            {ending.note && <span style={{ marginLeft: 12, color: colour.secondary }}>{ending.note}</span>}
          </span>
          <IconButton onClick={onReadEvaluations}>{ending.action}</IconButton>
        </DayEnd>
      )}

      <Transport>
        {/* This plays back a stored log. Stopping it stops nothing on the
            server, whose own controls live in the progress strip. */}
        <IconButton onClick={() => void (p.playing ? p.pause() : p.play())}>
          {p.playing ? '⏸ 정지' : '▶ 재생'}
        </IconButton>
        <Clock>{formatClock(atMs)}</Clock>
        <Track>
          <Bars aria-hidden>
            {(reel?.episodes ?? []).map((episode, i) => (
              <i key={i} style={{
                left: `${((episode.startMs - DAY_START_MS) / (dayEnd - DAY_START_MS)) * 100}%`,
                width: `max(4px, ${((episode.endMs - episode.startMs) / (dayEnd - DAY_START_MS)) * 100}%)`,
                background: requestColour(reel!.episodes).get(episode.requestId),
              }} />
            ))}
          </Bars>
          <input
            type="range"
            min={DAY_START_MS}
            max={dayEnd}
            step={60_000}
            value={Math.min(Math.max(atMs, DAY_START_MS), dayEnd)}
            onChange={(e) => p.seekTime(Number(e.target.value))}
            onPointerUp={() => void p.commit()}
            onKeyUp={() => void p.commit()}
            aria-label="시각"
          />
          <Ticks aria-hidden>
            <span>05:00</span>
            <span>12:00</span>
            <span>17:00</span>
            <span>{formatClock(dayEnd)} 주민 평가</span>
          </Ticks>
        </Track>
        <Paces role="group" aria-label="대사 속도">
          {PACES.map((option) => (
            <Pace key={option.value} $on={p.pace === option.value} aria-pressed={p.pace === option.value}
              onClick={() => p.setPace(option.value)}>
              {option.label}
            </Pace>
          ))}
        </Paces>
        <Settings>
          <summary aria-label="재생 설정" title="재생 설정">⚙</summary>
          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              보기
              <Select aria-label="관찰 시점" value={p.viewMode}
                onChange={(e) => p.setViewMode(e.target.value as typeof p.viewMode)}>
                <option value="researcher">연구자 전체</option>
                <option value="medial">MEDial이 아는 것</option>
              </Select>
            </label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <IconButton onClick={() => void p.jumpScene(-1)}>← 앞 장면</IconButton>
              <IconButton onClick={() => void p.jumpScene(1)}>다음 장면 →</IconButton>
              <IconButton onClick={() => void p.restart()}>처음으로</IconButton>
            </div>
            <Sub as="span">
              장면 {reel?.episodes.length ?? 0}개 · {village.isSynthetic ? '합성 지도' : '원자료 지형'}
            </Sub>
            {/* Which day this run happened on: as recorded, or nudged. The
                edits themselves are in the tooltip, one per person. */}
            {detail.metrics.dayRealization && (
              <Sub as="span" title={dayChangeLines(detail.metrics.dayRealization).join('\n') || '기록된 일과를 그대로 썼습니다.'}>
                {dayLabel(detail.metrics.dayRealization)}
              </Sub>
            )}
            {caseAction && <IconButton onClick={caseAction.onClick}>{caseAction.label}</IconButton>}
          </div>
        </Settings>
      </Transport>
      </Right>
    </Screen>
  );
}
