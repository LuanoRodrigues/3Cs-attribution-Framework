import type { PersonaConfig } from "../../shared/persona.ts";

export type AiScope = "selection" | "document";

export type AiProvider = "openai" | "deepseek" | "mistral" | "gemini";

export type AiSettings = {
  apiKey: string;
  provider: AiProvider;
  personaConfig: PersonaConfig;
  modelByProvider?: Partial<Record<AiProvider, string>>;
};
