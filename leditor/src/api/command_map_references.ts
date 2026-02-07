import { commandMap, type CommandHandler } from "./command_map.ts";
import { referencesTab } from "../ui/ribbon_model.ts";
import { getReferencesCommandIds } from "../ui/references_command_contract.ts";

export const referencesCommands: Record<string, CommandHandler> = {};

const ids = getReferencesCommandIds(referencesTab as any);
ids.forEach((id) => {
  const handler = commandMap[id];
  if (handler) {
    referencesCommands[id] = handler;
  }
});
