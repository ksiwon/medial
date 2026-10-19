import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { Figure } from '../scene/Figure';
import { useLineVoice } from '../scene/voice';
import { backdropOf, figureOf, FIT, type Fit } from './art';
import { pill } from '../ui/primitives';
import { bubble, deepA, inkA, night, photo, px, radius, shadeA, space, type, whiteA } from '../ui/theme';
import { nameOf } from './selectors';
import type { Frame, Line, Pose, Week, WeekScene } from './types';

// One scene, filmed at eye level: a frame per place, the people standing in it, and their words as bubbles.
//
// The camera, the focus and the bubbles keep the values the observe screen settled on (2026-09-28): a slow push
// from 1.00 to 1.03 over a scene, a new frame opening beside the others in half a second, those not speaking
// softened to blur 2.5 px, and the line before the current one fading upward. What is different is where the
// words come from: not an event log but a line of a written dialogue, so nothing here is filmed that was not said.
//
// A phone call is two frames side by side, one per end. The AI is not a person in the room: it speaks from the
// frame that has its device, and from the middle when no frame does.

/** Where a figure stands, in % of its frame; `head` is how far down its head is. */
const PLACE: Record<Fit, { size: string; bottom: number; head: number; ratio: string }> = {
  tall: { size: 'height:116%', bottom: -24, head: 17, ratio: '2 / 3' },
  work: { size: 'height:94%', bottom: -3, head: 30, ratio: '2 / 3' },
  seat: { size: 'height:76%', bottom: -2, head: 36, ratio: '1 / 1' },
  wide: { size: 'width:72%', bottom: 3, head: 50, ratio: '3 / 2' },
};

/** Spread figures across a frame; a lying person takes the middle. */
function xs(fits: Fit[]): number[] {
  if (fits.length === 1) return [50];
  const wide = fits.indexOf('wide');
  // Someone on the floor next to someone standing: the one on the floor sits well off to the side, not under them.
  if (wide >= 0 && fits.length === 2) return wide === 0 ? [36, 86] : [14, 66];
  return fits.map((_, i) => 12 + (76 * (i + 0.5)) / fits.length);
}

const open = keyframes`from { flex-grow: 0.0001; } to { flex-grow: 1; }`;
const pop = keyframes`from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: none; }`;

const Box = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  background: ${night.ground};
  overflow: hidden;
`;

const Frames = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  gap: ${space.md};
  padding: ${space.md};
`;

const FrameBox = styled.div`
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  border-radius: ${radius.control};
  background: ${photo.frame};
  animation: ${open} 0.5s cubic-bezier(0.65, 0, 0.35, 1);
`;

const Cam = styled.div<{ $pushed: boolean; $seconds: number }>`
  position: absolute;
  inset: 0;
  overflow: hidden;
  transform-origin: 50% 62%;
  transform: scale(${(p) => (p.$pushed ? 1.03 : 1)});
  transition: transform ${(p) => p.$seconds}s linear;
`;

const Backdrop = styled.div<{ $src: string | null }>`
  position: absolute;
  inset: 0;
  background: ${(p) => (p.$src ? `center / cover url(${p.$src})` : photo.empty)};
`;

const Person = styled.div<{ $soft: boolean }>`
  position: absolute;
  transform: translateX(-50%);
  transition: filter 0.35s ease;
  filter: ${(p) => (p.$soft ? 'blur(2.5px) brightness(0.85) ' : '')}drop-shadow(0 16px 12px ${shadeA(0.3)});
  > img, > svg { width: 100%; height: 100%; object-fit: contain; }
`;

/** Where the frame is. Dark and solid enough to read on the brightest backdrop (a sunny field), which the
 *  see-through 0.62 did not. */
const Label = styled.div`
  ${pill('md')}
  position: absolute;
  left: ${px(16)};
  top: ${px(16)};
  z-index: 4;
  font-weight: 800;
  color: ${night.white};
  background: ${deepA(0.84)};
  box-shadow: 0 ${px(4)} ${px(12)} ${shadeA(0.3)};
  > i { font-style: normal; font-weight: 700; opacity: 0.72; margin-left: ${space.xs}; }
`;

const Tag = styled.span`
  ${pill('xs')}
  position: absolute;
  /* Above the time bar (bottom 16 + its height), not on it. */
  bottom: ${px(72)};
  transform: translateX(-50%);
  font-weight: 800;
  color: ${night.deep};
  background: ${whiteA(0.9)};
`;

