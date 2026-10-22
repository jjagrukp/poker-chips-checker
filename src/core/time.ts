// Time primitives. Domain code never reads ambient time; it receives a Clock or a `now`.
export type EpochMs = number;
export type Ms = number;

export interface Clock {
  now(): EpochMs;
}

export const SECOND: Ms = 1_000;
export const MINUTE: Ms = 60 * SECOND;
