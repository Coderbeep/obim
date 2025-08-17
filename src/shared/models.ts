export interface FileItem {
  filename: string;
  relativePath: string;
  path: string;
  isDirectory: boolean;
  mimeType?: string;
  children?: FileItem[];
  isOpen?: boolean;
  level?: number;
}