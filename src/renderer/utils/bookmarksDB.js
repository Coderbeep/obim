import { notesDirectoryPath } from '../../shared/constants'

const DB_NAME = 'fileDatabase';

export function addBookmarkToDB(file) {
  const dbRequest = indexedDB.open(DB_NAME, 1);
  dbRequest.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction('bookmarks', 'readwrite');
    const store = transaction.objectStore('bookmarks');

    store.put(file);

    transaction.oncomplete = () => {
      console.log('Bookmark has been added to IndexedDB');
    };

    transaction.onerror = (event) => {
      console.error('Transaction error:', event.target.error);
    };
  };
}

export async function getBookmarksFromDB() {
  const dbRequest = indexedDB.open(DB_NAME, 1);
  return new Promise((resolve, reject) => {
    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction('bookmarks', 'readonly');
      const store = transaction.objectStore('bookmarks');
      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        resolve(getRequest.result);
      };

      getRequest.onerror = (event) => {
        reject(event.target.error);
      };
    };
  });
}

export async function removeBookmarkFromDB(path) {
    const dbRequest = indexedDB.open(DB_NAME, 1);
    dbRequest.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction('bookmarks', 'readwrite');
        const store = transaction.objectStore('bookmarks');
        
        store.delete(path);
    
        transaction.oncomplete = () => {
        console.log('Bookmark has been removed from IndexedDB');
        };
    
        transaction.onerror = (event) => {
        console.error('Transaction error:', event.target.error);
        };
    };
}


export async function updateBookmarkInDB(oldPath, newPath) {
    const dbRequest = indexedDB.open(DB_NAME, 1);
    dbRequest.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction('bookmarks', 'readwrite');
        const store = transaction.objectStore('bookmarks');

        const getRequest = store.get(oldPath);
        getRequest.onsuccess = () => {
            const file = getRequest.result;
            if (file) {
                store.delete(oldPath);

                file.path = newPath;
                file.filename = newPath.split('/').pop();
                file.relativePath = newPath.replace(notesDirectoryPath, '');
                store.put(file);
                console.log(`Bookmark updated from '${oldPath}' to '${newPath}'`);
            }
        };

        getRequest.onerror = (event) => {
            console.error('Error fetching bookmark:', event.target.error);
        };
    };
}
