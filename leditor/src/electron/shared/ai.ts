import type { PersonaConfig } from "../../shared/persona.ts";

export type AiScope = "selection" | "document";

export type AiProvider = "openai" | "deepseek" | "mistral" | "gemini";

export type AiSettings = {
  apiKey: string;
  provider: AiProvider;
  model: string;
  chunkSize: number;
  defaultScope: AiScope;
  personaConfig: PersonaConfig;
};
