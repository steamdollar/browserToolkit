/**
 * Extension-origin IndexedDB storage for recent EPUB files.
 * Stores Blobs in IndexedDB instead of chrome.storage.local (10 MB quota).
 * Only extension pages use this module; no web-site injection or extra permissions.
 */
(() => {
  'use strict';

  const DB_NAME = 'dev-toolkit-epub-library';
  const VERSION = 1;
  const MAX_RECENT = 10;

  function bookId(file) {
    return JSON.stringify([file.name, file.size, file.lastModified]);
  }

  function withStores(names, mode, makeRequest) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onerror = () => reject(request.error || new Error('도서 보관함을 열 수 없습니다.'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('recent')) {
          db.createObjectStore('recent', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        let result;
        let tx;
        try {
          tx = db.transaction(names, mode);
          const req = makeRequest(tx);
          req.onsuccess = () => { result = req.result; };
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onerror = () => { db.close(); reject(tx.error || new Error('도서 저장 오류')); };
          tx.onabort = () => { db.close(); reject(tx.error || new Error('도서 저장 중단')); };
        } catch (error) {
          db.close();
          reject(error);
        }
      };
    });
  }

  function get(id) {
    return withStores(['books'], 'readonly', tx => tx.objectStore('books').get(id));
  }

  function list() {
    return withStores(['recent'], 'readonly', tx => tx.objectStore('recent').getAll())
      .then(rows => rows.sort((a, b) => b.openedAt - a.openedAt));
  }

  async function remove(id) {
    await withStores(['books', 'recent'], 'readwrite', tx => {
      tx.objectStore('books').delete(id);
      return tx.objectStore('recent').delete(id);
    });
  }

  async function save(file, title) {
    const id = bookId(file);
    const existing = await get(id);
    const openedAt = Date.now();
    const entry = {
      id,
      blob: file,
      title: title || file.name,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      openedAt,
      locations: existing?.locations || null
    };
    await withStores(['books', 'recent'], 'readwrite', tx => {
      tx.objectStore('recent').put({
        id, title: entry.title, name: entry.name,
        size: entry.size, openedAt
      });
      return tx.objectStore('books').put(entry);
    });

    // Keep a bounded history: avoid unbounded EPUB disk usage.
    const recents = await list();
    for (const stale of recents.slice(MAX_RECENT)) {
      await remove(stale.id);
    }
    return entry;
  }

  async function saveLocations(id, locations) {
    // An earlier version may have been removed while a page index was computing.
    const existing = await get(id);
    if (!existing) return;
    existing.locations = locations;
    await withStores(['books'], 'readwrite', tx => tx.objectStore('books').put(existing));
  }

  window.EpubLibrary = Object.freeze({ bookId, get, list, save, saveLocations, remove, MAX_RECENT });
})();
