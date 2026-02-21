#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const apiKey = process.env.OPENAI_API_KEY || '';
if (!apiKey) {
  console.error('OPENAI_API_KEY missing.');
  process.exit(2);
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intentId: { type: 'string', enum: ['workflow.create_subfolder_by_topic', 'feature.run', 'agent.legacy_command'] },
    targetFunction: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    riskLevel: { type: 'string', enum: ['safe', 'confirm', 'high'] },
    needsClarification: { type: 'boolean' },
    clarificationQuestions: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 6 },
    args: {
      type: 'object',
      additionalProperties: false,
      properties: {
        parentIdentifier: { type: 'string' },
        subfolderName: { type: 'string' },
        topic: { type: 'string' },
        confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
        maxItems: { type: 'number' },
        collection_name: { type: 'string' },
        csv_path: { type: 'string' },
        output_folder: { type: 'string' },
        Z_collections: { type: 'array', items: { type: 'string' } },
        text: { type: 'string' }
      },
      required: ['parentIdentifier','subfolderName','topic','confidenceThreshold','maxItems','collection_name','csv_path','output_folder','Z_collections','text']
    }
  },
  required: ['intentId','targetFunction','confidence','riskLevel','needsClarification','clarificationQuestions','args']
};

const guidance = [
  'You are an intent router for Zotero workflows. Always respond by calling the function tool.',
  'If user asks to filter/read/retrieve documents by subject, choose workflow.create_subfolder_by_topic.',
  'For that workflow set args: parentIdentifier, subfolderName, topic, confidenceThreshold, maxItems. maxItems=0 for full active collection.',
  'Use selectedCollectionKey as parentIdentifier fallback.',
  'Always return all args fields from schema: empty string for non-applicable strings, [] for Z_collections, and 0 for non-applicable numerics.',
  'If subfolder missing but topic exists, needsClarification=true and ask: Can I create a subfolder entitled "<suggested_name>" filtering only articles talking about "<topic>"?',
  'If topic missing ask clarification.',
  'If request maps to known features, use feature.run with exact targetFunction.',
  'If unclear, use agent.legacy_command with clarification.'
].join('\n');

const basePrompts = [
  { text: 'create a subfolder frameworks and filter all the items talking about frameworks in cyber attribution', want: 'workflow' },
  { text: 'read the items/articles/documents/papers and retrieve only those talking about frameworks', want: 'workflow' },
  { text: 'make folder legal_attribution under current collection with papers about legal attribution', want: 'workflow' },
  { text: 'scan current collection and keep only papers about technical attribution in a subcollection', want: 'workflow' },
  { text: 'find papers about attribution evidence standards', want: 'workflow' },
  { text: 'please export csv for active collection', want: 'feature:export_collection_to_csv' },
  { text: 'download pdfs from selected collection', want: 'feature:download_pdfs_from_collections' }
];

const extendedPrompts = [
  { text: 'creat subfolder frammeworks n filter docs about frameworks cyber attribution', want: 'workflow' },
  { text: 'por favor crea una subcarpeta de marcos y filtra articulos sobre frameworks', want: 'workflow' },
  { text: 'lis les papiers et garde seulement ceux sur attribution legale', want: 'workflow' },
  { text: 'can you process all records concerning evidentiary standards and make a folder?', want: 'workflow' },
  { text: 'get only docs regarding technical attribution and legal attribution models', want: 'workflow' },
  { text: 'need csv export now for this collection', want: 'feature:export_collection_to_csv' },
  { text: 'bulk fetch all pdfs for selected collection please', want: 'feature:download_pdfs_from_collections' },
  { text: 'read papers, tag relevant ones about doctrine, and create a subcollection', want: 'workflow' }
];

const runExtended = process.argv.includes('--extended') || process.env.INTENT_ROUTER_EXTENDED === '1';
const prompts = runExtended ? [...basePrompts, ...extendedPrompts] : basePrompts;

async function callOne(text) {
  const payload = {
    user_text: text,
    context: {
      selectedCollectionKey: 'TESTCOLLKEY123',
      selectedCollectionName: '0.13_cyber_attribution_corpus_records_total_included'
    },
    available_features: [
      { functionName: 'export_collection_to_csv', label: 'Export CSV', group: 'Export', tab: 'Data', requiredArgs: ['collection_name', 'csv_path'] },
      { functionName: 'download_pdfs_from_collections', label: 'Download PDFs', group: 'Downloads', tab: 'Data', requiredArgs: ['output_folder', 'Z_collections'] }
    ]
  };

  const body = {
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: guidance },
      { role: 'user', content: JSON.stringify(payload) }
    ],
    tools: [{ type: 'function', function: { name: 'resolve_intent', description: 'Resolve user text into structured intent', parameters: schema, strict: true } }],
    tool_choice: { type: 'function', function: { name: 'resolve_intent' } }
  };

  const requestOnce = async (timeoutMs) => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ac.signal
      });
      const txt = await res.text();
      if (!res.ok) return { ok: false, error: txt.slice(0, 500) };
      const parsed = JSON.parse(txt);
      const args = parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || '';
      if (!args) return { ok: false, error: 'no tool arguments' };
      return { ok: true, intent: JSON.parse(args) };
    } catch (e) {
      return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
    } finally {
      clearTimeout(timeout);
    }
  };

  const attempts = [25000, 35000, 45000];
  let last = { ok: false, error: 'unknown' };
  for (const timeoutMs of attempts) {
    const out = await requestOnce(timeoutMs);
    if (out.ok) return out;
    last = out;
    if (!String(out.error || '').toLowerCase().includes('timeout')) break;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return last;
}

(async () => {
  const rows = [];
  let pass = 0;
  for (const [i, p] of prompts.entries()) {
    const out = await callOne(p.text);
    let ok = false;
    let intentId = '';
    let targetFunction = '';
    if (out.ok) {
      intentId = out.intent?.intentId || '';
      targetFunction = out.intent?.targetFunction || '';
      if (p.want === 'workflow') ok = intentId === 'workflow.create_subfolder_by_topic';
      else if (p.want.startsWith('feature:')) ok = intentId === 'feature.run' && targetFunction === p.want.split(':')[1];
    }
    if (ok) pass += 1;
    rows.push({ i, prompt: p.text, want: p.want, ok, intentId, targetFunction, error: out.ok ? '' : out.error });
    console.log(`intent-smoke ${i + 1}/${prompts.length} ok=${ok}`);
  }

  const summary = { total: prompts.length, pass, fail: prompts.length - pass, rows };
  const outPath = path.join(__dirname, 'intent_router_smoke_results.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.fail > 0 ? 1 : 0);
})();
