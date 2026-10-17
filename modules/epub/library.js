/**
 * Recent EPUB files, represented by FileSystemFileHandle references, never by copies.
 * The pre-existing 'blob' field from the old release is retained until explicitly
 * linked to an original file or removed by the user.
 */
(() => {
  'use strict';

  const DB_NAME = 'dev-toolkit-epub-library';
  const VERSION = 1; // Existing object-store schema supports the new record shape.
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
        try {
          const tx = db.transaction(names, mode);
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

  async function findByHandle(handle) {
    const recents = await list();
    for (const item of recents) {
      if (item.kind !== 'handle') continue;
      const record = await get(item.id);
      if (record?.handle && await handle.isSameEntry(record.handle)) return record;
    }
    return null;
  }

  function remove(id) {
    return withStores(['books', 'recent'], 'readwrite', tx => {
      tx.objectStore('books').delete(id);
      return tx.objectStore('recent').delete(id);
    });
  }

  function clearAll() {
    return withStores(['books', 'recent'], 'readwrite', tx => {
      tx.objectStore('books').clear();
      return tx.objectStore('recent').clear();
    });
  }

  async function save(handle, file, title, id = bookId(file)) {
    if (!handle || handle.kind !== 'file') throw new Error('파일 핸들이 필요합니다.');
    const existing = await get(id);
    const sameVersion = existing?.size === file.size && existing?.lastModified === file.lastModified;
    const openedAt = Date.now();
    const entry = {
      id,
      handle,
      title: title || file.name,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      openedAt,
      locations: sameVersion ? existing?.locations || null : null
    };
    // Overwrite old Blob records with a handle-only entry, releasing the copy.
    await withStores(['books', 'recent'], 'readwrite', tx => {
      tx.objectStore('recent').put({
        id, kind: 'handle', title: entry.title, name: entry.name,
        size: entry.size, openedAt
      });
      return tx.objectStore('books').put(entry);
    });
    const rows = await list();
    for (const stale of rows.slice(MAX_RECENT)) await remove(stale.id);
    return entry;
  }

  async function saveLocations(id, locations) {
    const existing = await get(id);
    if (!existing?.handle) return;
    existing.locations = locations;
    await withStores(['books'], 'readwrite', tx => tx.objectStore('books').put(existing));
  }

  window.EpubLibrary = Object.freeze({
    bookId, get, list, findByHandle, save, saveLocations, remove, clearAll, MAX_RECENT
  });
})();
