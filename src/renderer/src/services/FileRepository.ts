import { dbService } from "@renderer/services/DatabaseService";
import { getNotesDirectoryPath } from "@shared/constants";
import { FileItem } from "@shared/models";

export class FileRepository {
  private readonly storeName: string;
  constructor() {
    this.storeName = "files";
  }

  async create(file: FileItem) {
    const store = await dbService.getStore(this.storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const request = store.add(file);
      request.onsuccess = () => resolve(file);
      request.onerror = () =>
        reject(new Error(`Failed to create file: ${request.error}`));
    });
  }

  async createMany(files: FileItem[]) {
    const store = await dbService.getStore(this.storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const transaction = store.transaction;

      files.forEach((file) => {
        store.put(file);
      });

      transaction.oncomplete = () => resolve(files);
      transaction.onerror = () =>
        reject(new Error(`Failed to create files: ${transaction.error}`));
    });
  }

  async findByPath(path: string) {
    const store = await dbService.getStore(this.storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(path);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () =>
        reject(new Error(`Failed to find file: ${request.error}`));
    });
  }

  async exists(path: string): Promise<boolean> {
    const file = await this.findByPath(path);
    return file !== null;
  }

  async findAll(): Promise<FileItem[]> {
    const store = await dbService.getStore(this.storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error(`Failed to get all files: ${request.error}`));
    });
  }

  async search(query: string = ""): Promise<FileItem[]> {
    if (!query.trim()) {
      return this.findAll();
    }

    const store = await dbService.getStore(this.storeName);
    return new Promise<FileItem[]>((resolve, reject) => {
      const index = store.index("filename");
      const request = index.openCursor();
      const results: FileItem[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const file: FileItem = cursor.value;
          if (file.relativePath.toLowerCase().includes(query.toLowerCase())) {
            results.push(file);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () =>
        reject(new Error(`Search failed: ${request.error}`));
    });
  }

  async update(oldPath: string, newPath: string): Promise<void> {
    const store = await dbService.getStore(this.storeName, "readwrite");

    return new Promise<void>((resolve, reject) => {
      const getRequest = store.get(oldPath);

      getRequest.onsuccess = () => {
        const file = getRequest.result;
        if (file) {
          store.delete(oldPath);

          file.path = newPath;
          file.filename = newPath.split("/").pop();
          file.relativePath = newPath.replace(getNotesDirectoryPath(), "");

          store.put(file);
          resolve();
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => {
        reject(new Error(`Error updating file path: ${getRequest.error}`));
      };
    });
  }

  async delete(file: FileItem): Promise<boolean> {
    const store = await dbService.getStore(this.storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const request = store.delete(file.path);
      request.onsuccess = () => resolve(true);
      request.onerror = () =>
        reject(new Error(`Failed to delete file: ${request.error}`));
    });
  }

  async clear(): Promise<boolean> {
    const store = await dbService.getStore(this.storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () =>
        reject(new Error(`Failed to clear files: ${request.error}`));
    });
  }
}

export const fileRepository = new FileRepository();
