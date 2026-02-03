export type AiScope = "selection" | "document";

export type AiProvider = "openai" | "deepseek" | "mistral" | "gemini";

export type AiAudience = "general" | "knowledgeable" | "expert";

export type AiFormality = "casual" | "neutral" | "formal";

export type AiSettings = {
  apiKey: string;
  provider: AiProvider;
  model: string;
  temperature: number;
  chunkSize: number;
  defaultScope: AiScope;
  audience: AiAudience;
  formality: AiFormality;
};
