/**
 * Picks the PDF page the reader is "on" in a continuous vertical scroll.
 * The page covering the most viewport height wins; ties go to the earlier page, so after
 * jumping to page N while several short pages are fully visible, page N is still reported.
 */
(() => {
  'use strict';

  // pages: [{ top, height }] in scroll-content px, sorted by top. Returns a 0-based index, or -1 if empty.
  function mostVisiblePage(pages, viewTop, viewHeight) {
    if (!pages.length) return -1;
    const viewBottom = viewTop + viewHeight;

    // Binary search for the first page whose bottom edge is below the viewport top.
    let low = 0;
    let high = pages.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (pages[mid].top + pages[mid].height <= viewTop) low = mid + 1;
      else high = mid;
    }

    let best = -1;
    let bestVisible = 0;
    for (let index = low; index < pages.length && pages[index].top < viewBottom; index++) {
      const { top, height } = pages[index];
      const visible = Math.min(top + height, viewBottom) - Math.max(top, viewTop);
      if (visible > bestVisible) {
        best = index;
        bestVisible = visible;
      }
    }
    // Viewport shows only the gap between pages (or lies past the end): report the nearest following page.
    return best === -1 ? Math.min(low, pages.length - 1) : best;
  }

  globalThis.PdfPageTracker = Object.freeze({ mostVisiblePage });
})();
