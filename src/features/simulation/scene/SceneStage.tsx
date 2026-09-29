import { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import type { VillagePayload } from '../api/types';
import { backdropOf, figureOf, FIT, type Fit } from './art';
import { MEDIAL } from './beats';
import { Figure } from './Figure';
import JudgmentPanel from './JudgmentPanel';
import { nameOf, type Judgment } from './judgment';
import type { Beat, Frame, SceneLine } from './types';
import { api } from '../api/client';

// One beat, filmed at eye level: a frame per place, the people there, and their
// words beside them. The current line is sharp and the one before it fades
// upward; the speaker is in focus and everyone else softens. MEDial's lines come
// from its judgement panel, since MEDial is not a person in the room.
//
// Values (2026-09-28): the camera creeps from 1.00 to 1.03 over the beat, a new
// frame opens beside the others in 0.5 s, focus changes in 0.35 s, and those
// not speaking sit at blur 2.5 px / brightness 85 %.

/** Where a figure stands, in % of its frame; `head` is how far down its head is. */
const PLACE: Record<Fit, { size: string; bottom: number; head: number; ratio: string }> = {
  tall: { size: 'height:116%', bottom: -24, head: 17, ratio: '2 / 3' },
  work: { size: 'height:94%', bottom: -3, head: 30, ratio: '2 / 3' },
  seat: { size: 'height:76%', bottom: -2, head: 36, ratio: '1 / 1' },
  wide: { size: 'width:80%', bottom: 3, head: 50, ratio: '3 / 2' },
};

/** Spread figures across a frame; a lying person takes the middle. */
function xs(fits: Fit[]): number[] {
  if (fits.length === 1) return [50];
  const wide = fits.indexOf('wide');
  if (wide >= 0 && fits.length === 2) return wide === 0 ? [40, 84] : [16, 60];
  return fits.map((_, i) => 12 + (76 * (i + 0.5)) / fits.length);
}

const Box = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 12px;
  background: #1b1c1a;
  overflow: hidden;
  --panel-w: clamp(300px, 26%, 420px);
`;

const Frames = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  right: var(--panel-w);
  display: flex;
  gap: 6px;
  padding: 6px;
`;

const open = keyframes`from { flex-grow: 0.0001; } to { flex-grow: 1; }`;
const pop = keyframes`from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: none; }`;

/* Clips the camera: Cam creeps to scale 1.03, and unclipped it spilled ~15 px of
   the photo under the judgment panel, which has no background of its own - the
   panel's first letters then sat on the bright picture and read as cut off
   ("금 아는 것", seen 2026-09-29). */
const FrameBox = styled.div`
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  border-radius: 8px;
  animation: ${open} 0.5s cubic-bezier(0.65, 0, 0.35, 1);
`;

const Cam = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 8px;
  overflow: hidden;
  transform-origin: 50% 62%;
  background: #2a2b28;
`;

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
`;

const Unknown = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b675f;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
`;

const Person = styled.div<{ $soft: boolean }>`
  position: absolute;
  transform: translateX(-50%);
  transition: filter 0.35s ease;
  filter: ${(p) => (p.$soft ? 'blur(2.5px) brightness(0.85) ' : '')}drop-shadow(0 16px 12px rgba(0, 0, 0, 0.3));
  > img, > svg { width: 100%; height: 100%; object-fit: contain; }
`;

const Label = styled.div`
  position: absolute;
  left: 10px;
  bottom: 10px;
  font-size: 12px;
  font-weight: 800;
  color: #ffffff;
  background: rgba(21, 21, 15, 0.62);
  border-radius: 999px;
  padding: 4px 11px;
  > i { font-style: normal; font-weight: 700; opacity: 0.72; margin-left: 6px; }
`;

const Tag = styled.span`
  position: absolute;
  bottom: 44px;
  transform: translateX(-50%);
  font-size: 11.5px;
  font-weight: 800;
  white-space: nowrap;
  color: #15150f;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 999px;
  padding: 3px 9px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
`;

/** A frame's bubbles, one column so they never overlap; each leans toward its speaker. */
const Column = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  z-index: 3;
`;

const MedColumn = styled(Column)`
  left: auto;
  right: calc(var(--panel-w) + 14px);
  bottom: 13%;
  width: 44%;
  align-items: flex-end;
`;

const Bubble = styled.div<{ $side: 'r' | 'l' | 'med'; $old: boolean; $typing: boolean }>`
  position: relative;
  max-width: ${(p) => (p.$side === 'med' ? '100%' : 'min(46%, 440px)')};
  align-self: ${(p) => (p.$side === 'r' ? 'flex-start' : 'flex-end')};
  background: ${(p) => (p.$side === 'med' ? '#fff6f2' : '#ffffff')};
  border: ${(p) => (p.$side === 'med' ? '1.5px solid #e2542c' : 'none')};
  color: #15150f;
  border-radius: 14px;
  ${(p) => (p.$side === 'r' ? 'border-bottom-left-radius: 4px;' : 'border-bottom-right-radius: 4px;')}
  padding: ${(p) => (p.$typing ? '10px 14px' : '9px 13px 10px')};
  font-size: ${(p) => (p.$typing ? '18px' : '16px')};
  letter-spacing: ${(p) => (p.$typing ? '0.2em' : '-0.01em')};
  line-height: 1.45;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  opacity: ${(p) => (p.$old ? 0.4 : 1)};
  transform: ${(p) => (p.$old ? 'translateY(-6px) scale(0.97)' : 'none')};
  transition: opacity 0.35s ease, transform 0.35s ease;
  animation: ${pop} 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  > b { display: block; font-size: 11px; font-weight: 800; color: ${(p) => (p.$side === 'med' ? '#e2542c' : '#6b675f')}; margin-bottom: 2px; }
`;

/** An act the log recorded without words. A subtitle, never a speech bubble. */
const Caption = styled.div`
  position: absolute;
  left: 6px;
  right: calc(var(--panel-w) + 6px);
  bottom: 74px;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 4;
  > span {
    max-width: 70%;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.45;
    color: #ffffff;
    background: rgba(21, 21, 15, 0.72);
    border-radius: 8px;
    padding: 6px 14px;
    animation: ${pop} 0.28s ease;
  }
`;

interface Props {
  beat: Beat;
  /** Changes whenever the beat does; restarts the camera. */
  beatKey: string;
  village: VillagePayload;
  art: ReadonlySet<string>;
  /** The line on screen, and whether its speaker is still "typing". */
  line: number | null;
  typing: boolean;
  /** Real seconds the beat plays for, for the slow push-in. */
  seconds: number;
  panel: { title: string; tint: string; judgment: Judgment; lit: number };
}

export default function SceneStage({ beat, beatKey, village, art, line, typing, seconds, panel }: Props) {
  const [pushed, setPushed] = useState(false);
  useEffect(() => {
    setPushed(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPushed(true)));
    return () => cancelAnimationFrame(id);
  }, [beatKey]);

  const current = line !== null ? beat.lines[line] : null;
  const previous = line !== null && line > 0 && beat.lines[line - 1].kind === 'say' ? beat.lines[line - 1] : null;
  const speaking = current?.speaker ?? null;
  const sharp = !speaking ? null : speaking === MEDIAL ? new Set(beat.cast) : new Set([speaking]);
  const device = beat.frames.find((f) => f.device);
  const medName = `MEDial${device ? ` · ${device.label} ${device.device}` : ''}`;

  // Which bubbles are up: the current said line (or its typing dots) and the
  // said line just before it.
  const bubbles: { key: string; line: SceneLine; old: boolean; typing: boolean }[] = [];
  if (previous) bubbles.push({ key: `${beatKey}:${line! - 1}`, line: previous, old: true, typing: false });
  if (current?.kind === 'say') {
    bubbles.push({ key: `${beatKey}:${line}${typing ? ':t' : ''}`, line: current, old: false, typing });
  }

  const layout = beat.frames.map((frame) => {
    const fits = frame.who.map((id) => FIT[frame.poses[id] ?? 'stand']);
    const at = xs(fits);
    const many = frame.who.length > 1;
    return frame.who.map((id, i) => ({ id, fit: fits[i], x: at[i], many }));
  });
  const anchor = (id: string) => {
    for (let fi = 0; fi < layout.length; fi += 1) {
      const hit = layout[fi].find((p) => p.id === id);
      if (hit) return { fi, x: hit.x };
    }
    return null;
  };

  const bubbleOf = (b: (typeof bubbles)[number], side: 'r' | 'l' | 'med', x?: number) => (
    <Bubble key={b.key} $side={side} $old={b.old} $typing={b.typing}
      style={x === undefined ? undefined : side === 'r' ? { marginLeft: `${Math.min(50, x + 6)}%` } : { marginRight: `${Math.min(50, 100 - x + 6)}%` }}>
      {b.typing ? '· · ·' : <><b>{b.line.speaker === MEDIAL ? medName : nameOf(b.line.speaker)}</b>{b.line.text}</>}
    </Bubble>
  );

  return (
    <Box>
      <Frames>
        {beat.frames.map((frame, fi) => (
          <FrameView key={frame.key} frame={frame} village={village} art={art} people={layout[fi]}
            sharp={sharp} pushed={pushed} seconds={seconds}>
            <Column style={{ bottom: `${100 - Math.min(40, ...layout[fi].map((p) => PLACE[p.fit].head + (p.many && p.fit === 'tall' ? 6 : 0))) - 22}%` }}>
              {bubbles.filter((b) => b.line.speaker !== MEDIAL && anchor(b.line.speaker)?.fi === fi).map((b) => {
                const x = anchor(b.line.speaker)!.x;
                return bubbleOf(b, x <= 50 ? 'r' : 'l', x);
              })}
            </Column>
          </FrameView>
        ))}
      </Frames>
      <MedColumn>
        {bubbles.filter((b) => b.line.speaker === MEDIAL || !anchor(b.line.speaker)).map((b) => bubbleOf(b, 'med'))}
      </MedColumn>
      {current?.kind === 'caption' && <Caption><span key={`${beatKey}:${line}`}>{current.text}</span></Caption>}
      <JudgmentPanel {...panel} absent={!beat.medial} waiting={beat.waiting} />
    </Box>
  );
}

