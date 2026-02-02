export type AiScope = "selection" | "document";

export type AiProvider = "openai" | "deepseek" | "mistral" | "gemini";

export type AiSettings = {
  apiKey: string;
  provider: AiProvider;
  model: string;
  temperature: number;
  chunkSize: number;
  defaultScope: AiScope;
};
