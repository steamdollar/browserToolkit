import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../modules/epub/wheel-pager.js';

const { create, WHEEL_GESTURE_GAP_MS: GAP } = globalThis.EpubWheelPager;

test('wheel direction maps to page direction', () => {
  assert.equal(create()({ deltaY: 100 }, 0), 'next');
  assert.equal(create()({ deltaY: -100 }, 0), 'prev');
  // Horizontal swipe wins when it is the dominant axis.
  assert.equal(create()({ deltaX: 40, deltaY: 5 }, 0), 'next');
  assert.equal(create()({ deltaX: -40, deltaY: 5 }, 0), 'prev');
});

test('zero delta does not turn a page or start a gesture', () => {
  const decide = create();
  assert.equal(decide({ deltaX: 0, deltaY: 0 }, 0), null);
  assert.equal(decide({ deltaY: 100 }, 10), 'next');
});

test('a burst of events within the gap turns only one page', () => {
  const decide = create();
  const results = [0, 16, 32, 200, 400, 600].map(t => decide({ deltaY: 3 }, t));
  assert.deepEqual(results, ['next', null, null, null, null, null]);
});

test('a pause longer than the gap starts a new gesture', () => {
  const decide = create();
  assert.equal(decide({ deltaY: 100 }, 0), 'next');
  assert.equal(decide({ deltaY: 100 }, GAP), null);
  assert.equal(decide({ deltaY: -100 }, GAP * 2 + 1), 'prev');
});
