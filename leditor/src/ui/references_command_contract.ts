import type { ControlConfig, TabConfig } from "./ribbon_config.ts";

const collectNestedControls = (control: ControlConfig): ControlConfig[] => {
  const nested: ControlConfig[] = [];
  if (Array.isArray(control.controls)) nested.push(...control.controls);
  if (Array.isArray(control.menu)) nested.push(...control.menu);
  if (Array.isArray(control.items)) nested.push(...control.items);
  if (control.gallery && Array.isArray(control.gallery.controls)) {
    nested.push(...control.gallery.controls);
  }
  return nested;
};

const traverseControl = (control: ControlConfig, ids: Set<string>) => {
  if (control.command?.id) {
    ids.add(control.command.id);
  }
  collectNestedControls(control).forEach((nested) => traverseControl(nested, ids));
};

export const getReferencesCommandIds = (tab: TabConfig): Set<string> => {
  const ids = new Set<string>();
  if (!tab?.groups) return ids;
  tab.groups.forEach((group) => {
    group.clusters?.forEach((cluster) => {
      cluster.controls?.forEach((control) => traverseControl(control, ids));
    });
  });
  return ids;
};
