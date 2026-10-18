/* global PdfPageTracker */
/**
 * Continuous vertical PDF viewer on top of pdf.js (libs/pdfjs, imported on the first PDF).
 * Every page gets a placeholder sized up front so the scrollbar spans the whole document;
 * only pages near the viewport hold a canvas, which bounds memory on long PDFs.
 * A pdf.js text layer (transparent spans over the canvas) makes the text selectable.
 */
(() => {
  'use strict';

  const LIB_URL = chrome.runtime.getURL('libs/pdfjs/');
  const MAX_FIT_WIDTH_PX = 1100;          // 100% zoom = fit width, capped like the EPUB column
  const MAX_CANVAS_PIXELS = 4096 * 4096;  // ~64MB per canvas; caps HiDPI cost at high zoom
  const RENDER_MARGIN = '150% 0px';       // keep canvases within 1.5 viewports above/below

  let pdfjsPromise = null;

  function loadPdfjs() {
    pdfjsPromise ??= import(LIB_URL + 'pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = LIB_URL + 'pdf.worker.min.mjs';
      return pdfjs;
    });
    return pdfjsPromise;
  }

  // pdf.js outline → the reader's TOC shape. Items without a destination (external links) keep only their children.
  function toTocItems(items) {
    return (items || []).map((item) => ({
      label: item.title,
      target: item.dest || null,
      subitems: toTocItems(item.items)
    }));
  }

  function pageSize(proxy) {
    const { width, height } = proxy.getViewport({ scale: 1 });
    return { width, height };
  }

  // Resolves after the document and its first page load; rejects for corrupt or encrypted files.
  async function open({ container, data, zoomPercent = 100, initialPage = 1, onPageChange }) {
    const pdfjs = await loadPdfjs();
    const loadingTask = pdfjs.getDocument({
      data,
      cMapUrl: LIB_URL + 'cmaps/',
      cMapPacked: true,
      iccUrl: LIB_URL + 'iccs/',
      standardFontDataUrl: LIB_URL + 'standard_fonts/',
      wasmUrl: LIB_URL + 'wasm/'
    });
    try {
      const pdf = await loadingTask.promise;
      const firstPage = await pdf.getPage(1);
      const metadata = await pdf.getMetadata().catch(() => null);
      return createView({ pdfjs, container, pdf, loadingTask, firstPage, metadata, zoomPercent, initialPage, onPageChange });
    } catch (error) {
      void loadingTask.destroy();
      throw error;
    }
  }

  function createView({ pdfjs, container, pdf, loadingTask, firstPage, metadata, zoomPercent, initialPage, onPageChange }) {
    const defaultSize = pageSize(firstPage);
    const fragment = document.createDocumentFragment();
    // size stays null until the page loads; until then its placeholder borrows page 1's proportions.
    const pages = Array.from({ length: pdf.numPages }, (_, index) => {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.index = String(index);
      fragment.appendChild(el);
      return {
        index,
        el,
        proxy: index === 0 ? firstPage : null,
        size: index === 0 ? defaultSize : null,
        canvas: null,
        textLayer: null, // { layer, div } once built; kept across zoom levels
        renderedKey: '',
        pendingKey: '',
        renderTask: null,
        ticket: 0
      };
    });
    container.replaceChildren(fragment);

    let zoom = zoomPercent;
    let pageWidth = 0;    // CSS px; every page shares it so mixed page sizes line up
    let paddingTop = 0;
    let rects = [];       // [{ top, height }] per page, re-measured after every size change
    let currentIndex = -1;
    let programmaticTop = null;
    let scrollFrame = 0;
    let destroyed = false;
    const nearPages = new Set();
    const listeners = new AbortController();

    function pageHeight(page) {
      const size = page.size || defaultSize;
      return Math.round(pageWidth * size.height / size.width);
    }

    function applySize(page) {
      page.el.style.width = pageWidth + 'px';
      page.el.style.height = pageHeight(page) + 'px';
      // pdf.js sizes text-layer spans from this variable (CSS px per PDF point), so zoom needs no rebuild.
      page.el.style.setProperty('--total-scale-factor', String(pageWidth / (page.size || defaultSize).width));
    }

    function measure() {
      rects = pages.map(page => ({ top: page.el.offsetTop, height: page.el.offsetHeight }));
    }

    function setCurrent(index) {
      if (index < 0 || index === currentIndex) return;
      currentIndex = index;
      onPageChange?.(index + 1, pages.length);
    }

    function updateCurrentPage() {
      // The scroll event caused by goTo() must not override the page the reader asked for.
      if (programmaticTop !== null && container.scrollTop === programmaticTop) return;
      programmaticTop = null;
      setCurrent(PdfPageTracker.mostVisiblePage(rects, container.scrollTop, container.clientHeight));
    }

    // Size changes move every page below; keep the visible page at the same relative spot.
    function resizePreservingPosition(applyChange) {
      // Until the user scrolls, keep the page goTo() chose; near the end it may not be the most visible one.
      const pinned = programmaticTop !== null && container.scrollTop === programmaticTop;
      const anchorIndex = pinned ? currentIndex
        : PdfPageTracker.mostVisiblePage(rects, container.scrollTop, container.clientHeight);
      const anchor = rects[anchorIndex];
      const fraction = anchor ? (container.scrollTop - anchor.top) / anchor.height : 0;
      const centerX = container.scrollWidth > 0
        ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth : 0.5;
      applyChange();
      measure();
      if (anchor) {
        const moved = rects[anchorIndex];
        container.scrollTop = moved.top + fraction * moved.height;
        if (pinned) programmaticTop = container.scrollTop;
      }
      container.scrollLeft = centerX * container.scrollWidth - container.clientWidth / 2;
    }

    function layout() {
      const style = getComputedStyle(container);
      paddingTop = parseFloat(style.paddingTop) || 0;
      const innerWidth = container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const fitWidth = Math.min(innerWidth, MAX_FIT_WIDTH_PX);
      resizePreservingPosition(() => {
        pageWidth = Math.max(1, Math.round(fitWidth * zoom / 100));
        for (const page of pages) applySize(page);
      });
      for (const page of nearPages) void renderPage(page);
    }

    function cancelRender(page) {
      page.ticket += 1;
      page.renderTask?.cancel();
      page.renderTask = null;
      page.pendingKey = '';
    }

    function releaseCanvas(page) {
      if (!page.canvas) return;
      // Zeroing the size frees the bitmap now instead of at the next GC.
      page.canvas.width = 0;
      page.canvas.height = 0;
      page.canvas.remove();
      page.canvas = null;
      page.renderedKey = '';
    }

    function releaseTextLayer(page) {
      if (!page.textLayer) return;
      page.textLayer.layer.cancel();
      page.textLayer.div.remove();
      page.textLayer = null;
    }

    function releasePage(page) {
      cancelRender(page);
      releaseCanvas(page);
      releaseTextLayer(page);
      page.proxy?.cleanup(); // Drops cached operator lists/fonts of pages scrolled far away.
    }

    async function renderTextLayer(page, viewport) {
      const div = document.createElement('div');
      div.className = 'textLayer';
      const layer = new pdfjs.TextLayer({
        textContentSource: page.proxy.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container: div,
        viewport
      });
      const textLayer = { layer, div };
      page.textLayer = textLayer;
      page.el.appendChild(div);
      try {
        await layer.render();
        // Dragging past the last line selects to the end instead of jumping back (see CSS .selecting).
        const end = document.createElement('div');
        end.className = 'endOfContent';
        div.appendChild(end);
      } catch (error) {
        if (page.textLayer === textLayer && !destroyed) console.warn('PDF ' + (page.index + 1) + '쪽 텍스트 레이어 실패:', error);
      }
    }

    async function renderPage(page) {
      const pixelRatio = window.devicePixelRatio || 1;
      const key = pageWidth + '@' + pixelRatio;
      if (page.renderedKey === key || page.pendingKey === key) return;
      cancelRender(page);
      const ticket = page.ticket;
      page.pendingKey = key;
      try {
        if (!page.proxy) {
          const proxy = await pdf.getPage(page.index + 1);
          if (ticket !== page.ticket) return;
          page.proxy = proxy;
        }
        if (!page.size) {
          // The placeholder used page 1's proportions; correct it now that the real size is known.
          page.size = pageSize(page.proxy);
          if (page.size.width / page.size.height !== defaultSize.width / defaultSize.height) {
            resizePreservingPosition(() => applySize(page));
          }
        }
        const viewport = page.proxy.getViewport({ scale: pageWidth / page.size.width });
        if (!page.textLayer) void renderTextLayer(page, viewport);
        const outputScale = Math.min(pixelRatio, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        page.renderTask = page.proxy.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        await page.renderTask.promise;
        if (ticket !== page.ticket) return;
        // Swap only when the new bitmap is ready: on zoom the old canvas stretches instead of flashing blank.
        releaseCanvas(page);
        page.el.prepend(canvas);
        page.canvas = canvas;
        page.renderedKey = key;
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException' && !destroyed) {
          console.warn('PDF ' + (page.index + 1) + '쪽 렌더링 실패:', error);
        }
      } finally {
        if (ticket === page.ticket) {
          page.renderTask = null;
          page.pendingKey = '';
        }
      }
    }

    function goTo(pageNumber) {
      const index = Math.min(Math.max(Math.trunc(pageNumber) || 1, 1), pages.length) - 1;
      container.scrollTop = rects[index].top - paddingTop;
      programmaticTop = container.scrollTop; // Read back: the browser clamps near the end.
      setCurrent(index);
    }

    function onScroll() {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateCurrentPage();
      });
    }

    // While a drag selection is in progress, stretch endOfContent over the layer (CSS .selecting).
    container.addEventListener('mousedown', (event) => {
      event.target.closest?.('.textLayer')?.classList.add('selecting');
    }, { signal: listeners.signal });
    document.addEventListener('pointerup', () => {
      for (const layer of container.querySelectorAll('.textLayer.selecting')) layer.classList.remove('selecting');
    }, { signal: listeners.signal });

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = pages[Number(entry.target.dataset.index)];
        if (entry.isIntersecting) {
          nearPages.add(page);
          void renderPage(page);
        } else {
          nearPages.delete(page);
          releasePage(page);
        }
      }
    }, { root: container, rootMargin: RENDER_MARGIN });

    // Window resizes, the TOC panel, and browser zoom (devicePixelRatio) all change the fit width.
    let lastWidth = container.clientWidth;
    let lastPixelRatio = window.devicePixelRatio;
    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth !== lastWidth || window.devicePixelRatio !== lastPixelRatio) {
        lastWidth = container.clientWidth;
        lastPixelRatio = window.devicePixelRatio;
        layout();
      }
      updateCurrentPage();
    });

    layout();
    goTo(initialPage);
    for (const page of pages) observer.observe(page.el);
    resizeObserver.observe(container);
    container.addEventListener('scroll', onScroll, { passive: true });

    return {
      title: metadata?.info?.Title?.trim() || null,
      pageCount: pages.length,
      get currentPage() { return currentIndex + 1; },
      goTo,
      next: () => goTo(currentIndex + 2),
      prev: () => goTo(currentIndex),
      setZoom(percent) {
        if (percent === zoom) return;
        zoom = percent;
        layout();
      },
      async getTocItems() {
        return toTocItems(await pdf.getOutline());
      },
      // dest is a named destination or an explicit [pageRef, fit, ...] array from the outline.
      async goToTarget(dest) {
        const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
        const ref = Array.isArray(explicit) ? explicit[0] : null;
        const index = Number.isInteger(ref) ? ref
          : ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) : -1;
        if (destroyed) return;
        if (!(index >= 0)) throw new Error('목차가 가리키는 쪽을 찾을 수 없습니다.');
        goTo(index + 1);
      },
      destroy() {
        destroyed = true;
        observer.disconnect();
        resizeObserver.disconnect();
        container.removeEventListener('scroll', onScroll);
        listeners.abort();
        cancelAnimationFrame(scrollFrame);
        for (const page of pages) {
          cancelRender(page);
          releaseCanvas(page);
          releaseTextLayer(page);
        }
        container.replaceChildren();
        void loadingTask.destroy(); // Terminates the pdf.js worker and frees the document.
      }
    };
  }

  window.PdfViewer = Object.freeze({ open });
})();
