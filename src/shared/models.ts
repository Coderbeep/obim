export interface FileItem {
  filename: string;
  relativePath: string;
  path: string;
  isDirectory: boolean;
  children?: FileItem[];
  isOpen?: boolean;
  level?: number;
}