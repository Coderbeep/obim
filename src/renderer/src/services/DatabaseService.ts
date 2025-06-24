class DatabaseService {
  private readonly dbName: string;
  private readonly version: number;
  private db: IDBDatabase | null;

  constructor(dbName = "fileDatabase", version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.setupStores(db);
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(
          new Error(
            `Failed to open database: ${event.target as IDBOpenDBRequest}`,
          ),
        );
      };
    });
  }

  setupStores(db: IDBDatabase) {
    if (!db.objectStoreNames.contains("files")) {
      const filesStore = db.createObjectStore("files", { keyPath: "path" });
      filesStore.createIndex("filename", "filename", { unique: false });
    }

    if (!db.objectStoreNames.contains("bookmarks")) {
      const bookmarksStore = db.createObjectStore("bookmarks", {
        keyPath: "path",
      });
      bookmarksStore.createIndex("bookmarks", "filename", { unique: false });
    }
  }

  async getStore(storeName, mode: IDBTransactionMode = "readonly") {
    const db = await this.init();
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export const dbService = new DatabaseService();
