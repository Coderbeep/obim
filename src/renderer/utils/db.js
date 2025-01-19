const request = indexedDB.open('fileDatabase', 1);

request.onupgradeneeded = (event) => {
  const db = event.target.result;
  const store = db.createObjectStore('files', { keyPath: 'path' }); // Using file path as the unique key
  store.createIndex('filename', 'filename', { unique: false });
};

request.onerror = (event) => {
  console.error('IndexedDB error:', event.target.error);
};

export function storeFilesInDB(files) {
  const dbRequest = indexedDB.open('fileDatabase', 1);
  dbRequest.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');

    files.forEach((file) => {
      store.put(file); // Add or update the file in the store
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
    const dbRequest = indexedDB.open('fileDatabase', 1);
    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('filename');
      const request = index.openCursor();

      const results = [];
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.filename.includes(query)) {
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
