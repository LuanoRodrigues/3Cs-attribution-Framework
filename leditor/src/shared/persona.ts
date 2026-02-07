export type PersonaParamValue = string | number | boolean;

export type PersonaParamDef = {
  name: string;
  type: "string" | "number" | "boolean";
  default: PersonaParamValue;
  description?: string;
};

export type PersonaDefinition = {
  name: string;
  theory: string;
  icon?: string;
  method_type?: string;
  normative_stance?: string;
  evidence_style?: string;
  epistemology?: string;
  tags?: string[];
  subtraditions?: string[];
  canon?: {
    theorists?: string[];
    core_texts?: Array<{ cite: string; url?: string }>;
  };
  assumptions?: string[];
  units?: string[];
  mechanisms?: string[];
  concepts?: string[];
  preferred_sources?: string[];
  methods?: string[];
  typical_questions?: string[];
  voice?: {
    tone?: string;
    moves?: string[];
  };
  interaction_rules?: string[];
  params?: PersonaParamDef[];
};

export type PersonaLibraryMeta = {
  schema_version: string;
  generated_at?: string;
  intent?: string;
  last_updated?: string;
  curator?: string;
};

export type PersonaLibrary = {
  meta: PersonaLibraryMeta;
  personas: Record<string, PersonaDefinition>;
};

export type PersonaAudience = "non_expert" | "interdisciplinary" | "expert";

export type PersonaOutputProfile = "academic_paper" | "policy_memo" | "seminar_notes" | "peer_review_response";

export type PersonaGlobalParams = {
  audience: PersonaAudience;
  formality: number;
  citationDensity: number;
  outputProfile: PersonaOutputProfile;
};

export type PersonaConfig = {
  schemaVersion: "1.0";
  mode: "simple" | "advanced";
  selectedPersonaIds: string[];
  weights: Record<string, number>;
  global: PersonaGlobalParams;
  perPersona: Record<string, Record<string, PersonaParamValue>>;
  anchorPersonaId?: string;
  includeConfigInOutput: boolean;
  includeConfigHashInFootnote: boolean;
  notes?: string;
};

export type CompiledPersonaDirectives = {
  config: PersonaConfig;
  hash: string;
  configJson: string;
  configJsonPretty: string;
  directives: string;
  directiveLength: number;
};

export const DEFAULT_GLOBAL_PARAMS: PersonaGlobalParams = {
  audience: "expert",
  formality: 0.8,
  citationDensity: 0.6,
  outputProfile: "academic_paper"
};

export const DEFAULT_PERSONA_CONFIG: PersonaConfig = {
  schemaVersion: "1.0",
  mode: "simple",
  selectedPersonaIds: [],
  weights: {},
  global: DEFAULT_GLOBAL_PARAMS,
  perPersona: {},
  includeConfigInOutput: false,
  includeConfigHashInFootnote: false
};

const clampNumber = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const normalizeWeights = (ids: string[], weights: Record<string, number>, mode: PersonaConfig["mode"]): Record<string, number> => {
  if (ids.length === 0) return {};
  if (mode === "simple") {
    return { [ids[0]]: 1 };
  }
  const raw = ids.map((id) => clampNumber(Number(weights[id] ?? 0), 0, 1, 0));
  const total = raw.reduce((sum, value) => sum + value, 0);
  const normalized = new Map<string, number>();
  if (total <= 0) {
    const equal = 1 / ids.length;
    ids.forEach((id) => normalized.set(id, equal));
    return Object.fromEntries(normalized.entries());
  }
  let running = 0;
  ids.forEach((id, index) => {
    const value = raw[index] / total;
    const rounded = index === ids.length - 1 ? 1 - running : Math.round(value * 1000) / 1000;
    running += index === ids.length - 1 ? rounded : Math.round(value * 1000) / 1000;
    normalized.set(id, clampNumber(rounded, 0, 1, 0));
  });
  return Object.fromEntries(normalized.entries());
};

export const legacyStyleToGlobalParams = (legacy: { audience?: string; formality?: string }): Partial<PersonaGlobalParams> => {
  const legacyAudience = typeof legacy.audience === "string" ? legacy.audience.trim() : "";
  const legacyFormality = typeof legacy.formality === "string" ? legacy.formality.trim() : "";
  const audience: PersonaAudience =
    legacyAudience === "general"
      ? "non_expert"
      : legacyAudience === "knowledgeable"
        ? "interdisciplinary"
        : legacyAudience === "expert"
          ? "expert"
          : DEFAULT_GLOBAL_PARAMS.audience;
  const formality =
    legacyFormality === "casual"
      ? 0.25
      : legacyFormality === "neutral"
        ? 0.55
        : legacyFormality === "formal"
          ? 0.85
          : DEFAULT_GLOBAL_PARAMS.formality;
  return { audience, formality };
};

