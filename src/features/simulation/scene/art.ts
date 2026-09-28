import type { VillagePayload } from '../api/types';
import type { Frame, Pose } from './types';

// Which picture a frame and a person get.
//
// The pictures are drawn by scripts/art.mjs and served from the git-ignored
// local-data/art/ (GET /village/art). Their names follow that script:
//   backdrops   FARM · HOME · SHOP · FOOD · HALL · PATROL · PORT · SEA · TOWN · CAR · CLINIC
//   people      <id>.<pose>, or <id>.work.<place> for someone busy where they are
// Anything without a picture - a synthetic village, a person or pose nobody drew,
// a place with no backdrop - is drawn as the schematic figure / a plain frame.
// Missing art is never a reason to show someone else.

/** The picture id of an actor. Institutions have one drawn member each. */
const ART_ID: Record<string, string> = { HC_NURSE: 'CLINIC', EMS_CREW: 'MEDIC' };
export const artIdOf = (actorId: string): string => ART_ID[actorId] ?? actorId;

/** A place key's backdrop, or null for a plain frame. */
export function backdropOf(place: string | null, village: VillagePayload): string | null {
  if (!place) return null;
  if (place.startsWith('HOME:')) {
    const owner = village.residents.find((r) => r.id === place.slice(5));
    return owner?.pinnedAtHome ? 'SHOP' : 'HOME';
  }
  if (place.startsWith('CAR:')) return 'CAR';
  if (place === 'ROAD') return 'PATROL';
  if (place === 'INST:HC_NURSE') return 'CLINIC';
  if (place === 'MIGA') return 'SHOP';
  return ['FARM', 'FOOD', 'HALL', 'PATROL', 'PORT', 'SEA', 'TOWN'].includes(place) ? place : null;
}

/** How a figure is stood in the frame; decided by the pose, not by the picture. */
export type Fit = 'tall' | 'work' | 'seat' | 'wide';
export const FIT: Record<Pose, Fit> = {
  stand: 'tall', phone: 'tall', desk: 'tall', work: 'work', drive: 'seat', seated: 'seat', lying: 'wide',
};

/**
 * The picture for one person in one frame, or null for the schematic figure.
 * A pose nobody drew falls back to the nearest drawn one that does not change
 * what the scene says: a standing person may be drawn on the phone and the
 * reverse, never lying or at a desk.
 */
export function figureOf(actorId: string, pose: Pose, frame: Frame, art: ReadonlySet<string>): string | null {
  const id = artIdOf(actorId);
  const place = frame.place?.split(':')[0] ?? '';
  const wanted =
    pose === 'work' ? [`${id}.work.${place}`, `${id}.stand`, `${id}.phone`]
      : pose === 'stand' ? [`${id}.stand`, `${id}.phone`]
        : pose === 'phone' ? [`${id}.phone`, `${id}.stand`]
          : [`${id}.${pose}`];
  return wanted.find((name) => art.has(name)) ?? null;
}
