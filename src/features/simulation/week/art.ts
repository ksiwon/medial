import type { Frame, Pose } from './types';

// Which picture a place and a person get.
//
// The pictures are drawn by scripts/art.mjs and served from the git-ignored local-data/art/ (GET /village/art).
// Their names follow that script:
//   backdrops   HOME · SHOP · FARM · FOOD · HALL · PATROL · PORT · SEA · TOWN · CAR · CLINIC
//   people      <id>.<pose>, or <id>.work.<place> for someone busy where they are
// A frame names its backdrop itself (it is the place the scene was written for), so nothing here has to work out
// where a person is. Anything without a picture - a person or pose nobody drew, a place with no backdrop - is drawn
// as the schematic figure / a plain frame. Missing art is never a reason to show someone else.

/** The picture id of an actor. The health-centre head is drawn as the clinic's one member. */
const ART_ID: Record<string, string> = { HC_HEAD: 'CLINIC' };
export const artIdOf = (actorId: string): string => ART_ID[actorId] ?? actorId;

/** A frame's backdrop, or null for a plain frame. */
export const backdropOf = (frame: Frame, art: ReadonlySet<string>): string | null => (art.has(frame.place) ? frame.place : null);

/** How a figure is stood in the frame; decided by the pose, not by the picture. */
export type Fit = 'tall' | 'work' | 'seat' | 'wide';
export const FIT: Record<Pose, Fit> = {
  stand: 'tall', phone: 'tall', desk: 'tall', work: 'work', lying: 'wide', fallen: 'wide', resting: 'wide', cpr: 'wide',
};

/**
 * The picture for one person in one frame, or null for the schematic figure.
 * A pose nobody drew falls back to the nearest drawn one that does not change what the scene says: a standing
 * person may be drawn on the phone and the reverse, never lying or at a desk.
 */
export function figureOf(actorId: string, pose: Pose, frame: Frame, art: ReadonlySet<string>): string | null {
  const id = artIdOf(actorId);
  const wanted =
    pose === 'work' ? [`${id}.work.${frame.place}`, `${id}.stand`, `${id}.phone`]
      : pose === 'stand' ? [`${id}.stand`, `${id}.phone`]
        : pose === 'phone' ? [`${id}.phone`, `${id}.stand`]
          : pose === 'cpr' ? [`${id}.cpr+P8.lying`]
            : pose === 'fallen' ? [`${id}.fallen`, `${id}.lying`]
              : [`${id}.${pose}`];
  return wanted.find((name) => art.has(name)) ?? null;
}
