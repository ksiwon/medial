import type { RequestFlow } from './requests';

// One colour per request that is still running, so "this task" reads the same
// wherever it appears: the ring on the people doing it, the lines it wrote in
// the event log, and its row in MEDial's panel.
//
// Only a *live* request gets a colour. A request that closed hours ago is
// history; giving it a colour too would put four bright stripes on screen and
// none of them would mean "this is happening now".
//
// The index is the request's place in the day, not its place among the live
// ones, so a colour never moves to another request when an earlier one closes.
const PALETTE = ['#2f7d5b', '#b4671a', '#3667a6', '#8b4a9c', '#a8383f'];

export function taskColours(flows: RequestFlow[]): Map<string, string> {
  const out = new Map<string, string>();
  flows.forEach((flow, i) => {
    if (flow.closed === null) out.set(flow.id, PALETTE[i % PALETTE.length]);
  });
  return out;
}

/** The soft fill that goes with a task colour (its row background). */
export function taskTint(colour: string): string {
  return `${colour}14`;
}