function FrameView({ frame, village, art, people, sharp, pushed, seconds, children }: {
  frame: Frame;
  village: VillagePayload;
  art: ReadonlySet<string>;
  people: { id: string; fit: Fit; x: number; many: boolean }[];
  sharp: Set<string> | null;
  pushed: boolean;
  seconds: number;
  children: React.ReactNode;
}) {
  const backdrop = backdropOf(frame.place, village);
  const drawn = backdrop && art.has(backdrop) ? backdrop : null;
  const head = (id: string) => village.residents.find((r) => r.id === id)?.isVillageHead ?? false;
  return (
    <FrameBox>
      <Cam style={{ transform: pushed ? 'scale(1.03)' : 'scale(1)', transition: pushed ? `transform ${seconds}s linear` : 'none' }}>
        {drawn ? <Backdrop style={{ backgroundImage: `url(${api.artUrl(drawn)})` }} />
          : <Unknown>{frame.label}</Unknown>}
        {people.map((p) => {
          const place = PLACE[p.fit];
          const size = p.fit === 'tall' && p.many ? 'height:106%' : p.fit === 'wide' && p.many ? 'width:64%' : place.size;
          const [prop, value] = size.split(':');
          return (
            <Person key={p.id} $soft={!!sharp && !sharp.has(p.id)} data-who={p.id}
              style={{ left: `${p.x}%`, bottom: `${place.bottom}%`, [prop]: value, aspectRatio: place.ratio }}>
              <Figure picture={figureOf(p.id, frame.poses[p.id] ?? 'stand', frame, art)} actorId={p.id} fit={p.fit}
                isVillageHead={head(p.id)} />
            </Person>
          );
        })}
      </Cam>
      {people.map((p) => <Tag key={p.id} style={{ left: `${p.x}%` }}>{nameOf(p.id)}</Tag>)}
      <Label>{frame.label}{frame.device && <i>{frame.device}</i>}</Label>
      {children}
    </FrameBox>
  );
}
