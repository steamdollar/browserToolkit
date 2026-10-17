/**
 * Decides page turns from mouse-wheel events in the EPUB reader.
 * A trackpad fling or a fast wheel spin emits a burst of events; events closer than
 * gapMs are treated as one gesture so each gesture turns exactly one page.
 */
(() => {
  'use strict';

  const WHEEL_GESTURE_GAP_MS = 250;

  function create({ gapMs = WHEEL_GESTURE_GAP_MS } = {}) {
    let lastWheelAt = -Infinity;

    // Returns 'next', 'prev', or null (same gesture / no movement).
    return function decide({ deltaX = 0, deltaY = 0 }, nowMs) {
      // Prefer the dominant axis so horizontal trackpad swipes also turn pages.
      const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
      if (delta === 0) return null;
      const startsGesture = nowMs - lastWheelAt > gapMs;
      lastWheelAt = nowMs;
      if (!startsGesture) return null;
      return delta > 0 ? 'next' : 'prev';
    };
  }

  globalThis.EpubWheelPager = Object.freeze({ create, WHEEL_GESTURE_GAP_MS });
})();
