declare module "better-sqlite3" {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }

  export interface Statement<T = Record<string, unknown>> {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
  }

  export default class Database {
    constructor(filename: string);
    pragma(statement: string): Database;
    exec(sql: string): Database;
    prepare<T = Record<string, unknown>>(sql: string): Statement<T>;
  }
}
