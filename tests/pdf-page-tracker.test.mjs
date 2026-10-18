import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../modules/pdf/page-tracker.js';

const { mostVisiblePage } = globalThis.PdfPageTracker;

// Pages of the given heights stacked from y=16 with a 16px gap, like the reader's layout.
function stack(...heights) {
  let top = 16;
  return heights.map((height) => {
    const page = { top, height };
    top += height + 16;
    return page;
  });
}

test('empty document has no current page', () => {
  assert.equal(mostVisiblePage([], 0, 800), -1);
});

test('the page covering most of the viewport is current', () => {
  const pages = stack(1000, 1000, 1000);
  assert.equal(mostVisiblePage(pages, 0, 800), 0);
  // Scrolled 70% into page 1: page 2 now covers more of the viewport.
  assert.equal(mostVisiblePage(pages, 716, 800), 1);
  assert.equal(mostVisiblePage(pages, 2100, 800), 2);
});

test('fully visible short pages tie, so the earlier page wins', () => {
  const pages = stack(200, 200, 200, 200);
  // Jumped to page 2 (index 1): pages 2-4 all fully visible.
  assert.equal(mostVisiblePage(pages, pages[1].top - 16, 800), 1);
});

test('viewport inside a gap or past the end still reports a page', () => {
  const pages = stack(100, 100);
  assert.equal(mostVisiblePage(pages, 117, 10), 1);
  assert.equal(mostVisiblePage(pages, 5000, 800), 1);
});
