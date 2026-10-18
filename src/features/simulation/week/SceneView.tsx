import { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { Figure } from '../scene/Figure';
import { useLineVoice } from '../scene/voice';
import { backdropOf, figureOf, FIT, type Fit } from './art';
import { pill } from '../ui/primitives';
import { inkA, night, px, radius, shadeA } from '../ui/theme';
import { nameOf } from './selectors';
import type { Frame, Line, Week, WeekScene } from './types';

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
const PLACE: Record<Fit, { size: string; bottom: number; ratio: string }> = {
  tall: { size: 'height:116%', bottom: -24, ratio: '2 / 3' },
  work: { size: 'height:94%', bottom: -3, ratio: '2 / 3' },
  seat: { size: 'height:76%', bottom: -2, ratio: '1 / 1' },
  wide: { size: 'width:80%', bottom: 3, ratio: '3 / 2' },
};

/** Spread figures across a frame; a lying person takes the middle. */
function xs(fits: Fit[]): number[] {
  if (fits.length === 1) return [50];
  const wide = fits.indexOf('wide');
  if (wide >= 0 && fits.length === 2) return wide === 0 ? [40, 84] : [16, 60];
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
  gap: ${px(8)};
  padding: ${px(8)};
`;

const FrameBox = styled.div`
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  border-radius: ${radius.control};
  background: #2a2b28;
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
  background: ${(p) => (p.$src ? `center / cover url(${p.$src})` : '#34352f')};
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
  color: #fff;
  background: rgba(21, 21, 15, 0.84);
  box-shadow: 0 ${px(4)} ${px(12)} ${shadeA(0.3)};
  > i { font-style: normal; font-weight: 700; opacity: 0.72; margin-left: ${px(4)}; }
`;

const Tag = styled.span`
  ${pill('xs')}
  position: absolute;
  /* Above the time bar (bottom 16 + its height), not on it. */
  bottom: ${px(72)};
  transform: translateX(-50%);
  font-weight: 800;
  color: ${night.deep};
  background: rgba(255, 255, 255, 0.9);
`;

/** A frame's bubbles, one column so they never overlap. A person's are at the top, over their own side; the AI's -
 *  it has no body - at the foot, above the time bar, where they cover floor rather than a face (2026-10-18: centred at
 *  the top they lay over the head of whoever stood in the middle). */
const Column = styled.div<{ $at: 'top' | 'foot' }>`
  position: absolute;
  left: ${px(16)};
  right: ${px(16)};
  ${(p) => (p.$at === 'top' ? css`top: ${px(72)};` : css`bottom: ${px(112)};`)}
  display: flex;
  flex-direction: column;
  gap: ${px(8)};
  pointer-events: none;
  z-index: 3;
`;

/** A line, over the one who says it: the bubble leans to the speaker's side of the frame and its tail points down
 *  at them (the AI's, which has no one to point at, at its device's side). The line before stays above it, solid
 *  enough to read on a bright backdrop - it used to fade to 0.55 and vanish into the sky. */
const Bubble = styled.div<{ $ai: boolean; $old: boolean; $side: 'l' | 'r'; $tail: boolean; $align: 'flex-start' | 'center' | 'flex-end' }>`
  position: relative;
  max-width: min(78%, ${px(560)});
  align-self: ${(p) => p.$align};
  background: ${(p) => (p.$old ? '#e9e5dd' : p.$ai ? '#fff6f2' : '#ffffff')};
  border: ${(p) => (p.$ai ? `2px solid ${night.accent}` : 'none')};
  color: ${night.deep};
  border-radius: ${radius.panel};
  ${(p) => (p.$side === 'l' ? 'border-bottom-left-radius: 4px;' : 'border-bottom-right-radius: 4px;')}
  padding: ${px(8)} ${px(16)} ${px(12)};
  font-size: ${px(24)};
  letter-spacing: -0.02em;
  line-height: 1.45;
  font-weight: 600;
  word-break: keep-all;
  box-shadow: 0 8px 24px ${shadeA(0.28)};
  opacity: ${(p) => (p.$old ? 0.86 : 1)};
  transform: ${(p) => (p.$old ? 'scale(0.94)' : 'none')};
  transform-origin: ${(p) => (p.$side === 'l' ? 'left bottom' : 'right bottom')};
  ${(p) => p.$old && css`font-size: ${px(20)}; box-shadow: none;`}
  transition: opacity 0.35s ease, transform 0.35s ease;
  animation: ${pop} 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  > b { display: block; font-size: ${px(12)}; font-weight: 800; color: ${(p) => (p.$ai ? night.accent : '#6b675f')}; margin-bottom: ${px(2)}; }
  &::after {
    content: '';
    display: ${(p) => (p.$old || !p.$tail ? 'none' : 'block')};
    position: absolute;
    bottom: ${px(-8)};
    ${(p) => (p.$side === 'l' ? css`left: ${px(24)};` : css`right: ${px(24)};`)}
    border: ${px(8)} solid transparent;
    border-bottom: 0;
    border-top-color: ${(p) => (p.$ai ? night.accent : '#ffffff')};
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
  gap: ${px(12)};
  padding: ${px(8)} ${px(16)};
  border-radius: ${radius.pill};
  background: rgba(21, 21, 15, 0.7);
  z-index: 5;
  > span { font-size: ${px(16)}; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; }
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
  /** Which frame a speaker is in. The AI has no body: it speaks from its device. */
  const frameOf = (speaker: string): number => {
    if (speaker === 'AI') return aiFrame;
    const i = scene.frames.findIndex((f) => speaker in f.who);
    return i >= 0 ? i : 0;
  };
  const bubbles = [previous && { line: previous, old: true }, current && { line: current, old: false }].filter(Boolean) as { line: Line; old: boolean }[];

  return (
    <Box aria-label={`${scene.time} ${scene.situation}`}>
      <Frames>
        {scene.frames.map((frame, fi) => {
          const ids = Object.keys(frame.who);
          const fits = ids.map((id) => FIT[frame.who[id]]);
          const at = xs(fits);
          const backdrop = backdropOf(frame, art);
          const here = bubbles.filter((b) => frameOf(b.line.speaker) === fi);
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
                    <Person key={id} $soft={soft}
                      style={{ left: `${at[i]}%`, bottom: `${place.bottom}%`, aspectRatio: place.ratio, ...Object.fromEntries([place.size.split(':')]) }}>
                      <Figure picture={name} actorId={id} fit={fit} />
                    </Person>
                  );
                })}
                {ids.map((id, i) => <Tag key={id} style={{ left: `${at[i]}%` }}>{nameOf(week, id)}</Tag>)}
              </Cam>
              {frame.label && <Label>{frame.label}{frame.device && <i>· {frame.device}</i>}</Label>}
              {(['top', 'foot'] as const).map((spot) => (
                <Column key={spot} $at={spot}>
                  {here.filter((b) => (b.line.speaker === 'AI') === (spot === 'foot')).map((b) => {
                    const ai = b.line.speaker === 'AI';
                    const x = ai ? 50 : (at[ids.indexOf(b.line.speaker)] ?? 50);
                    const side = x <= 55 ? 'l' : 'r';
                    return (
                      <Bubble key={`${b.line.n}`} $ai={ai} $old={b.old} $side={side} $tail={!ai}
                        $align={ai ? 'center' : x < 34 ? 'flex-start' : x > 66 ? 'flex-end' : 'center'}>
                        <b>{ai ? (frame.device ? `AI · ${frame.device}` : 'AI') : nameOf(week, b.line.speaker)}</b>
                        {b.line.text}
                      </Bubble>
                    );
                  })}
                </Column>
              ))}
            </FrameBox>
          );
        })}
      </Frames>
      <Bar>
        <span>{scene.time}</span>
        <div><i style={{ width: `${((line ?? 0) + 1) / scene.lines.length * 100}%` }} /></div>
        <span>{position.at} / {position.of}</span>
      </Bar>
    </Box>
  );
}