const normalizeGlobalParams = (global: Partial<PersonaGlobalParams> | undefined): PersonaGlobalParams => {
  const audience: PersonaAudience =
    global?.audience === "non_expert" || global?.audience === "interdisciplinary" || global?.audience === "expert"
      ? global.audience
      : DEFAULT_GLOBAL_PARAMS.audience;
  const outputProfile: PersonaOutputProfile =
    global?.outputProfile === "academic_paper" ||
    global?.outputProfile === "policy_memo" ||
    global?.outputProfile === "seminar_notes" ||
    global?.outputProfile === "peer_review_response"
      ? global.outputProfile
      : DEFAULT_GLOBAL_PARAMS.outputProfile;
  return {
    audience,
    formality: clampNumber(Number(global?.formality), 0, 1, DEFAULT_GLOBAL_PARAMS.formality),
    citationDensity: clampNumber(Number(global?.citationDensity), 0, 1, DEFAULT_GLOBAL_PARAMS.citationDensity),
    outputProfile
  };
};

const resolveDefaultPersona = (library: PersonaLibrary): string => {
  const ids = Object.keys(library.personas ?? {});
  if (ids.includes("realism")) return "realism";
  return ids[0] ?? "realism";
};

const filterPersonaParams = (
  params: PersonaDefinition["params"] | undefined,
  overrides: Record<string, PersonaParamValue> | undefined
): Record<string, PersonaParamValue> => {
  if (!params || params.length === 0) return {};
  const allowed = new Map<string, PersonaParamDef>();
  params.forEach((param) => {
    allowed.set(param.name, param);
  });
  const next: Record<string, PersonaParamValue> = {};
  if (!overrides) return next;
  for (const [key, value] of Object.entries(overrides)) {
    const def = allowed.get(key);
    if (!def) continue;
    if (def.type === "string" && typeof value === "string") next[key] = value;
    if (def.type === "number" && typeof value === "number") next[key] = value;
    if (def.type === "boolean" && typeof value === "boolean") next[key] = value;
  }
  return next;
};

export const normalizePersonaConfig = (
  input: Partial<PersonaConfig> | null | undefined,
  library: PersonaLibrary,
  legacyGlobal?: Partial<PersonaGlobalParams>
): PersonaConfig => {
  const defaultId = resolveDefaultPersona(library);
  const seed: PersonaConfig = {
    ...DEFAULT_PERSONA_CONFIG,
    selectedPersonaIds: defaultId ? [defaultId] : [],
    weights: defaultId ? { [defaultId]: 1 } : {},
    global: normalizeGlobalParams({ ...DEFAULT_GLOBAL_PARAMS, ...legacyGlobal })
  };

  if (!input || typeof input !== "object") {
    return seed;
  }

  const mode: PersonaConfig["mode"] = input.mode === "advanced" ? "advanced" : "simple";
  const rawSelected = Array.isArray(input.selectedPersonaIds) ? input.selectedPersonaIds : seed.selectedPersonaIds;
  const selected = rawSelected.filter((id) => typeof id === "string" && id in (library.personas ?? {}));
  const uniqueSelected = Array.from(new Set(selected));
  const limitedSelected = mode === "simple" ? uniqueSelected.slice(0, 1) : uniqueSelected.slice(0, 4);
  const finalSelected = limitedSelected.length > 0 ? limitedSelected : seed.selectedPersonaIds;

  const weights = normalizeWeights(finalSelected, input.weights ?? seed.weights, mode);
  const global = normalizeGlobalParams({ ...legacyGlobal, ...(input.global ?? {}) });

  const perPersona: Record<string, Record<string, PersonaParamValue>> = {};
  for (const personaId of finalSelected) {
    const personaDef = library.personas?.[personaId];
    if (!personaDef) continue;
    const overrides = (input.perPersona ?? {})[personaId];
    const filtered = filterPersonaParams(personaDef.params, overrides);
    if (Object.keys(filtered).length > 0) {
      perPersona[personaId] = filtered;
    }
  }

  const anchorPersonaId =
    typeof input.anchorPersonaId === "string" && finalSelected.includes(input.anchorPersonaId)
      ? input.anchorPersonaId
      : undefined;

  return {
    schemaVersion: "1.0",
    mode,
    selectedPersonaIds: finalSelected,
    weights,
    global,
    perPersona,
    anchorPersonaId,
    includeConfigInOutput: Boolean(input.includeConfigInOutput),
    includeConfigHashInFootnote: Boolean(input.includeConfigHashInFootnote),
    notes: typeof input.notes === "string" ? input.notes : undefined
  };
};

const stableSortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortKeys(entry));
  }
  if (!value || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === "undefined") continue;
    sorted[key] = stableSortKeys(entry);
  }
  return sorted;
};

