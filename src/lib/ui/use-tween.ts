"use client";

// A number that travels to its new value instead of jumping.
//
// When picking a customer re-answers the whole screen, a figure that simply
// swaps is the one thing that does not read as "this is the same number, for a
// different question" — it reads as a glitch. Counting there makes the change
// legible: you can see 244,000 becoming 196,000 and know it moved because you
// asked it to.
//
// CORRECTNESS BEFORE MOTION. This hook owns what a figure DISPLAYS, so every
// path through it has to end on the truth:
//
//   · the start point is what is actually on screen, read from a ref the
//     animation itself keeps current. An earlier version wrote the effect's
//     captured `value` on cleanup, which could equal the next target and make
//     the following change early-return — leaving the tile showing the
//     PREVIOUS customer's money, permanently.
//   · a failsafe lands the true value a beat late. requestAnimationFrame does
//     not run while a tab is not painting — backgrounded, occluded, a phone
//     with the screen off — and a figure whose only writer is the animation
//     would sit there showing the old answer. Wrong, not merely still.
//   · reduced motion is the same path with no distance to travel.

import { useEffect, useRef, useState } from "react";

const DURATION = 520;

/** Ease-out cubic: fast enough to feel answered, slow enough to be followed. */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useTween(target: number): number {
  const [value, setValue] = useState(target);
  // What is on screen right now. Kept by the animation, never by a closure.
  const currentRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = currentRef.current;
    if (from === target) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 0 : DURATION;

    const put = (next: number) => {
      currentRef.current = next;
      setValue(next);
    };

    const start = performance.now();
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      put(from + (target - from) * ease(t));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(step);

    const failsafe = setTimeout(() => put(target), duration + 90);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      clearTimeout(failsafe);
      // Nothing else: currentRef already holds whatever is on screen, so an
      // interrupted journey simply starts again from where it stopped.
    };
  }, [target]);

  return value;
}
