// What the screens read from the local API besides the week (week/types.ts): the one thing a recording says.

/** One spoken line: its recording and how long it runs (seconds). */
export interface VoiceClip {
  file: string;
  seconds: number;
}