/** The widest a person's bubble gets: wide enough that a line is two lines at most. */
const BUBBLE_MAX = px(640);

/** Where a face is in the picture of a pose, as fractions of the picture's box (x from the left, y from the top): a bubble's
 *  tail points there. Standing and phone poses have the head at the top; someone on the floor has it at one end. */
const FACE_AT: Record<Pose, { x: number; y: number }> = {
  stand: { x: 0.49, y: 0.1 }, phone: { x: 0.49, y: 0.1 }, desk: { x: 0.49, y: 0.1 }, work: { x: 0.64, y: 0.17 },
  lying: { x: 0.11, y: 0.3 }, fallen: { x: 0.2, y: 0.25 }, resting: { x: 0.26, y: 0.4 }, cpr: { x: 0.3, y: 0.12 },
};

/** The people's bubbles, one column over the whole picture so none overlap: it hangs from a fixed way under the highest
 *  head (v2 set its foot there, which put the line before the current one over a face). Each bubble is set beside its
 *  speaker and leans toward the one being spoken to - across into the next frame of a call - so the two talk to each
 *  other. */
const Talk = styled.div`
  position: absolute;
  left: ${space.md};
  right: ${space.md};
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  pointer-events: none;
  z-index: 3;
`;

/** A line, as v2 drew it: small, the corner on the speaker's side square, the line before the current one faint, nudged
 *  up and a little smaller. Wide enough that it is two lines at most. */
const Said = styled.div<{ $side: 'l' | 'r'; $old: boolean; $low: boolean }>`
  position: relative;
  width: max-content;
  text-wrap: balance;
  background: ${night.white};
  color: ${night.deep};
  border-radius: ${radius.panel};
  ${(p) => (p.$side === 'l' ? 'border-bottom-left-radius: 4px;' : 'border-bottom-right-radius: 4px;')}
  padding: ${space.sm} ${space.md} ${space.md};
  font-size: ${type.body};
  letter-spacing: -0.01em;
  line-height: 1.45;
  font-weight: 600;
  word-break: keep-all;
  box-shadow: ${(p) => (p.$old ? 'none' : `0 8px 24px ${shadeA(0.28)}`)};
  opacity: ${(p) => (p.$old ? 0.4 : 1)};
  transform: ${(p) => (p.$old ? 'translateY(-8px) scale(0.97)' : 'none')};
  transition: opacity 0.35s ease, transform 0.35s ease;
  animation: ${pop} 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  > b { display: block; font-size: ${type.caption}; font-weight: 800; color: ${bubble.label}; margin-bottom: ${space.hair}; }
  /* The end of the bubble is on the speaker: a tail at the corner on the speaker's side, pointing at the face - up at it,
     or down at someone lying on the floor below the bubble. */
  &::after {
    content: '';
    display: ${(p) => (p.$old ? 'none' : 'block')};
    position: absolute;
    ${(p) => (p.$low ? css`bottom: ${px(-12)};` : css`top: ${px(-12)};`)}
    ${(p) => (p.$side === 'l' ? css`left: ${px(8)};` : css`right: ${px(8)};`)}
    border: ${px(8)} solid transparent;
    ${(p) => (p.$low ? css`border-bottom: none; border-top: ${px(12)} solid ${night.white};` : css`border-top: none; border-bottom: ${px(12)} solid ${night.white};`)}
  }
`;

/** The AI's bubbles stand where v2 put them: at the right, low, with the tail running to the judgment panel, which is
 *  where the AI is. */
const AiColumn = styled.div`
  position: absolute;
  right: ${space.lg};
  bottom: 13%;
  width: min(44%, ${px(560)});
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: ${space.sm};
  pointer-events: none;
  z-index: 3;
`;

const AiSaid = styled.div<{ $old: boolean }>`
  position: relative;
  max-width: 100%;
  text-wrap: balance;
  background: ${night.accentWash};
  border: 2px solid ${night.accent};
  color: ${night.deep};
  border-radius: ${radius.panel};
  padding: ${space.sm} ${space.md} ${space.md};
  font-size: ${type.body};
  letter-spacing: -0.01em;
  line-height: 1.45;
  font-weight: 600;
  word-break: keep-all;
  box-shadow: ${(p) => (p.$old ? 'none' : `0 8px 24px ${shadeA(0.28)}`)};
  opacity: ${(p) => (p.$old ? 0.4 : 1)};
  transform: ${(p) => (p.$old ? 'translateY(-8px) scale(0.97)' : 'none')};
  transition: opacity 0.35s ease, transform 0.35s ease;
  animation: ${pop} 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  > b { display: block; font-size: ${type.caption}; font-weight: 800; color: ${night.accent}; margin-bottom: ${space.hair}; }
  /* The tail runs to the judgment panel's edge. */
  &::after {
    content: '';
    display: ${(p) => (p.$old ? 'none' : 'block')};
    position: absolute;
    right: ${px(-12)};
    bottom: ${space.lg};
    border: ${px(8)} solid transparent;
    border-left: ${px(12)} solid ${night.accent};
    border-right: none;
  }
`;

