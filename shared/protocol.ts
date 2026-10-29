// The mod ↔ Worker contract. The mod keeps an identical copy (it cannot import
// outside its folder).
export type RGB = [number, number, number];

export type LaneState = "working" | "done" | "error" | "waiting";

export type ClientEvent =
  | { kind: "state"; terminal: string; state: LaneState }
  | { kind: "color"; terminal: string; color: RGB }
  | { kind: "end"; terminal: string };
