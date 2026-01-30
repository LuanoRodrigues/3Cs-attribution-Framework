export type AiScope = "selection" | "document";

export type AiSettings = {
  apiKey: string;
  model: string;
  temperature: number;
  chunkSize: number;
  defaultScope: AiScope;
};