export const stableStringify = (value: unknown): string => JSON.stringify(stableSortKeys(value));

export const stableStringifyPretty = (value: unknown): string => JSON.stringify(stableSortKeys(value), null, 2);

export const hashString = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ("0000000" + (hash >>> 0).toString(16)).slice(-8);
};

const formatList = (items: string[] | undefined): string => {
  if (!items || items.length === 0) return "";
  return items.filter(Boolean).join("; ");
};

const formatParams = (persona: PersonaDefinition, overrides: Record<string, PersonaParamValue> | undefined): string => {
  if (!persona.params || persona.params.length === 0) return "";
  const values = persona.params.map((param) => {
    const override = overrides?.[param.name];
    const value = typeof override !== "undefined" ? override : param.default;
    return `${param.name}=${String(value)}`;
  });
  return values.length > 0 ? values.join(", ") : "";
};

export const compilePersonaConfig = (config: PersonaConfig, library: PersonaLibrary): CompiledPersonaDirectives => {
  const normalized = normalizePersonaConfig(config, library);
  const ordered = [...normalized.selectedPersonaIds];
  const weights = normalized.weights;
  ordered.sort((a, b) => {
    if (normalized.anchorPersonaId) {
      if (a === normalized.anchorPersonaId) return -1;
      if (b === normalized.anchorPersonaId) return 1;
    }
    const diff = (weights[b] ?? 0) - (weights[a] ?? 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  const global = normalized.global;
  const globalLine = `Output profile: ${global.outputProfile}; audience=${global.audience}; formality=${global.formality.toFixed(
    2
  )}; citation_density=${global.citationDensity.toFixed(2)}.`;

  const personasLines: string[] = [];
  for (const personaId of ordered) {
    const persona = library.personas?.[personaId];
    if (!persona) continue;
    const weight = weights[personaId] ?? 0;
    const paramsLine = formatParams(persona, normalized.perPersona?.[personaId]);
    const lines = [
      `Persona: ${persona.name} (${persona.theory}) • weight=${weight.toFixed(2)}`,
      persona.method_type ? `Method type: ${persona.method_type}.` : "",
      persona.normative_stance ? `Normative stance: ${persona.normative_stance}.` : "",
      persona.evidence_style ? `Evidence style: ${persona.evidence_style}.` : "",
      persona.epistemology ? `Epistemology: ${persona.epistemology}.` : "",
      formatList(persona.assumptions) ? `Assumptions: ${formatList(persona.assumptions)}.` : "",
      formatList(persona.mechanisms) ? `Mechanisms: ${formatList(persona.mechanisms)}.` : "",
      formatList(persona.concepts) ? `Concepts: ${formatList(persona.concepts)}.` : "",
      formatList(persona.preferred_sources) ? `Preferred sources: ${formatList(persona.preferred_sources)}.` : "",
      formatList(persona.methods) ? `Methods: ${formatList(persona.methods)}.` : "",
      persona.voice?.tone ? `Voice: ${persona.voice.tone}.` : "",
      formatList(persona.interaction_rules) ? `Interaction rules: ${formatList(persona.interaction_rules)}.` : "",
      paramsLine ? `Params: ${paramsLine}.` : ""
    ].filter(Boolean);
    personasLines.push(lines.join("\n"));
  }

  const conflictLines = [
    "Conflict resolution priority:",
    "1) Safety, factuality, and instruction compliance.",
    "2) Method constraints (e.g., legal/empirical requirements).",
    normalized.anchorPersonaId ? "3) Anchor persona directives." : "",
    "4) Higher-weight persona directives.",
    "5) Tone/audience preferences."
  ].filter(Boolean);

  const outputHints: string[] = [];
  if (normalized.includeConfigInOutput) {
    outputHints.push("If producing a document section, append a short appendix containing the PersonaConfig JSON and hash.");
  }
  if (normalized.includeConfigHashInFootnote) {
    outputHints.push("If you include footnotes, add one noting the persona config hash.");
  }

  const directivesLines = [
    "Persona directives (apply deterministically).",
    globalLine,
    normalized.anchorPersonaId
      ? `Anchor persona: ${library.personas?.[normalized.anchorPersonaId]?.name ?? normalized.anchorPersonaId}.`
      : "",
    ...conflictLines,
    "Persona stack:",
    ...personasLines,
    ...outputHints
  ].filter(Boolean);

  const configJson = stableStringify(normalized);
  const configJsonPretty = stableStringifyPretty(normalized);
  const hash = hashString(configJson);
  const directives = directivesLines.join("\n");

  return {
    config: normalized,
    hash,
    configJson,
    configJsonPretty,
    directives,
    directiveLength: directives.length
  };
};
