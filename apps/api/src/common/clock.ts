/** Injected wherever "now" matters, so tests can pin the time. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now() {
    return new Date();
  }
}
