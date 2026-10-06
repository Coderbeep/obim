declare module "node:sqlite" {
  type SqlValue = null | number | bigint | string | Uint8Array;

  export class StatementSync {
    all(...values: SqlValue[]): Record<string, unknown>[];
    get(...values: SqlValue[]): Record<string, unknown> | undefined;
    run(...values: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
