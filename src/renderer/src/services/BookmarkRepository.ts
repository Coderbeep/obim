import { dbService } from "@renderer/services/DatabaseService";
import { getNotesDirectoryPath } from "@shared/constants";
import { FileItem } from "@shared/models";

export class BookmarkRepository {
  private readonly storeName;

  constructor() {
    this.storeName = "bookmarks";
  }

  async create(bookmark: FileItem) {
    const store = await dbService.getStore(this.storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const request = store.add(bookmark);
      request.onsuccess = () => resolve(bookmark);
      request.onerror = () =>
        reject(new Error(`Failed to create bookmark: ${request.error}`));
    });
  }

  async findByPath(path: string) {
    const store = await dbService.getStore(this.storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(path);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () =>
        reject(new Error(`Failed to find bookmark: ${request.error}`));
    });
  }

  async findAll(): Promise<FileItem[]> {
    const store = await dbService.getStore(this.storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error(`Failed to get all bookmarks: ${request.error}`));
    });
  }

  async delete(bookmark: FileItem): Promise<boolean> {
    const store = await dbService.getStore(this.storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const request = store.delete(bookmark.path);
      request.onsuccess = () => resolve(true);
      request.onerror = () =>
        reject(new Error(`Failed to delete bookmark: ${request.error}`));
    });
  }

  async exists(path: string): Promise<boolean> {
    const bookmark = await this.findByPath(path);
    return bookmark !== null;
  }

  async toggle(bookmark: FileItem) {
    const exists = await this.exists(bookmark.path);
    if (exists) {
      await this.delete(bookmark);
      return false;
    } else {
      await this.create(bookmark);
      return true;
    }
  }

  async update(oldPath: string, newPath: string) {
    const store = await dbService.getStore(this.storeName, "readwrite");

    return new Promise<void>((resolve, reject) => {
      const getRequest = store.get(oldPath);

      getRequest.onsuccess = () => {
        const file = getRequest.result;
        if (file) {
          const deleteRequest = store.delete(oldPath);
          deleteRequest.onsuccess = () => {
            file.path = newPath;
            file.filename = newPath.split("/").pop();
            file.relativePath = newPath.replace(getNotesDirectoryPath(), "");

            const putRequest = store.put(file);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () =>
              reject(
                new Error(`Failed to update bookmark: ${putRequest.error}`),
              );
          };
          deleteRequest.onerror = () =>
            reject(
              new Error(
                `Failed to delete old bookmark: ${deleteRequest.error}`,
              ),
            );
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => {
        reject(new Error(`Error updating bookmark path: ${getRequest.error}`));
      };
    });
  }
}

export const bookmarkRepository = new BookmarkRepository();
