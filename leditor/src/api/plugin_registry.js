"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlugins = exports.registerPlugin = void 0;
const registry = new Map();
const registerPlugin = (plugin) => {
    if (registry.has(plugin.id)) {
        throw new Error(`Plugin "${plugin.id}" already registered`);
    }
    registry.set(plugin.id, plugin);
};
exports.registerPlugin = registerPlugin;
const getPlugins = (ids) => {
    const plugins = [];
    for (const id of ids) {
        const plugin = registry.get(id);
        if (plugin)
            plugins.push(plugin);
    }
    return plugins;
};
exports.getPlugins = getPlugins;
