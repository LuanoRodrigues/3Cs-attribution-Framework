export const GENERAL_KEYS = {
  authorName: "General/author_name",
  authorAffiliation: "General/author_affiliation",
  authorContact: "General/author_contact",
  projectName: "General/project_name",
  collectionName: "General/collection_name",
  researchQuestion: "General/research_question",
  eligibilityCriteria: "General/eligibility_criteria",
  lastProjectPath: "General/last_project_path",
  lastKeywords: "General/last_keywords",
  pdfSelectionAutoCopy: "General/pdf_selection_auto_copy"
} as const;

export const ZOTERO_KEYS = {
  libraryId: "Zotero/library_id",
  libraryType: "Zotero/library_type",
  apiKey: "Zotero/api_key",
  lastCollection: "Zotero/last_used_collection"
} as const;

export const APPEARANCE_KEYS = {
  theme: "Appearance/theme",
  density: "Appearance/density",
  accent: "Appearance/accent_color",
  effects: "Appearance/effects_mode",
  uiScale: "Appearance/ui_scale"
} as const;

export const DATABASE_KEYS = {
  wosKey: "APIs/wos_api_key",
  serpApiKey: "APIs/serpapi_key",
  elsevierKey: "APIs/elsevier_api_key",
  springerKey: "APIs/springer_api_key",
  semanticScholarKey: "APIs/semantic_scholar_key"
} as const;

export const LLM_KEYS = {
  provider: "APIs/llm_provider",
  telemetryEnabled: "APIs/telemetry_enabled",
  openaiBaseUrl: "APIs/openai_base_url",
  openaiKey: "APIs/openai_api_key",
  openaiVoiceTranscribeModel: "APIs/openai_voice_transcribe_model",
  openaiVoiceTtsModel: "APIs/openai_voice_tts_model",
  openaiVoiceTtsVoice: "APIs/openai_voice_tts_voice",
  geminiBaseUrl: "APIs/gemini_base_url",
  geminiKey: "APIs/gemini_api_key",
  deepSeekBaseUrl: "APIs/deepseek_base_url",
  deepSeekKey: "APIs/deepseek_api_key",
  mistralBaseUrl: "APIs/mistral_base_url",
  mistralKey: "APIs/mistral_api_key"
} as const;

export type SettingsKey =
  | (typeof GENERAL_KEYS)[keyof typeof GENERAL_KEYS]
  | (typeof ZOTERO_KEYS)[keyof typeof ZOTERO_KEYS]
  | (typeof APPEARANCE_KEYS)[keyof typeof APPEARANCE_KEYS]
  | (typeof DATABASE_KEYS)[keyof typeof DATABASE_KEYS]
  | (typeof LLM_KEYS)[keyof typeof LLM_KEYS];
