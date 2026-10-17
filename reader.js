/* global ePub */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    input: $('file-input'),
    choose: $('choose-file'),
    openFirst: $('open-first-book'),
    viewer: $('viewer'),
    empty: $('empty-state'),
    error: $('error'),
    title: $('book-title'),
    prev: $('prev-page'),
    next: $('next-page'),
    status: $('reading-status'),
    tocButton: $('toc-button'),
    tocPanel: $('toc-panel'),
    tocList: $('toc-list'),
    closeToc: $('close-toc'),
    smaller: $('decrease-font'),
    larger: $('increase-font'),
    fontValue: $('font-value'),
    themeButton: $('theme-button')
  };

  const PREFS_KEY = 'epubReaderPrefs';
  const POSITION_PREFIX = 'epubReaderPosition:';
  let book = null;
  let rendition = null;
  let currentKey = null;
  let opening = false;
  let fontSize = 100;
  let darkMode = false;

  function showError(message) {
    ui.error.textContent = message;
    ui.error.hidden = false;
  }

  function clearError() {
    ui.error.hidden = true;
    ui.error.textContent = '';
  }

  function toggleToc(open) {
    const visible = !!open && !ui.tocButton.disabled;
    ui.tocPanel.hidden = !visible;
    ui.tocButton.setAttribute('aria-expanded', String(visible));
  }

  function setTheme() {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    ui.themeButton.textContent = darkMode ? '라이트 모드' : '다크 모드';
    ui.themeButton.setAttribute('aria-label', ui.themeButton.textContent + ' 켜기');
    if (rendition) {
      rendition.themes.select(darkMode ? 'dark' : 'light');
    }
  }

  function setFont() {
    ui.fontValue.textContent = fontSize + '%';
    if (rendition) rendition.themes.fontSize(fontSize + '%');
  }

  function savePrefs() {
    return chrome.storage.local.set({
      [PREFS_KEY]: { fontSize, darkMode }
    }).catch((error) => console.warn('EPUB 설정 저장 실패:', error));
  }

  function resetBook() {
    toggleToc(false);
    ui.tocList.replaceChildren();
    ui.tocButton.disabled = true;
    ui.prev.disabled = true;
    ui.next.disabled = true;
    if (rendition) {
      try { rendition.destroy(); } catch (error) { console.warn(error); }
      rendition = null;
    }
    if (book) {
      try { book.destroy(); } catch (error) { console.warn(error); }
      book = null;
    }
    ui.viewer.replaceChildren();
    ui.viewer.hidden = true;
    currentKey = null;
  }

  function addTocItems(items, depth = 0) {
    for (const item of items || []) {
      if (item.href) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toc-link';
        button.textContent = item.label || '제목 없음';
        button.style.paddingLeft = (10 + depth * 14) + 'px';
        button.addEventListener('click', () => {
          rendition?.display(item.href).catch(() => showError('해당 목차로 이동할 수 없습니다.'));
          toggleToc(false);
        });
        ui.tocList.appendChild(button);
      }
      if (item.subitems?.length) addTocItems(item.subitems, depth + 1);
    }
  }

  async function openFile(file) {
    if (opening) return;
    if (!file || (!file.name.toLowerCase().endsWith('.epub') && file.type !== 'application/epub+zip')) {
      showError('EPUB(.epub) 파일을 선택해주세요.');
      return;
    }
    if (typeof ePub !== 'function' || typeof JSZip === 'undefined') {
      showError('EPUB 라이브러리가 없습니다. 저장소에서 npm install && npm run build:epub 을 실행한 뒤 확장을 새로고침하세요.');
      return;
    }

    opening = true;
    clearError();
    resetBook();
    ui.status.textContent = 'EPUB을 여는 중…';
    ui.title.textContent = file.name;

    const key = POSITION_PREFIX + JSON.stringify([file.name, file.size, file.lastModified]);
    try {
      const buffer = await file.arrayBuffer();
      book = ePub(buffer);
      await book.ready;
      currentKey = key;
      const metadata = await book.loaded.metadata;
      ui.title.textContent = metadata?.title || file.name;
      document.title = ui.title.textContent + ' · EPUB Reader';

      rendition = book.renderTo(ui.viewer, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'none',
        allowScriptedContent: false
      });
      rendition.themes.register('light', {
        'body': { color: '#202735', background: '#ffffff' },
        'a': { color: '#2464c6' }
      });
      rendition.themes.register('dark', {
        'body': { color: '#e8ecf5 !important', background: '#202735 !important' },
        'a': { color: '#a5c7ff !important' }
      });
      setTheme();
      setFont();

      rendition.on('relocated', (location) => {
        if (currentKey !== key || !location?.start?.cfi) return;
        chrome.storage.local.set({ [key]: location.start.cfi })
          .catch((error) => console.warn('EPUB 위치 저장 실패:', error));
        const page = location.start.displayed?.page;
        const total = location.start.displayed?.total;
        ui.status.textContent = page && total ? `섹션 ${page} / ${total}` : ui.title.textContent;
      });

      ui.empty.hidden = true;
      ui.viewer.hidden = false;
      const saved = await chrome.storage.local.get(key);
      const cfi = saved[key];
      if (typeof cfi === 'string') {
        try { await rendition.display(cfi); }
        catch { await rendition.display(); }
      } else {
        await rendition.display();
      }
      ui.prev.disabled = false;
      ui.next.disabled = false;

      const navigation = await book.loaded.navigation;
      addTocItems(navigation?.toc);
      ui.tocButton.disabled = ui.tocList.childElementCount === 0;
    } catch (error) {
      console.error('EPUB을 열 수 없습니다:', error);
      resetBook();
      ui.empty.hidden = false;
      ui.status.textContent = 'EPUB을 열 수 없습니다.';
      showError('EPUB 파일을 읽지 못했습니다. 손상된 파일이거나 DRM이 적용된 책일 수 있습니다.');
    } finally {
      opening = false;
    }
  }

  async function init() {
    const stored = await chrome.storage.local.get(PREFS_KEY).catch(() => ({}));
    const prefs = stored[PREFS_KEY] || {};
    fontSize = Number.isFinite(prefs.fontSize)
      ? Math.max(70, Math.min(180, prefs.fontSize)) : 100;
    darkMode = prefs.darkMode === true;
    setTheme();
    setFont();

    ui.choose.addEventListener('click', () => ui.input.click());
    ui.openFirst.addEventListener('click', () => ui.input.click());
    ui.input.addEventListener('change', () => {
      const file = ui.input.files?.[0];
      ui.input.value = '';
      if (file) void openFile(file);
    });
    ui.prev.addEventListener('click', () => rendition?.prev().catch(console.error));
    ui.next.addEventListener('click', () => rendition?.next().catch(console.error));
    ui.tocButton.addEventListener('click', () => toggleToc(ui.tocPanel.hidden));
    ui.closeToc.addEventListener('click', () => toggleToc(false));
    ui.smaller.addEventListener('click', () => {
      fontSize = Math.max(70, fontSize - 10);
      setFont();
      void savePrefs();
    });
    ui.larger.addEventListener('click', () => {
      fontSize = Math.min(180, fontSize + 10);
      setFont();
      void savePrefs();
    });
    ui.themeButton.addEventListener('click', () => {
      darkMode = !darkMode;
      setTheme();
      void savePrefs();
    });

    document.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
      if (event.key === 'ArrowLeft' && rendition) {
        event.preventDefault();
        void rendition.prev();
      } else if (event.key === 'ArrowRight' && rendition) {
        event.preventDefault();
        void rendition.next();
      } else if (event.key === 'Escape') {
        toggleToc(false);
      }
    });

    document.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      document.body.classList.add('drop-target');
    });
    document.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget) document.body.classList.remove('drop-target');
    });
    document.addEventListener('drop', (event) => {
      event.preventDefault();
      document.body.classList.remove('drop-target');
      const file = event.dataTransfer?.files?.[0];
      if (file) void openFile(file);
    });

    if (typeof ePub !== 'function' || typeof JSZip === 'undefined') {
      showError('첫 사용 전 npm install && npm run build:epub 을 실행해야 합니다.');
    }
  }

  void init();
})();
