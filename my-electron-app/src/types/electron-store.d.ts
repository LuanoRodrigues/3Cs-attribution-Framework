declare module "electron-store" {
  type ElectronStoreOptions = {
    cwd?: string;
    name?: string;
    fileExtension?: string;
    watch?: boolean;
    accessPropertiesByDotNotation?: boolean;
    [key: string]: unknown;
  };

  export default class ElectronStore<T extends Record<string, unknown> = Record<string, unknown>> {
    constructor(options?: ElectronStoreOptions);
    has(key: string): boolean;
    get<Key extends string>(key: Key, defaultValue?: unknown): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    store: T;
    path: string;
  }
}
