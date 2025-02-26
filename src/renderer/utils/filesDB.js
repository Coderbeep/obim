const DB_NAME = 'fileDatabase';
const request = indexedDB.open(DB_NAME, 1);

request.onupgradeneeded = (event) => {
  const db = event.target.result;
  const store = db.createObjectStore('files', { keyPath: 'path' });
  store.createIndex('files', 'filename', { unique: false });

  if (!db.objectStoreNames.contains('bookmarks')) {
    const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'path' });
    bookmarkStore.createIndex('bookmarks', 'filename', { unique: false });
}
};

request.onerror = (event) => {
  console.error('IndexedDB error:', event.target.error);
};

export function storeFilesInDB(files) {
  const dbRequest = indexedDB.open(DB_NAME, 1);
  dbRequest.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');

    files.forEach((file) => {
      store.put(file);
    });

    transaction.oncomplete = () => {
      console.log('Files have been stored in IndexedDB');
    };

    transaction.onerror = (event) => {
      console.error('Transaction error:', event.target.error);
    };
  };
}

export function getFilesFromDB(query = '') {
  return new Promise((resolve, reject) => {
    const dbRequest = indexedDB.open(DB_NAME, 1);
    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('files');
      const request = index.openCursor();

      const results = [];
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.relativePath.includes(query)) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    };
  });
}

export function doesPathExist(path) {
  return new Promise((resolve, reject) => {
    const dbRequest = indexedDB.open(DB_NAME, 1);
    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(path);

      request.onsuccess = () => {
        resolve(request.result !== undefined);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    };

    dbRequest.onerror = (event) => {
      reject(event.target.error);
    };
  });
}
