export type HostAdapter = NonNullable<Window["leditorHost"]>;

let overriddenAdapter: HostAdapter | null | undefined = undefined;

export const setHostAdapter = (adapter: HostAdapter | null) => {
  overriddenAdapter = adapter;
};

export const getHostAdapter = (): HostAdapter | null => {
  if (overriddenAdapter !== undefined) {
    return overriddenAdapter;
  }
  return window.leditorHost ?? null;
};

