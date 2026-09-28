// The observe screen's vocabulary. Everything here is derived from the stored
// event log; nothing is authored. A beat is what the screen zooms into, an
// episode is one uninterrupted stretch of a request, and the reel is the day
// laid out in real seconds for playback.

/** What a person's body is doing in a frame. Chooses the picture, nothing else. */
export type Pose = 'stand' | 'phone' | 'work' | 'desk' | 'drive' | 'seated' | 'lying';

/** One place on screen and who is visible there. */
export interface Frame {
  /** Stable within a beat: two events that show the same frames stay one beat. */
  key: string;
  /** The world's place key (`FARM`, `HOME:P1`, `CAR:P3`, `INST:HC_NURSE`, `ROAD`),
   *  or null when the viewer - in MEDial's view - does not know where it is. */
  place: string | null;
  label: string;
  /** Where MEDial's voice comes out in this frame, when it does. */
  device: string | null;
  who: string[];
  poses: Record<string, Pose>;
}

/**
 * One line of the scene. `say` is words the log actually carries (an
 * utterance, MEDial's message, a caller's report); `caption` is the log's own
 * sentence for an act that had no words. The screen draws the first as a
 * speech bubble and the second as a subtitle, so no speech is ever invented.
 */
export interface SceneLine {
  seq: number;
  kind: 'say' | 'caption';
  speaker: string;
  text: string;
}

export interface Beat {
  requestId: string;
  firstSeq: number;
  lastSeq: number;
  startMs: number;
  endMs: number;
  frames: Frame[];
  /** Who speaks or acts in this beat; everyone else in a frame is just there. */
  cast: string[];
  /** False when the beat happens where MEDial is not a party to it. */
  medial: boolean;
  /** What MEDial is waiting on while it is not there. */
  waiting: string | null;
  lines: SceneLine[];
}

/** One uninterrupted stretch of one request. The judgement panel belongs to the
 *  request; `firstOfRequest` says whether this episode introduces it. */
export interface Episode {
  requestId: string;
  subjectId: string | null;
  title: string;
  firstOfRequest: boolean;
  startMs: number;
  endMs: number;
  beats: Beat[];
}

export type Segment =
  | { kind: 'map'; r0: number; dur: number; w0: number; w1: number; cum: number[] }
  | { kind: 'lead'; r0: number; dur: number; episode: number; beat: number; enter: number; reveal: boolean; seq: number; w0: number }
  | { kind: 'line'; r0: number; dur: number; episode: number; beat: number; line: number; seq: number; w0: number; w1: number; typing: number }
  | { kind: 'hold'; r0: number; dur: number; episode: number; beat: number; seq: number; w0: number; w1: number };

export interface Position {
  index: number;
  segment: Segment;
  /** Seconds into the segment. */
  offset: number;
  atMs: number;
  cursorSeq: number;
}
