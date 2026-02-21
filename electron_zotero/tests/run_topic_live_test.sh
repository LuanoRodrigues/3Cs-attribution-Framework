#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATASET="$ROOT_DIR/electron_zotero/tests/topic_frameworks_live_dataset.json"
OUT_JSON="${1:-/tmp/topic_live_result.json}"

if [[ ! -f "$DATASET" ]]; then
  echo "Dataset not found: $DATASET" >&2
  exit 1
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required in environment." >&2
  exit 1
fi

node - <<'NODE' "$DATASET" \
| python3 "$ROOT_DIR/electron_zotero/main/py/classify_topic_batch.py" > "$OUT_JSON"
const fs = require('fs');
const datasetPath = process.argv[2];
const ds = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['included', 'maybe', 'excluded'] },
    is_match: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    themes: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 5 },
    subject: { type: 'string' },
    reason: { type: 'string' },
    suggested_tags: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 8 }
  },
  required: ['status', 'is_match', 'confidence', 'themes', 'subject', 'reason', 'suggested_tags']
};
const payload = {
  topic: ds.topic,
  items: ds.items,
  model: 'gpt-5-mini',
  liveMode: true,
  storeOnly: false,
  promptSpec: {
    promptKey: 'classify_abstract_topic_membership_v1_dynamic',
    system: 'You are a rigorous academic screening classifier for Zotero abstracts. Return strict JSON only.',
    template: [
      'Classify this abstract for topic-based folder screening.',
      'Target topic query: frameworks or models concerning attribution of cyberattacks',
      'Policy:',
      '- title has higher weight than abstract for topical relevance signals.',
      '- included: the paper major objective/contribution is the target subject (framework/model/theory/method specifically about the subject).',
      '- included also when the central contribution is a legal/policy/institutional framework for attribution of cyber operations.',
      '- included when legal/evidentiary framework design (e.g., evidence-sharing standards, incident repositories, proof/attribution procedures) is central.',
      '- maybe: the paper talks about the subject, but it is not the main contribution/objective.',
      '- maybe when attribution is analyzed as discourse/knowledge-politics or as background context without an operational attribution framework.',
      '- maybe when the contribution is primarily critical/theoretical about attribution politics rather than a prescriptive attribution framework.',
      '- excluded: none of the above; subject is absent or not materially discussed.',
      '- when uncertain between included and maybe: choose maybe (be conservative).',
      'INPUT JSON (evaluate BOTH title and abstract):',
      '{"topic_query":"{topic}","title":"{title}","abstract":"{abstract}","item_key":"{item_key}"}'
    ].join('\n'),
    schema
  }
};
process.stdout.write(JSON.stringify(payload));
NODE

node - <<'NODE' "$OUT_JSON"
const fs = require('fs');
const p = process.argv[2];
const res = JSON.parse(fs.readFileSync(p, 'utf8'));
if (res.status !== 'ok') {
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
const idx = new Map((res.results || []).map((r) => [r.key, r]));
const keys = ['Q6ERD9FW', 'JQPVG8KP', 'XW9I9W2X', 'SEMYTGKY', '4EP2MD85'];
for (const k of keys) {
  const r = idx.get(k) || {};
  console.log(`${k}\t${r.status || 'missing'}\t${Number(r.confidence || 0).toFixed(2)}\t${String(r.reason || '').slice(0, 140)}`);
}
console.log(`mode=${res?.meta?.mode || 'batch'} scanned=${res?.meta?.scanned || 0}`);
NODE

echo "Saved JSON: $OUT_JSON"
