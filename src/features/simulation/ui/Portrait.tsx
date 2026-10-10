import styled from 'styled-components';
import { api } from '../api/client';
import { artIdOf } from '../scene/art';
import { personName } from '../selectors/story';
import { inkA, night, px, radius } from './theme';

// A resident's face on a reading page: the head and shoulders of the drawn
// standing figure (the same picture the scene uses), on a warm disc. Someone
// nobody drew gets their number on the same disc - never another person's face.

const POSES = ['stand', 'phone', 'seated', 'drive'];

function pictureOf(actorId: string, art: ReadonlySet<string>): string | null {
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
  background: radial-gradient(circle at 50% 30%, #f1d9b8, #c98d5a 78%);
  box-shadow: 0 0 0 ${px(4)} ${night.panel}, 0 0 0 ${px(4)} ${inkA(0.2)};
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

export default function Portrait({ actorId, art, size = 72 }: { actorId: string; art: ReadonlySet<string>; size?: number }) {
  const picture = pictureOf(actorId, art);
  return (
    <Disc $size={size} role="img" aria-label={personName(actorId)}>
      {picture ? <img src={api.artUrl(picture)} alt="" draggable={false} /> : actorId}
    </Disc>
  );
}