const Bar = styled.div`
  position: absolute;
  left: 50%;
  bottom: ${px(16)};
  transform: translateX(-50%);
  width: min(60%, ${px(720)});
  display: flex;
  align-items: center;
  gap: ${space.md};
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.pill};
  background: ${deepA(0.7)};
  z-index: 5;
  > span { font-size: ${type.body}; font-weight: 800; color: ${night.white}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  > div { flex: 1; height: ${px(4)}; border-radius: ${radius.pill}; background: ${inkA(0.2)}; overflow: hidden; }
  > div > i { display: block; height: 100%; background: ${night.accent}; transition: width 0.35s ease; }
`;

interface Props {
  week: Week;
  scene: WeekScene;
  /** The line on screen (0-based within the scene), or null before the first. */
  line: number | null;
  art: ReadonlySet<string>;
  /** Real seconds the scene is on screen for, for the slow push-in. */
  seconds: number;
  /** "2 / 5": where this scene is in the telling. */
  position: { at: number; of: number };
  /** The recorded voices, by 'speaker|text'. A line without one is read in silence. */
  voices?: Record<string, VoiceClip> | null;
}

export default function SceneView({ week, scene, line, art, seconds, position, voices = null }: Props) {
  const [pushed, setPushed] = useState(false);
  useEffect(() => {
    setPushed(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPushed(true)));
    return () => cancelAnimationFrame(id);
  }, [scene.key]);

  const current: Line | null = line === null ? null : scene.lines[line] ?? null;
  const previous: Line | null = line !== null && line > 0 ? scene.lines[line - 1] : null;
  const speaking = current?.speaker ?? null;
  useLineVoice(voices, speaking, current?.text ?? null);
  // The frame the AI's voice comes out of: the one with its device, else the first.
  const aiFrame = Math.max(0, scene.frames.findIndex((f) => f.device));
  const bubbles = [previous && { line: previous, old: true }, current && { line: current, old: false }].filter(Boolean) as { line: Line; old: boolean }[];
  // Where each person stands across the whole picture (% of its width): the frames are equal, side by side.
  const across = new Map<string, number>();
  scene.frames.forEach((frame, fi) => {
    const ids = Object.keys(frame.who);
    const at = xs(ids.map((id) => FIT[frame.who[id]]));
    ids.forEach((id, i) => across.set(id, ((fi + at[i] / 100) / scene.frames.length) * 100));
  });
  // The AI is where its device is. A speaker turns toward the others in the scene (the middle when there are none);
  // level with them, to the right - where the AI's panel is.
  const aiAt = ((aiFrame + 0.5) / scene.frames.length) * 100;
  const turn = (speaker: string): 'left' | 'right' => {
    const mine = across.get(speaker) ?? 50;
    const others = scene.cast.filter((c) => c !== speaker).map((c) => (c === 'AI' ? aiAt : across.get(c))).filter((v): v is number => v !== undefined);
    const toward = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 50;
    return toward >= mine ? 'right' : 'left';
  };
  const people = bubbles.filter((b) => b.line.speaker !== 'AI');
  // Where each speaker's face really is (measured as drawn, the camera's slow push included): a bubble is set at the face
  // and its tail points at it - up at it, or down at it when it is below the bubble (someone on the floor).
  const talkRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef(new Map<number, HTMLDivElement>());
  const [faces, setFaces] = useState<Record<string, { x: number; low: boolean; drop: number }>>({});
  const speakers = people.map((b) => `${b.line.n}:${b.line.speaker}`).join(',');
  useLayoutEffect(() => {
    const measure = () => {
      const talk = talkRef.current;
      if (!talk) return;
      const area = talk.getBoundingClientRect();
      const next: Record<string, { x: number; low: boolean; drop: number }> = {};
      for (const b of people) {
        const who = talk.parentElement?.querySelector<HTMLElement>(`[data-actor="${b.line.speaker}"]`);
        const bub = bubbleRefs.current.get(b.line.n);
        if (!who || !bub) continue;
        const at = FACE_AT[who.dataset.pose as Pose] ?? FACE_AT.stand;
        const box = who.getBoundingClientRect();
        const faceX = box.left + at.x * box.width;
        const faceY = box.top + at.y * box.height;
        const bottom = bub.getBoundingClientRect().bottom - (Number.parseFloat(bub.style.top) || 0);
        const low = faceY > bottom;
        // Someone below the bubble: the bubble comes down to sit just over the face, its tail pointing at it.
        next[b.line.speaker] = { x: ((faceX - area.left) / area.width) * 100, low, drop: low ? Math.max(0, Math.round(faceY - bottom - 28)) : 0 };
      }
      setFaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    measure();
    const again = window.setInterval(measure, 400);
    return () => window.clearInterval(again);
  }, [scene.key, speakers]); // eslint-disable-line react-hooks/exhaustive-deps
  const talkTop = Math.min(40, ...scene.frames.flatMap((f) => Object.values(f.who).map((pose) => PLACE[FIT[pose]].head))) + 10;

  return (
    <Box aria-label={`${scene.time} ${scene.situation}`}>
      <Frames>
        {scene.frames.map((frame, fi) => {
          const ids = Object.keys(frame.who);
          const fits = ids.map((id) => FIT[frame.who[id]]);
          const at = xs(fits);
          const backdrop = backdropOf(frame, art);
          return (
            <FrameBox key={`${scene.key}:${fi}`}>
              <Cam $pushed={pushed} $seconds={seconds}>
                <Backdrop $src={backdrop ? api.artUrl(backdrop) : null} />
                {ids.map((id, i) => {
                  const fit = fits[i];
                  const place = PLACE[fit];
                  const name = figureOf(id, frame.who[id], frame, art);
                  const soft = speaking !== null && speaking !== 'AI' && speaking !== id;
                  return (
                    <Person key={id} $soft={soft} data-actor={id} data-pose={frame.who[id]}
                      style={{ left: `${at[i]}%`, bottom: `${place.bottom}%`, aspectRatio: place.ratio, ...Object.fromEntries([place.size.split(':')]) }}>
                      <Figure picture={name} actorId={id} fit={fit} />
                    </Person>
                  );
                })}
                {ids.map((id, i) => <Tag key={id} style={{ left: `${at[i]}%` }}>{nameOf(week, id)}</Tag>)}
              </Cam>
              {frame.label && <Label>{frame.label}{frame.device && <i>· {frame.device}</i>}</Label>}
            </FrameBox>
          );
        })}
      </Frames>
      <Talk ref={talkRef} style={{ top: `calc(${space.md} + (100% - ${space.md} * 2) * ${talkTop / 100})` }}>
        {people.map((b) => {
          const at = faces[b.line.speaker]?.x ?? across.get(b.line.speaker) ?? 50;
          const toward = turn(b.line.speaker);
          // Beside the speaker, extending toward the listener: a left margin of its place, or a right one of the rest.
          const drop = faces[b.line.speaker]?.drop ?? 0;
          const style = toward === 'right'
            ? { marginLeft: `${at}%`, maxWidth: `min(${BUBBLE_MAX}, ${100 - at}%)`, top: drop }
            : { marginLeft: 'auto', marginRight: `${100 - at}%`, maxWidth: `min(${BUBBLE_MAX}, ${at}%)`, top: drop };
          return (
            <Said key={`${b.line.n}`} ref={(el) => { if (el) bubbleRefs.current.set(b.line.n, el); else bubbleRefs.current.delete(b.line.n); }} $old={b.old} $low={faces[b.line.speaker]?.low ?? false} $side={toward === 'right' ? 'l' : 'r'} style={style}>
              <b>{nameOf(week, b.line.speaker)}</b>
              {b.line.text}
            </Said>
          );
        })}
      </Talk>
      <AiColumn>
        {bubbles.filter((b) => b.line.speaker === 'AI').map((b) => (
          <AiSaid key={`${b.line.n}`} $old={b.old}>
            <b>{scene.frames[aiFrame]?.device ? `AI · ${scene.frames[aiFrame].device}` : 'AI'}</b>
            {b.line.text}
          </AiSaid>
        ))}
      </AiColumn>
      <Bar>
        <span>{scene.time}</span>
        <div><i style={{ width: `${((line ?? 0) + 1) / scene.lines.length * 100}%` }} /></div>
        <span>{position.at} / {position.of}</span>
      </Bar>
    </Box>
  );
}
