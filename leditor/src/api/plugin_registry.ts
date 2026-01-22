import type { EditorPlugin, PluginId } from "./plugin_types";

const registry = new Map<PluginId, EditorPlugin>();

export const registerPlugin = (plugin: EditorPlugin) => {
  if (registry.has(plugin.id)) {
    throw new Error(`Plugin "${plugin.id}" already registered`);
  }
  registry.set(plugin.id, plugin);
};

export const getPlugins = (ids: string[]) => {
  const plugins: EditorPlugin[] = [];
  for (const id of ids) {
    const plugin = registry.get(id);
    if (plugin) plugins.push(plugin);
  }
  return plugins;
};
