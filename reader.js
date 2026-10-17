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
    themeButton: $('theme-button'),
    libraryButton: $('library-button'),
    libraryPanel: $('library-panel'),
    libraryList: $('library-list'),
    closeLibrary: $('close-library'),
    recentHome: $('recent-home'),
    recentHomeList: $('recent-home-list'),
    libraryCount: $('library-count'),
    clearLibrary: $('clear-library'),
    clearLibraryHome: $('clear-library-home'),
    pageNumber: $('page-number'),
    pageTotal: $('page-total'),
    goPage: $('go-page')
  };

  const PREFS_KEY = 'epubReaderPrefs';
  const POSITION_PREFIX = 'epubReaderPosition:';
  let book = null;
  let rendition = null;
  let currentKey = null;
  let opening = false;
  let fontSize = 100;
  let darkMode = false;
  let currentCfi = null;
  let currentBookId = null;
  let locationsReady = false;
  let activeToken = 0;
  const wheelPager = window.EpubWheelPager.create();

  // Wheel down/right → next page, up/left → previous. Ctrl+wheel stays browser zoom.
  function handleWheel(event) {
    if (!rendition || event.ctrlKey) return;
    event.preventDefault();
    // Parent-page clock: iframe events carry timeStamps from a different time origin.
    const direction = wheelPager(event, performance.now());
    if (direction === 'next') rendition.next().catch(console.error);
    else if (direction === 'prev') rendition.prev().catch(console.error);
  }

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
    if (visible) toggleLibrary(false);
  }

  function toggleLibrary(open) {
    ui.libraryPanel.hidden = !open;
    ui.libraryButton.setAttribute('aria-expanded', String(!!open));
    if (open) {
      ui.tocPanel.hidden = true;
      ui.tocButton.setAttribute('aria-expanded', 'false');
    }
  }

  function showEmptyReader() {
    resetBook();
    clearError();
    ui.empty.hidden = false;
    ui.title.textContent = '책을 선택하세요';
    ui.status.textContent = 'EPUB 파일을 선택하세요.';
    document.title = 'EPUB Reader · Dev Toolkit';
  }

  async function forgetBook(id, title) {
    if (!window.confirm('“' + title + '”을(를) 최근 목록에서 삭제할까요?\n원본 EPUB 파일은 삭제되지 않습니다.')) return;
    try {
      await window.EpubLibrary.remove(id);
      await chrome.storage.local.remove(POSITION_PREFIX + id);
      if (currentBookId === id) showEmptyReader();
      await refreshRecentBooks();
    } catch (error) {
      console.error('최근 책 삭제 실패:', error);
      showError('최근 목록에서 책을 삭제하지 못했습니다.');
    }
  }

  async function clearLibrary() {
    const entries = await window.EpubLibrary.list().catch(() => []);
    if (!entries.length) return;
    if (!window.confirm('최근 책 ' + entries.length + '권을 모두 목록에서 삭제할까요?\n기존 EPUB 복사본과 위치 캐시가 삭제되지만, 원본 파일은 삭제되지 않습니다.')) return;
    try {
      await window.EpubLibrary.clearAll();
      const saved = await chrome.storage.local.get(null);
      const keys = Object.keys(saved).filter(key => key.startsWith(POSITION_PREFIX));
      if (keys.length) await chrome.storage.local.remove(keys);
      showEmptyReader();
      await refreshRecentBooks();
    } catch (error) {
      console.error('최근 책 전체 삭제 실패:', error);
      showError('전체 삭제 중 오류가 발생했습니다.');
    }
  }

  function renderRecentItem(item) {
    const isLegacy = item.kind !== 'handle';
    const row = document.createElement('div');
    row.className = 'library-row';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'library-open';
    open.title = isLegacy ? '원본 EPUB 파일을 다시 선택해 연결' : '원본 EPUB 파일 열기';
    const title = document.createElement('strong');
    title.textContent = item.title || item.name;
    const detail = document.createElement('small');
    detail.textContent = isLegacy
      ? '이전 저장본 · 클릭해 원본 연결'
      : item.name + ' · ' + new Date(item.openedAt).toLocaleDateString('ko-KR');
    if (isLegacy) detail.className = 'legacy';
    open.append(title, detail);
    open.addEventListener('click', () => {
      if (isLegacy) void chooseFile(item.id, item.name);
      else void reopenBook(item.id);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'library-remove';
    remove.textContent = '삭제';
    remove.title = '목록에서 삭제 (원본 파일 유지)';
    remove.setAttribute('aria-label', (item.title || item.name) + ' 최근 목록에서 삭제');
    remove.addEventListener('click', () => void forgetBook(item.id, item.title || item.name));
    row.append(open, remove);
    return row;
  }

  async function refreshRecentBooks() {
    try {
      const entries = await window.EpubLibrary.list();
      ui.libraryList.replaceChildren();
      ui.recentHomeList.replaceChildren();
      ui.recentHome.hidden = entries.length === 0;
      ui.libraryCount.textContent = entries.length + '권';
      ui.clearLibrary.disabled = entries.length === 0;
      ui.clearLibraryHome.disabled = entries.length === 0;
      if (!entries.length) {
        const note = document.createElement('p');
        note.className = 'library-empty';
        note.textContent = '최근에 연 책이 없습니다.';
        ui.libraryList.appendChild(note);
        return;
      }
      for (const entry of entries) {
        ui.libraryList.appendChild(renderRecentItem(entry));
        ui.recentHomeList.appendChild(renderRecentItem(entry));
      }
    } catch (error) {
      console.warn('EPUB 보관함 조회 실패:', error);
      const note = document.createElement('p');
      note.className = 'library-empty';
      note.textContent = '최근 책을 불러올 수 없습니다.';
      ui.libraryList.replaceChildren(note);
    }
  }

  async function reopenBook(id) {
    if (opening) return;
    try {
      const entry = await window.EpubLibrary.get(id);
      if (!entry?.handle) {
        showError('이 책은 이전 저장본입니다. 목록에서 원본 EPUB 파일을 다시 연결해주세요.');
        return;
      }

      // Permissions may not survive browser restarts; ask only for read access.
      let permission = await entry.handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        permission = await entry.handle.requestPermission({ mode: 'read' });
      }
      if (permission !== 'granted') {
        showError('파일 접근 권한이 허용되지 않았습니다. 목록의 책을 다시 선택하거나 원본을 다시 열어주세요.');
        return;
      }
      const file = await entry.handle.getFile();
      await openFile(file, { handle: entry.handle, recordId: id });
    } catch (error) {
      console.error('최근 책 열기 실패:', error);
      showError('원본 EPUB에 접근할 수 없습니다. 파일이 이동·삭제되었거나 권한이 해제되었을 수 있습니다.');
    }
  }

  async function chooseFile(recordId = null, expectedName = null) {
    if (opening) return;
    if (typeof window.showOpenFilePicker !== 'function') {
      if (recordId) {
        showError('이 브라우저는 파일 핸들을 지원하지 않아 이전 책을 연결할 수 없습니다.');
      } else {
        ui.input.click(); // Read once without saving a second copy.
        showError('파일 핸들을 지원하지 않아 이번에만 읽을 수 있습니다.');
      }
      return;
    }
    try {
      // Invoke the picker directly from the click, preserving user activation.
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'EPUB 전자책',
          accept: { 'application/epub+zip': ['.epub'] }
        }]
      });
      if (!handle) return;
      const file = await handle.getFile();
      if (expectedName && file.name !== expectedName) {
        showError('같은 책의 원본 파일을 선택해주세요: ' + expectedName);
        return;
      }
      await openFile(file, { handle, recordId });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('파일 선택 실패:', error);
      showError('파일을 열지 못했습니다. 브라우저의 파일 접근 권한을 확인해주세요.');
    }
  }

  function updatePageStatus() {
    if (!book || !locationsReady || !currentCfi) return;
    const total = book.locations.length();
    if (total <= 0) return;
    let index;
    try {
      index = book.locations.locationFromCfi(currentCfi);
    } catch (error) {
      console.warn('EPUB 현재 위치 변환 실패:', error);
      return;
    }
    if (!Number.isFinite(index) || index < 0) return;
    const page = Math.min(total, index + 1);
    const percent = total > 1 ? Math.round(index / (total - 1) * 100) : 100;
    ui.pageNumber.value = String(page);
    ui.status.textContent = '위치 ' + page + ' / ' + total + ' (약 ' + percent + '%)';
  }

  async function jumpToPage() {
    if (!book || !rendition || !locationsReady) return;
    const total = book.locations.length();
    const page = Number(ui.pageNumber.value);
    if (!Number.isSafeInteger(page) || page < 1 || page > total) {
      showError('1부터 ' + total + '까지의 위치 번호를 입력해주세요.');
      return;
    }
    const cfi = book.locations.cfiFromLocation(page - 1);
    if (typeof cfi !== 'string') {
      showError('해당 위치를 찾지 못했습니다.');
      return;
    }
    try {
      clearError();
      await rendition.display(cfi);
    } catch (error) {
      console.error('페이지 이동 실패:', error);
      showError('지정한 위치로 이동하지 못했습니다.');
    }
  }

  async function prepareLocations(targetBook, id, token) {
    const valid = () => book === targetBook && activeToken === token;
    try {
      const cached = await window.EpubLibrary.get(id).catch(() => null);
      if (!valid()) return;
      if (cached?.locations) {
        try {
          targetBook.locations.load(cached.locations);
        } catch (error) {
          console.warn('캐시된 위치를 복원할 수 없어 재생성합니다:', error);
        }
      }
      if (targetBook.locations.length() === 0) {
        await targetBook.locations.generate(1600);
        if (!valid()) return;
        // Compute once, reuse on subsequent opens. Failure to cache is non-fatal.
        await window.EpubLibrary.saveLocations(id, targetBook.locations.save())
          .catch((error) => console.warn('페이지 인덱스 캐시 실패:', error));
      }
      if (!valid()) return;
      const total = targetBook.locations.length();
      if (!total) {
        ui.status.textContent = '이 책에서는 위치 번호를 생성할 수 없습니다.';
        return;
      }
      locationsReady = true;
      ui.pageNumber.disabled = false;
      ui.goPage.disabled = false;
      ui.pageNumber.max = String(total);
      ui.pageTotal.textContent = '/ ' + total;
      updatePageStatus();
    } catch (error) {
      if (!valid()) return;
      console.error('EPUB 위치 인덱스 생성 실패:', error);
      ui.status.textContent = '위치 계산 실패 · 이전/다음 이동은 이용할 수 있습니다.';
    }
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
    activeToken += 1; // Invalidate pending location generation for the previous book.
    toggleToc(false);
    toggleLibrary(false);
    locationsReady = false;
    currentCfi = null;
    currentBookId = null;
    ui.pageNumber.disabled = true;
    ui.goPage.disabled = true;
    ui.pageNumber.value = '';
    ui.pageNumber.removeAttribute('max');
    ui.pageTotal.textContent = '/ —';
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

  async function openFile(file, { handle = null, recordId = null } = {}) {
    if (opening) return;
    if (!file || (!file.name.toLowerCase().endsWith('.epub') && file.type !== 'application/epub+zip')) {
      showError('EPUB(.epub) 파일을 선택해주세요.');
      return;
    }
    if (typeof ePub !== 'function' || typeof JSZip === 'undefined') {
      showError('EPUB 라이브러리가 없습니다. npm install && npm run build:epub 후 확장 프로그램을 새로고침하세요.');
      return;
    }

    opening = true;
    clearError();
    let id = recordId || window.EpubLibrary.bookId(file);
    let changed = false;
    try {
      if (handle) {
        try {
          // Reopening an edited file via the picker should not create a duplicate.
          const known = recordId ? null : await window.EpubLibrary.findByHandle(handle);
          if (known) id = known.id;
          const existing = await window.EpubLibrary.get(id);
          changed = !!existing && (existing.size !== file.size || existing.lastModified !== file.lastModified);
        } catch (error) {
          // A broken recent-book index must not prevent reading a valid EPUB.
          console.warn('최근 책 메타데이터 조회 실패:', error);
        }
      }

      resetBook();
      const token = activeToken;
      const key = POSITION_PREFIX + id;
      currentBookId = id;
      currentKey = key;
      ui.status.textContent = 'EPUB을 여는 중…';
      ui.title.textContent = file.name;

      const buffer = await file.arrayBuffer();
      book = ePub(buffer);
      await book.ready;
      const metadata = await book.loaded.metadata;
      ui.title.textContent = metadata?.title || file.name;
      document.title = ui.title.textContent + ' · EPUB Reader';

      ui.empty.hidden = true;
      ui.viewer.hidden = false;
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
      // epub.js does not forward wheel events out of its section iframes, so attach per section.
      // passive:false is required: Chrome treats document-level wheel listeners as passive.
      rendition.hooks.content.register((contents) => {
        contents.document.addEventListener('wheel', handleWheel, { passive: false });
      });

      rendition.on('relocated', (location) => {
        if (currentKey !== key || !location?.start?.cfi) return;
        chrome.storage.local.set({ [key]: location.start.cfi })
          .catch((error) => console.warn('EPUB 위치 저장 실패:', error));
        currentCfi = location.start.cfi;
        if (locationsReady) {
          updatePageStatus();
        } else {
          const page = location.start.displayed?.page;
          const total = location.start.displayed?.total;
          ui.status.textContent = page && total
            ? `현재 장 ${page} / ${total} · 전체 위치 계산 중…`
            : '전체 위치 계산 중…';
        }
      });

      // Positions and cached CFI indexes are invalid if the original file changed.
      if (changed) await chrome.storage.local.remove(key).catch(console.warn);
      const saved = changed ? {} : await chrome.storage.local.get(key);
      const cfi = saved[key];
      if (typeof cfi === 'string') {
        try { await rendition.display(cfi); }
        catch { await rendition.display(); }
      } else {
        await rendition.display();
      }
      ui.prev.disabled = false;
      ui.next.disabled = false;

      rendition.on('keyup', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft') void rendition?.prev();
        if (event.key === 'ArrowRight') void rendition?.next();
      });

      try {
        const navigation = await book.loaded.navigation;
        addTocItems(navigation?.toc);
        ui.tocButton.disabled = ui.tocList.childElementCount === 0;
      } catch (error) {
        console.warn('EPUB 목차 로딩 실패:', error);
      }

      const targetBook = book;
      const title = ui.title.textContent;
      void (async () => {
        if (handle) {
          try {
            await window.EpubLibrary.save(handle, file, title, id);
          } catch (error) {
            console.warn('EPUB 파일 핸들 저장 실패:', error);
            if (activeToken === token) showError('책은 열렸지만 원본 참조를 저장하지 못했습니다. 저장 공간이나 권한을 확인해주세요.');
          }
        } else if (activeToken === token) {
          showError('이 파일은 이번 탭에서만 열었습니다. 최근 책에 저장하려면 EPUB 열기 버튼으로 다시 선택해주세요.');
        }
        if (activeToken !== token || targetBook !== book) return;
        await refreshRecentBooks();
        await prepareLocations(targetBook, id, token);
      })().catch(error => console.error('EPUB 도서 후처리 실패:', error));
    } catch (error) {
      console.error('EPUB을 열 수 없습니다:', error);
      showEmptyReader();
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

    ui.choose.addEventListener('click', () => void chooseFile());
    ui.openFirst.addEventListener('click', () => void chooseFile());
    ui.clearLibrary.addEventListener('click', () => void clearLibrary());
    ui.clearLibraryHome.addEventListener('click', () => void clearLibrary());
    ui.input.addEventListener('change', () => {
      const file = ui.input.files?.[0];
      ui.input.value = '';
      if (file) void openFile(file); // Fallback is temporary, never saved as Blob.
    });
    ui.prev.addEventListener('click', () => rendition?.prev().catch(console.error));
    ui.next.addEventListener('click', () => rendition?.next().catch(console.error));
    // Covers the viewer padding outside the book iframe.
    ui.viewer.addEventListener('wheel', handleWheel, { passive: false });
    ui.tocButton.addEventListener('click', () => toggleToc(ui.tocPanel.hidden));
    ui.closeToc.addEventListener('click', () => toggleToc(false));
    ui.libraryButton.addEventListener('click', () => toggleLibrary(ui.libraryPanel.hidden));
    ui.closeLibrary.addEventListener('click', () => toggleLibrary(false));
    ui.goPage.addEventListener('click', () => void jumpToPage());
    ui.pageNumber.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void jumpToPage();
      }
    });
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
        toggleLibrary(false);
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
      const item = Array.from(event.dataTransfer?.items || []).find(candidate => candidate.kind === 'file');
      // Must invoke getAsFileSystemHandle synchronously within the drop event.
      let handlePromise;
      try { handlePromise = item?.getAsFileSystemHandle?.(); }
      catch (error) { console.warn('드래그 핸들 취득 실패:', error); }
      if (handlePromise) {
        void Promise.resolve(handlePromise)
          .then(async handle => {
            if (handle?.kind === 'file') {
              await openFile(await handle.getFile(), { handle });
            } else if (file) {
              await openFile(file);
            }
          }).catch(error => {
            console.error('EPUB 드롭 실패:', error);
            showError('파일을 읽지 못했습니다. EPUB 열기 버튼으로 다시 선택해주세요.');
          });
      } else if (file) {
        void openFile(file);
      }
    });

    if (typeof ePub !== 'function' || typeof JSZip === 'undefined') {
      showError('첫 사용 전 npm install && npm run build:epub 을 실행해야 합니다.');
    }
    await refreshRecentBooks();
  }

  void init();
})();
