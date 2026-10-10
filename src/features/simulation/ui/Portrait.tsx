import { useState } from 'react';
import styled from 'styled-components';
import { api } from '../api/client';
import { artIdOf } from '../scene/art';
import { personName } from '../selectors/story';
import { inkA, night, px, radius } from './theme';

// A resident's face on a reading page: the head and shoulders of the drawn
// standing figure (the same picture the scene uses), on a warm disc. Someone
// nobody drew gets their number on the same disc - never another person's face.

const POSES = ['stand', 'phone', 'seated', 'drive'];

export function portraitOf(actorId: string, art: ReadonlySet<string>): string | null {
  const id = artIdOf(actorId);
  const named = POSES.map((pose) => `${id}.${pose}`).find((name) => art.has(name));
  if (named) return named;
  for (const name of art) if (name.startsWith(`${id}.work.`)) return name;
  return null;
}

const Disc = styled.div<{ $size: number }>`
  position: relative;
  flex: none;
  width: ${(p) => px(p.$size)};
  height: ${(p) => px(p.$size)};
  border-radius: ${radius.round};
  overflow: hidden;
  background: #d9a877;
  box-shadow: 0 0 0 ${px(2)} ${inkA(0.3)};
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: ${(p) => px(p.$size * 0.3)};
  color: ${night.deep};
  > img {
    position: absolute;
    left: 50%;
    top: 0;
    width: 150%;
    max-width: none;
    transform: translateX(-50%);
    object-fit: cover;
    object-position: top;
    pointer-events: none;
  }
`;

/** Starts loading the faces of these people, so a reading page that shows them finds
 *  them already there instead of an empty disc while a large picture arrives. */
export function preloadPortraits(actorIds: readonly string[], art: ReadonlySet<string>) {
  for (const id of actorIds) {
    const picture = portraitOf(id, art);
    if (picture) new Image().src = api.artUrl(picture);
  }
}

export default function Portrait({ actorId, art, size = 72 }: { actorId: string; art: ReadonlySet<string>; size?: number }) {
  const picture = portraitOf(actorId, art);
  const [shown, setShown] = useState(false);
  return (
    <Disc $size={size} role="img" aria-label={personName(actorId)}>
      {/* The number stays until the picture is in: never an empty disc. */}
      {(!picture || !shown) && actorId}
      {picture && <img src={api.artUrl(picture)} alt="" draggable={false} onLoad={() => setShown(true)}
        style={{ opacity: shown ? 1 : 0 }} />}
    </Disc>
  );
}
