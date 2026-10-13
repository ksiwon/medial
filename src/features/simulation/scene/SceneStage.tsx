import { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import type { VillagePayload } from '../api/types';
import { artIdOf, backdropOf, figureOf, FIT, type Fit } from './art';
import { MEDIAL } from './beats';
import { Figure } from './Figure';
import JudgmentPanel from './JudgmentPanel';
import { nameOf, type Judgment } from './judgment';
import type { Beat, Frame, SceneLine } from './types';
import { api } from '../api/client';
import { night, px, radius, shadeA } from '../ui/theme';
import { pill } from '../ui/primitives';

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
  border-radius: ${radius.panel};
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
  gap: 8px;
  padding: 8px;
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
  border-radius: ${radius.control};
  animation: ${open} 0.5s cubic-bezier(0.65, 0, 0.35, 1);
`;

const Cam = styled.div`
  position: absolute;
  inset: 0;
  border-radius: ${radius.control};
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
  font-size: calc(28px * var(--k, 1));
  font-weight: 800;
  letter-spacing: -0.02em;
`;

const Person = styled.div<{ $soft: boolean }>`
  position: absolute;
  transform: translateX(-50%);
  transition: filter 0.35s ease;
  filter: ${(p) => (p.$soft ? 'blur(2px) brightness(0.85) ' : '')}drop-shadow(0 16px 12px ${shadeA(0.3)});
  > img, > svg { width: 100%; height: 100%; object-fit: contain; }
`;

const Label = styled.div`
  ${pill('sm')}
  position: absolute;
  left: 12px;
  bottom: 12px;
  font-weight: 800;
  color: #ffffff;
  background: rgba(21, 21, 15, 0.62);
  > i { font-style: normal; font-weight: 700; opacity: 0.72; margin-left: 8px; }
`;

const Tag = styled.span`
  ${pill('xs')}
  position: absolute;
  bottom: 44px;
  transform: translateX(-50%);
  font-weight: 800;
  color: ${night.deep};
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px ${shadeA(0.18)};
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
  right: calc(var(--panel-w) + 12px);
  bottom: 13%;
  width: 44%;
  align-items: flex-end;
`;

const Bubble = styled.div<{ $side: 'r' | 'l' | 'med'; $old: boolean; $typing: boolean }>`
  position: relative;
  max-width: ${(p) => (p.$side === 'med' ? '100%' : 'min(46%, 440px)')};
  align-self: ${(p) => (p.$side === 'r' ? 'flex-start' : 'flex-end')};
  background: ${(p) => (p.$side === 'med' ? '#fff6f2' : '#ffffff')};
  border: ${(p) => (p.$side === 'med' ? `2px solid ${night.accent}` : 'none')};
  color: ${night.deep};
  border-radius: ${radius.panel};
  ${(p) => (p.$side === 'r' ? 'border-bottom-left-radius: 4px;' : 'border-bottom-right-radius: 4px;')}
  padding: ${(p) => (p.$typing ? '12px 16px' : '8px 12px 12px')};
  font-size: ${(p) => px(p.$typing ? 18 : 16)};
  letter-spacing: ${(p) => (p.$typing ? '0.2em' : '-0.01em')};
  line-height: 1.45;
  font-weight: 600;
  box-shadow: 0 8px 24px ${shadeA(0.28)};
  opacity: ${(p) => (p.$old ? 0.4 : 1)};
  transform: ${(p) => (p.$old ? 'translateY(-8px) scale(0.97)' : 'none')};
  transition: opacity 0.35s ease, transform 0.35s ease;
  animation: ${pop} 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  > b { display: block; font-size: calc(12px * var(--k, 1)); font-weight: 800; color: ${(p) => (p.$side === 'med' ? night.accent : '#6b675f')}; margin-bottom: 2px; }
  /* MEDial speaks from its own column: the tail runs to the judgement panel's edge. */
  ${(p) => p.$side === 'med' && css`
    &::after {
      content: '';
      position: absolute;
      right: -12px;
      bottom: 16px;
      border: 8px solid transparent;
      border-left: 12px solid ${night.accent};
      border-right: none;
    }
  `}
`;

/** An act the log recorded without words. A subtitle, never a speech bubble. */
const Caption = styled.div`
  position: absolute;
  left: 8px;
  right: calc(var(--panel-w) + 8px);
  bottom: 76px;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 4;
  > span {
    max-width: 70%;
    text-align: center;
    font-size: calc(16px * var(--k, 1));
    font-weight: 700;
    line-height: 1.45;
    color: #ffffff;
    background: rgba(21, 21, 15, 0.72);
    border-radius: ${radius.control};
    padding: 8px 16px;
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
  panel: { title: string; subtitle?: string | null; tint: string; judgment: Judgment; lit: number; changedRules?: readonly string[] };
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
    const pair = cprPair(frame, art);
    const who = pair ? frame.who.filter((id) => id !== pair.lying) : frame.who;
    const fits = who.map((id) => (pair && id === pair.doer ? 'wide' : FIT[frame.poses[id] ?? 'stand']));
    const at = xs(fits);
    const many = who.length > 1;
    return who.map((id, i) => ({
      id, fit: fits[i], x: at[i], many,
      ...(pair && id === pair.doer ? { picture: pair.picture, names: [pair.doer, pair.lying] } : {}),
    }));
  });
  const anchor = (id: string) => {
    for (let fi = 0; fi < layout.length; fi += 1) {
      const hit = layout[fi].find((p) => p.id === id || p.names?.includes(id));
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

/**
 * Someone giving chest compressions to a person lying down is one picture: their
 * bodies touch, and two separate layers never lined up (the exhibition's rule,
 * art.mjs). Only when that picture was drawn; otherwise each is drawn alone.
 */
function cprPair(frame: Frame, art: ReadonlySet<string>) {
  const doer = frame.who.find((id) => frame.poses[id] === 'cpr');
  const lying = frame.who.find((id) => frame.poses[id] === 'lying');
  if (!doer || !lying) return null;
  const picture = `${artIdOf(doer)}.cpr+${artIdOf(lying)}.lying`;
  return art.has(picture) ? { doer, lying, picture } : null;
}

function FrameView({ frame, village, art, people, sharp, pushed, seconds, children }: {
  frame: Frame;
  village: VillagePayload;
  art: ReadonlySet<string>;
  people: { id: string; fit: Fit; x: number; many: boolean; picture?: string; names?: string[] }[];
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
            <Person key={p.id} $soft={!!sharp && !(p.names ?? [p.id]).some((id) => sharp.has(id))} data-who={p.id}
              style={{ left: `${p.x}%`, bottom: `${place.bottom}%`, [prop]: value, aspectRatio: place.ratio }}>
              <Figure picture={p.picture ?? figureOf(p.id, frame.poses[p.id] ?? 'stand', frame, art)} actorId={p.id} fit={p.fit}
                isVillageHead={head(p.id)} />
            </Person>
          );
        })}
      </Cam>
      {people.flatMap((p) => (p.names ?? [p.id]).map((id, i, all) => (
        <Tag key={id} style={{ left: `${p.x + (all.length > 1 ? (i - 0.5) * 22 : 0)}%` }}>{nameOf(id)}</Tag>
      )))}
      <Label>{frame.label}{frame.device && <i>{frame.device}</i>}</Label>
      {children}
    </FrameBox>
  );
}
