#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SCORE_VERSIONS = [
  { key: 'v1', suffix: '.icj_score_report.json' },
  { key: 'v3', suffix: '.icj_score_report_v3.json' },
  { key: 'v4', suffix: '.icj_score_report_v4.json' },
];

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumber(...values) {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function mean(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function getClaimText(claimStatement) {
  if (typeof claimStatement === 'string') return claimStatement;
  if (!claimStatement || typeof claimStatement !== 'object') return '';
  if (typeof claimStatement.verbatim_text === 'string') return claimStatement.verbatim_text;
  if (typeof claimStatement.text === 'string') return claimStatement.text;
  if (typeof claimStatement.statement === 'string') return claimStatement.statement;
  return '';
}

function getClaims(reportJson) {
  return toArray(reportJson?.raw_extraction?.stage2_claim_extraction?.attribution_claims);
}

function getSources(reportJson) {
  const fromIndex = toArray(reportJson?.raw_extraction?.stage2_claim_extraction?.document_level_index?.sources);
  if (fromIndex.length) return fromIndex;
  return toArray(reportJson?.score_input_v3?.source_registry);
}

function getArtifacts(reportJson) {
  const tables = toArray(reportJson?.enrichment?.tables).map((item) => ({ artifact_kind: 'table', ...item }));
  const figures = toArray(reportJson?.enrichment?.figures).map((item) => ({ artifact_kind: 'figure', ...item }));
  return [...tables, ...figures];
}

function summarizeV1Scoring(scoreJson) {
  const claims = toArray(scoreJson?.scoring?.claim_scores).map((claim) => ({
    claim_id: claim?.claim_id ?? null,
    score: pickNumber(claim?.final_score),
    evidence_count: claim?.evidence_count ?? null,
    source_count: claim?.source_count ?? null,
    unique_origin_count: claim?.unique_origin_count ?? null,
  }));
  const claimScores = claims.map((claim) => claim.score).filter((value) => value !== null);
  const documentAverage = pickNumber(
    scoreJson?.scoring?.document?.overall_claim_score_mean,
    scoreJson?.scoring?.document?.overall_claim_score_geometric,
    mean(claimScores)
  );
  return {
    document_average_score: documentAverage,
    claim_count: claims.length,
    claims,
    document_metrics: scoreJson?.scoring?.document ?? {},
  };
}

function summarizeV3V4Scoring(scoreJson) {
  const claims = toArray(scoreJson?.claims).map((claim) => ({
    claim_id: claim?.claim_id ?? null,
    claim_statement: getClaimText(claim?.claim_statement),
    score: pickNumber(
      claim?.scores?.belief_0_100,
      claim?.scores?.evidence_support_0_1,
      claim?.scores?.grounding_0_100
    ),
    scores: claim?.scores ?? {},
    support_anchor_ids: toArray(claim?.support_anchor_ids),
    sources_supporting_claim: toArray(claim?.sources_supporting_claim),
  }));
  const claimScores = claims.map((claim) => claim.score).filter((value) => value !== null);
  const documentAverage = pickNumber(
    scoreJson?.document_scores?.belief_weighted_0_100,
    scoreJson?.document_scores?.overall_claim_score_mean,
    scoreJson?.document_scores?.overall_claim_score_geometric,
    mean(claimScores)
  );
  return {
    document_average_score: documentAverage,
    claim_count: claims.length,
    claims,
    document_metrics: scoreJson?.document_scores ?? {},
  };
}

function buildDocumentRecord(baseDir, reportsDir, scoringDir, reportFile) {
  const docId = reportFile.replace(/_report\.json$/, '');
  const reportPath = path.join(reportsDir, reportFile);
  const reportJson = readJson(reportPath);

  const claims = getClaims(reportJson);
  const sources = getSources(reportJson);
  const artifacts = getArtifacts(reportJson);

  const scoring = {};
  const versionAverages = [];

  for (const version of SCORE_VERSIONS) {
    const scorePath = path.join(scoringDir, `${docId}${version.suffix}`);
    if (!fs.existsSync(scorePath)) {
      scoring[version.key] = {
        available: false,
        file_path: null,
        document_average_score: null,
        claim_count: 0,
        claims: [],
        document_metrics: {},
      };
      continue;
    }

    const scoreJson = readJson(scorePath);
    const summary = version.key === 'v1' ? summarizeV1Scoring(scoreJson) : summarizeV3V4Scoring(scoreJson);
    scoring[version.key] = {
      available: true,
      file_path: path.relative(baseDir, scorePath),
      ...summary,
    };

    if (summary.document_average_score !== null) {
      versionAverages.push(summary.document_average_score);
    }
  }

  const averageScores = {
    v1: scoring.v1.document_average_score,
    v3: scoring.v3.document_average_score,
    v4: scoring.v4.document_average_score,
    across_versions: mean(versionAverages),
  };

  return {
    doc_id: docId,
    report_file: path.relative(baseDir, reportPath),
    source_files: toArray(reportJson?.source_files),
    counts: {
      claims: claims.length,
      sources: sources.length,
      artifacts: artifacts.length,
    },
    average_scores: averageScores,
    scoring,
    raw_data: {
      claims,
      sources,
      artifacts,
    },
  };
}

function main() {
  const baseDir = path.resolve(__dirname, '..');
  const reportsDir = path.join(baseDir, 'docs', 'data', 'reports');
  const scoringDir = path.join(baseDir, 'docs', 'data', 'outputs', 'scoring');
  const outputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(baseDir, 'docs', 'data', 'outputs', 'centralized', 'centralized_scoring_raw_data.json');

  const reportFiles = fs
    .readdirSync(reportsDir)
    .filter((file) => file.endsWith('_report.json'))
    .sort();

  const documents = reportFiles.map((reportFile) =>
    buildDocumentRecord(baseDir, reportsDir, scoringDir, reportFile)
  );

  const totals = documents.reduce(
    (acc, doc) => {
      acc.documents += 1;
      acc.claims += doc.counts.claims;
      acc.sources += doc.counts.sources;
      acc.artifacts += doc.counts.artifacts;
      return acc;
    },
    { documents: 0, claims: 0, sources: 0, artifacts: 0 }
  );

  const documentAverages = documents
    .map((doc) => doc.average_scores.across_versions)
    .filter((value) => value !== null);
  const versionAverageScores = {};
  for (const version of SCORE_VERSIONS) {
    const values = documents
      .map((doc) => doc.average_scores[version.key])
      .filter((value) => value !== null);
    versionAverageScores[version.key] = mean(values);
  }

  const output = {
    generated_at_utc: new Date().toISOString(),
    input: {
      reports_dir: path.relative(baseDir, reportsDir),
      scoring_dir: path.relative(baseDir, scoringDir),
    },
    totals,
    averages: {
      overall_documents_average_score: mean(documentAverages),
      by_scoring_version: versionAverageScores,
    },
    documents,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const relOutput = path.relative(baseDir, outputPath);
  console.log(`Wrote ${relOutput}`);
  console.log(`Documents: ${totals.documents}`);
}

main();

