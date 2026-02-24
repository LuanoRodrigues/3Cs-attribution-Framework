import { z } from "zod";

const lLMProviders = z.enum(["openai", "gemini", "deepseek", "mistral"]);
const libraryType = z.enum(["user", "group"]);
const themeOptions = z.enum(["system", "dark", "light", "high-contrast", "colorful", "warm", "cold"]);
const effectsOptions = z.enum(["full", "performance"]);
const uiScaleOptions = z.enum(["0.85", "0.9", "1", "1.1", "1.2", "1.3", "1.4"]);

const stringWithDefault = (defaultValue = "") => z.string().default(defaultValue);

export const SETTINGS_KEY_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "General/author_name": stringWithDefault(),
  "General/author_affiliation": stringWithDefault(),
  "General/author_contact": stringWithDefault(),
  "General/project_name": stringWithDefault(),
  "General/collection_name": stringWithDefault(),
  "General/research_question": stringWithDefault(),
  "General/eligibility_criteria": stringWithDefault(),
  "General/last_project_path": stringWithDefault(),
  "General/last_keywords": stringWithDefault(),
  "General/pdf_selection_auto_copy": z.boolean().default(true),
  "Appearance/theme": themeOptions.default("system"),
  "Appearance/density": z.enum(["comfortable", "compact"]).default("comfortable"),
  "Appearance/accent_color": stringWithDefault("#2f74ff"),
  "Appearance/effects_mode": effectsOptions.default("full"),
  "Appearance/ui_scale": uiScaleOptions.default("1"),
  "Zotero/library_id": stringWithDefault(),
  "Zotero/library_type": libraryType.default("user"),
  "Zotero/last_used_collection": stringWithDefault(),
  "APIs/llm_provider": lLMProviders.default("openai"),
  "APIs/telemetry_enabled": z.boolean().default(false),
  "APIs/openai_base_url": stringWithDefault("https://api.openai.com/v1"),
  "APIs/openai_voice_transcribe_model": stringWithDefault("whisper-1"),
  "APIs/openai_voice_tts_model": stringWithDefault("tts-1"),
  "APIs/openai_voice_tts_voice": stringWithDefault("alloy"),
  "APIs/gemini_base_url": stringWithDefault("https://generative.googleapis.com/v1"),
  "APIs/deepseek_base_url": stringWithDefault(),
  "APIs/mistral_base_url": stringWithDefault(),
  "APIs/openai_api_key": stringWithDefault(),
  "APIs/gemini_api_key": stringWithDefault(),
  "APIs/deepseek_api_key": stringWithDefault(),
  "APIs/mistral_api_key": stringWithDefault(),
  "APIs/wos_api_key": stringWithDefault(),
  "APIs/serpapi_key": stringWithDefault(),
  "APIs/elsevier_api_key": stringWithDefault(),
  "APIs/springer_api_key": stringWithDefault(),
  "APIs/semantic_scholar_key": stringWithDefault()
};

export const settingsSchema = z.object(SETTINGS_KEY_SCHEMAS).passthrough();

export function validateSettingValue(key: string, value: unknown): unknown {
  const schema = SETTINGS_KEY_SCHEMAS[key];
  if (!schema) {
    return value;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : schema.parse(undefined);
}

export function hydrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
  return settingsSchema.parse(raw);
}
