import { useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { api } from '../api/client';
import { artIdOf } from '../week/art';
import { inkA, night, px, radius } from './theme';

// A resident's face on a reading page: the head and shoulders of the drawn
// standing figure (the same picture the scene uses), on a warm disc. Someone
// nobody drew gets their number on the same disc - never another person's face.
//
// Someone drawn only seated (the health-centre head at her desk) gets that picture: before 2026-10-18 the list
// stopped at standing and on the phone, and her disc showed the id 'HC_HEAD' cut off by the circle.

const POSES = ['stand', 'phone', 'desk', 'seated'];

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

/** Starts loading every drawn picture (47 small files, ~11 MB, served from this machine),
 *  so neither a reading page's faces nor a scene's backdrop and figures are an empty
 *  frame while a large picture arrives for the first time. */
export function preloadArt(art: ReadonlySet<string>) {
  for (const id of art) {
    const url = api.artUrl(id);
    const image = new Image();
    image.onload = () => loaded.add(url);
    image.src = url;
  }
}

/** The pictures already in the browser: a face that is there is drawn at once, with no frame of the number first. */
const loaded = new Set<string>();

export default function Portrait({ actorId, art, size = 72 }: { actorId: string; art: ReadonlySet<string>; size?: number }) {
  const picture = portraitOf(actorId, art);
  const url = picture ? api.artUrl(picture) : null;
  const [shown, setShown] = useState(() => url !== null && loaded.has(url));
  const img = useRef<HTMLImageElement>(null);
  // A picture the browser already has is complete before it paints; waiting for onload would show the number for a frame.
  useLayoutEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setShown(true);
  }, [url]);
  return (
    <Disc $size={size} role="img" aria-label={actorId}>
      {/* The number stays until the picture is in: never an empty disc. */}
      {(!picture || !shown) && actorId}
      {picture && <img ref={img} src={url ?? undefined} alt="" draggable={false} onLoad={() => { if (url) loaded.add(url); setShown(true); }}
        style={{ opacity: shown ? 1 : 0 }} />}
    </Disc>
  );
}
