const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { spawn } = require('child_process');

function createPipelineBackend(options = {}) {
  const appDir = path.resolve(String(options.appDir || process.cwd()));
  const findRepoRoot = () => {
    if (options.repoRoot) return path.resolve(String(options.repoRoot));
    let cur = appDir;
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.resolve(cur, 'annotarium');
      try {
        // eslint-disable-next-line no-sync
        if (require('fs').existsSync(candidate)) return cur;
      } catch (_err) {
        // ignore and continue walking upward
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return path.resolve(appDir, '..', '..');
  };
  const root = findRepoRoot();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  let activeReportPath = '';

  const scriptPath = () => path.resolve(appDir, 'threec_viewer_widget (1).py');
  const annotariumRoot = () => path.resolve(root, 'annotarium');
  const pipelineListPath = () => path.resolve(appDir, 'pipeline_files.json');
  const defaultOutPath = () => path.resolve(appDir, 'reports_results', 'apt1_threec_viewer.html');
  const defaultAggregateOutPath = () => path.resolve(appDir, 'reports_results', 'aggregate_threec_viewer.html');
  const defaultInputPath = () =>
    path.resolve(annotariumRoot(), 'outputs', 'reports', 'apt1_exposing_one_of_china_s_cyber_espionage_units_report.json');
  const apt1PdfPath = () =>
    path.resolve(annotariumRoot(), 'Reports', "Mandiant - 2013 - APT1 Exposing One of China's Cyber Espionage Units.pdf");

  const isoNow = () => new Date().toISOString();
  const slugify = (input) => {
    const base = String(input || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return base || `report_${Date.now()}`;
  };
  const cleanUrlCandidate = (value) => String(value || '').trim().replace(/[),.;:]+$/g, '');
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
  const pdfPageCountCache = new Map();

  const pathExists = async (p) => {
    try {
      await fs.access(p);
      return true;
    } catch (_err) {
      return false;
    }
  };

  const getPdfPageCount = async (pdfPathInput) => {
    const pdfPath = path.resolve(String(pdfPathInput || '').trim());
    if (!pdfPath) return null;
    if (pdfPageCountCache.has(pdfPath)) return pdfPageCountCache.get(pdfPath);
    if (!(await pathExists(pdfPath))) {
      pdfPageCountCache.set(pdfPath, null);
      return null;
    }
    const py = [
      'import sys',
      'p=sys.argv[1]',
      'n=None',
      'try:',
      '  import fitz',
      '  d=fitz.open(p)',
      '  n=d.page_count',
      '  d.close()',
      'except Exception:',
      '  pass',
      'if n is None:',
      '  try:',
      '    from pypdf import PdfReader',
      '    n=len(PdfReader(p).pages)',
      '  except Exception:',
      '    n=None',
      'print(n if n is not None else "")',
    ].join('\n');
    const res = await runCommand('python3', ['-c', py, pdfPath], {
      cwd: root,
      env: process.env,
    });
    const raw = String(res.stdout || '').trim();
    const val = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
    pdfPageCountCache.set(pdfPath, val);
    return val;
  };

  const readDirSafe = async (dir) => {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (_err) {
      return [];
    }
  };

  const discoverReportsPdfPaths = async () => {
    const reportsDir = path.resolve(annotariumRoot(), 'Reports');
    const entries = await readDirSafe(reportsDir);
    return entries
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === '.pdf')
      .map((e) => path.resolve(reportsDir, e.name))
      .sort((a, b) => a.localeCompare(b));
  };

  const resolveExistingReportForPdf = async (pdfPathInput) => {
    const pdfPath = path.resolve(String(pdfPathInput || '').trim());
    if (!pdfPath) return '';
    const reportsDir = path.resolve(annotariumRoot(), 'outputs', 'reports');
    const entries = await readDirSafe(reportsDir);
    const files = entries
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === '.json' && e.name.endsWith('_report.json'))
      .map((e) => path.resolve(reportsDir, e.name));
    if (!files.length) return '';

    const base = path.basename(pdfPath, path.extname(pdfPath));
    const slug = slugify(base);
    const tokens = new Set(slug.split('_').filter((t) => t.length > 1));
    const candidates = new Set([
      `${slug}_report.json`,
      `${slug.replace(/^mandiant_\d{4}_/, '')}_report.json`,
      `mandiant_${slug}_report.json`,
    ]);
    for (const p of files) {
      if (candidates.has(path.basename(p))) return p;
    }

    let best = '';
    let bestScore = -1;
    for (const p of files) {
      const stem = path.basename(p, '_report.json');
      const stoks = stem.split('_').filter((t) => t.length > 1);
      const set = new Set(stoks);
      let overlap = 0;
      for (const t of tokens) if (set.has(t)) overlap += 1;
      const score = overlap / Math.max(1, Math.min(tokens.size, 8));
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore >= 0.45 ? best : '';
  };

  const emit = (runId, payload) => {
    onProgress({
      runId,
      ts: isoNow(),
      ...payload,
    });
  };

  const runCommand = (cmd, args, opts = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd || root,
        env: { ...(opts.env || process.env), PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timeoutMs = Number(opts.timeoutMs || 0);
      let timedOut = false;
      let timeoutHandle = null;
      if (typeof opts.onStart === 'function') {
        try {
          opts.onStart(child.pid);
        } catch (_err) {
          // ignore observer errors
        }
      }
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        const chunk = d.toString();
        stdout += chunk;
        if (typeof opts.onStdout === 'function') opts.onStdout(chunk);
      });
      child.stderr.on('data', (d) => {
        const chunk = d.toString();
        stderr += chunk;
        if (typeof opts.onStderr === 'function') opts.onStderr(chunk);
      });
      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          if (typeof opts.onTimeout === 'function') {
            try {
              opts.onTimeout(timeoutMs);
            } catch (_err) {
              // ignore observer errors
            }
          }
          if (child.exitCode === null && !child.killed) {
            try {
              child.kill('SIGTERM');
            } catch (_err) {
              // ignore
            }
          }
          setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
              try {
                child.kill('SIGKILL');
              } catch (_err) {
                // ignore
              }
            }
          }, 5000);
        }, timeoutMs);
      }
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({ ok: code === 0 && !timedOut, timedOut, code, stdout, stderr, cmd: [cmd, ...args] });
      });
    });

  const runViewerBuild = (inputPath, outPath) =>
    new Promise((resolve, reject) => {
      const args = [scriptPath(), '--no_gui', '--input', inputPath, '--out_html', outPath];
      const child = spawn('python3', args, {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) return resolve({ stdout, stderr, outPath });
        return reject(new Error(`threec_viewer_widget failed (code=${code})\n${stderr || stdout}`));
      });
    });

  const runAggregateViewerBuild = async (reportPaths, outPath) => {
    const deduped = Array.from(new Set((reportPaths || [])
      .map((p) => String(p || '').trim())
      .filter((p) => p.length > 0)
      .map((p) => path.resolve(p))));
    const existing = [];
    const skipped = [];
    for (const p of deduped) {
      if (await pathExists(p)) existing.push(p);
      else skipped.push(p);
    }
    if (!existing.length) {
      throw new Error('No valid report paths provided for aggregate viewer build');
    }
    return new Promise((resolve, reject) => {
      const args = [scriptPath(), '--no_gui', '--out_html', outPath, '--input_multi', ...existing];
      const child = spawn('python3', args, {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) return resolve({ stdout, stderr, outPath, inputs: existing, skipped });
        return reject(new Error(`aggregate threec_viewer_widget failed (code=${code})\n${stderr || stdout}`));
      });
      return undefined;
    });
  };

  const buildPortfolioSummary = async () => {
    const script = path.resolve(annotariumRoot(), 'scripts', 'build_portfolio_summary.py');
    const summaryPath = path.resolve(annotariumRoot(), 'outputs', 'reports', 'portfolio_summary.json');
    const res = await runCommand('python3', [script], {
      cwd: root,
      env: process.env,
      timeoutMs: 180000,
    });
    if (!res.ok) {
      throw new Error(`build_portfolio_summary failed (code=${res.code})\n${res.stderr || res.stdout}`);
    }
    let data = {};
    try {
      data = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    } catch (_err) {
      data = {};
    }
    return {
      path: summaryPath,
      data,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  };

  const buildScoreInputV3 = (extraction) => {
    const docMeta = extraction.document_metadata || {};
    const stage1 = extraction.stage1_markdown_parse || {};
    const stage2 = extraction.stage2_claim_extraction || {};
    const docTitle = String(docMeta.title || 'Untitled document');
    const pubYearRaw = String(docMeta.publication_date || '').slice(0, 4);
    const pubYear = Number.isFinite(Number(pubYearRaw)) ? Number(pubYearRaw) : 0;

    const sourceRaw = ((stage2.document_level_index || {}).sources || (stage1.global_indices || {}).sources || []);
    const sourceRegistry = sourceRaw.map((s, idx) => ({
      source_id: String(s.source_id || `SRC${String(idx + 1).padStart(4, '0')}`),
      url: cleanUrlCandidate(s.url_or_identifier || ''),
      title: String(s.title || s.publication_or_venue || s.source_id || 'source'),
      source_type: String(s.source_type || ''),
      entity_name: String(s.entity_name || ''),
      publication_or_venue: String(s.publication_or_venue || ''),
      authors: [],
      year: Number.isFinite(Number(s.year)) ? Number(s.year) : pubYear,
    }));

    const pages = (stage1.pages || []).map((p, pIdx) => ({
      text_blocks: (p.text_blocks || []).map((b, bIdx) => ({
        anchor_id: String(b.block_id || `P${String(pIdx).padStart(3, '0')}-B${String(bIdx + 1).padStart(2, '0')}`),
        content: String(b.text_verbatim || ''),
      })),
      citations_found: (p.citations_found || [])
        .map((c, cIdx) => {
          const a = c.anchor || {};
          const l = a.location || {};
          return {
            intext_anchor_id: String(a.anchor_id || l.object_id || `P${String(pIdx).padStart(3, '0')}-A${String(cIdx + 1).padStart(3, '0')}`),
            raw_identifier: cleanUrlCandidate(c.raw_identifier || c.normalized_identifier || ''),
            resolved_source_id: String(c.resolved_source_id || ''),
          };
        })
        .filter((x) => x.resolved_source_id),
    }));

    const claims = (stage2.attribution_claims || []).map((c, idx) => {
      const st = c.claim_statement || {};
      const cid = String(c.claim_id || `C${String(idx + 1).padStart(3, '0')}`);
      const text = String(st.verbatim_text || st.text || '').trim();
      return {
        claim_id: cid,
        allegation_gravity: 'medium',
        claim_statement: {
          anchor_id: String(st.anchor_id || `${cid}-A001`),
          text: text || 'Claim text unavailable in extraction output.',
        },
      };
    });

    return { doc_id: docTitle, source_registry: sourceRegistry, stage1_markdown_parse: { pages }, stage2_claim_extraction: { attribution_claims: claims } };
  };

  const parseMarkdownImageRefs = (markdownText) => {
    const refs = [];
    const re = /!\[[^\]]*]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(String(markdownText || ''))) !== null) {
      const ref = String(m[1] || '').trim().replace(/^["']|["']$/g, '');
      if (ref) refs.push(ref);
    }
    return refs;
  };

  const flattenTables = (extractionObj) => {
    const pages = ((extractionObj || {}).stage1_markdown_parse || {}).pages || [];
    const out = [];
    for (const p of pages) {
      const pageIndex = p.page_index ?? null;
      for (const t of p.tables || []) {
        out.push({
          page_index: pageIndex,
          object_id: t.object_id || '',
          section_heading: ((t.location || {}).section_heading) || '',
          caption_verbatim: t.caption_verbatim || '',
          table_markdown: t.table_markdown || '',
          table_text_verbatim: t.table_text_verbatim || '',
          notes: t.notes || '',
          raw: t,
        });
      }
    }
    return out;
  };

  const flattenFigures = (extractionObj) => {
    const pages = ((extractionObj || {}).stage1_markdown_parse || {}).pages || [];
    const out = [];
    for (const p of pages) {
      const pageIndex = p.page_index ?? null;
      for (const f of p.figures_images || []) {
        out.push({
          page_index: pageIndex,
          object_id: f.object_id || '',
          section_heading: ((f.location || {}).section_heading) || '',
          image_ref: f.image_ref || '',
          caption_verbatim: f.caption_verbatim || '',
          alt_text: f.alt_text || '',
          analyst_description: f.analyst_description || '',
          notes: f.notes || '',
          raw: f,
        });
      }
    }
    return out;
  };

  const normToken = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const similarityScore = (title, candidateName) => {
    const a = normToken(title).split(/\s+/).filter((t) => t.length >= 3);
    const b = normToken(candidateName).split(/\s+/).filter((t) => t.length >= 3);
    if (!a.length || !b.length) return 0;
    const bSet = new Set(b);
    let hits = 0;
    for (const t of a) if (bSet.has(t)) hits += 1;
    return hits / Math.max(3, Math.min(8, a.length));
  };

  const inferSourcePdfMd = async (reportObj) => {
    const reportsDir = path.resolve(annotariumRoot(), 'Reports');
    const entries = await readDirSafe(reportsDir);
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const title = ((reportObj || {}).raw_extraction || {}).document_metadata?.title || ((reportObj || {}).report_id || '');

    let bestPdf = '';
    let bestPdfScore = -1;
    let bestMd = '';
    let bestMdScore = -1;
    for (const name of files) {
      const ext = path.extname(name).toLowerCase();
      const s = similarityScore(title, name);
      if (ext === '.pdf' && s > bestPdfScore) {
        bestPdfScore = s;
        bestPdf = path.resolve(reportsDir, name);
      }
      if (ext === '.md' && s > bestMdScore) {
        bestMdScore = s;
        bestMd = path.resolve(reportsDir, name);
      }
    }
    return {
      pdfPath: bestPdfScore > 0 ? bestPdf : '',
      markdownPath: bestMdScore > 0 ? bestMd : '',
    };
  };

  const discoverImageFiles = async (dirs) => {
    const out = [];
    for (const dir of dirs) {
      const entries = await readDirSafe(dir);
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!imageExts.has(ext)) continue;
        out.push(path.resolve(dir, e.name));
      }
    }
    return Array.from(new Set(out));
  };

  const buildEnrichment = async ({ extractionObj, markdownPath = '', pdfPath = '' }) => {
    const markdownExists = markdownPath ? await pathExists(markdownPath) : false;
    const markdownText = markdownExists ? await fs.readFile(markdownPath, 'utf-8') : '';
    const imageRefs = parseMarkdownImageRefs(markdownText);
    const tables = flattenTables(extractionObj);
    const figures = flattenFigures(extractionObj);
    const artifacts = ((((extractionObj || {}).stage1_markdown_parse || {}).global_indices || {}).artifacts || []);

    const candidateDirs = new Set();
    if (markdownPath) candidateDirs.add(path.dirname(markdownPath));
    if (pdfPath) {
      const pdfDir = path.dirname(pdfPath);
      candidateDirs.add(pdfDir);
      const pdfBase = path.basename(pdfPath, path.extname(pdfPath));
      const entries = await readDirSafe(pdfDir);
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith(pdfBase) && e.name.includes('.mistral_images')) {
          candidateDirs.add(path.resolve(pdfDir, e.name));
        }
      }
    }

    const imageFiles = await discoverImageFiles(Array.from(candidateDirs));
    const byBaseName = new Map(imageFiles.map((p) => [path.basename(p).toLowerCase(), p]));
    const resolvedRefs = imageRefs.map((r) => {
      const b = path.basename(r).toLowerCase();
      const hit = byBaseName.get(b) || '';
      return { ref: r, resolved_path: hit };
    });

    const figureWithPaths = [];
    for (let i = 0; i < figures.length; i += 1) {
      const f = figures[i];
      let resolved = '';
      const imgRefBase = path.basename(String(f.image_ref || '')).toLowerCase();
      if (imgRefBase && byBaseName.has(imgRefBase)) resolved = byBaseName.get(imgRefBase);
      if (!resolved && resolvedRefs[i] && resolvedRefs[i].resolved_path) resolved = resolvedRefs[i].resolved_path;
      if (!resolved && imageFiles[i]) resolved = imageFiles[i];
      figureWithPaths.push({
        ...f,
        resolved_image_path: resolved || '',
      });
    }

    const artifactLinks = artifacts.map((a) => {
      const type = String(a.artifact_type || '').toLowerCase();
      const values = Array.isArray(a.example_values) ? a.example_values.map((v) => String(v).toLowerCase()) : [];
      const hit = (txt) => {
        const t = String(txt || '').toLowerCase();
        if (!t) return false;
        if (type && t.includes(type)) return true;
        for (const v of values) if (v && t.includes(v)) return true;
        return false;
      };

      const tableIds = [];
      const figureIds = [];
      for (const t of tables) {
        const blob = [t.caption_verbatim, t.table_markdown, t.table_text_verbatim, t.notes].join(' ');
        if (hit(blob)) tableIds.push(t.object_id || '');
      }
      for (const f of figureWithPaths) {
        const blob = [f.caption_verbatim, f.alt_text, f.analyst_description, f.notes].join(' ');
        if (hit(blob)) figureIds.push(f.object_id || '');
      }
      const imagePaths = figureWithPaths
        .filter((f) => figureIds.includes(f.object_id || ''))
        .map((f) => f.resolved_image_path)
        .filter(Boolean);

      return {
        artifact_type: a.artifact_type || '',
        count: a.count ?? 0,
        linked_table_ids: Array.from(new Set(tableIds.filter(Boolean))),
        linked_figure_ids: Array.from(new Set(figureIds.filter(Boolean))),
        linked_image_paths: Array.from(new Set(imagePaths)),
      };
    });

    return {
      markdown: {
        path: markdownPath || '',
        image_refs: imageRefs,
      },
      images: imageFiles.map((p) => ({
        path: p,
        file_name: path.basename(p),
      })),
      tables,
      figures: figureWithPaths,
      artifact_links: artifactLinks,
      stats: {
        image_count: imageFiles.length,
        table_count: tables.length,
        figure_count: figures.length,
      },
    };
  };

  const ensurePipelineFileList = async () => {
    const cfgPath = pipelineListPath();
    let parsed = null;
    try {
      parsed = JSON.parse(await fs.readFile(cfgPath, 'utf-8'));
    } catch (_err) {
      parsed = null;
    }

    const defaultEntry = {
      id: slugify(path.basename(apt1PdfPath(), path.extname(apt1PdfPath()))),
      label: path.basename(apt1PdfPath()),
      pdfPath: apt1PdfPath(),
      reportPath: defaultInputPath(),
      lastRunAt: null,
      lastStatus: null,
    };
    if (!parsed || !Array.isArray(parsed.files)) {
      const out = { files: [defaultEntry] };
      await fs.writeFile(cfgPath, `${JSON.stringify(out, null, 2)}\n`, 'utf-8');
      return out.files;
    }

    const byPdf = new Map();
    for (const row of parsed.files) {
      if (!row || typeof row !== 'object') continue;
      const pdfPath = String(row.pdfPath || '').trim();
      if (!pdfPath) continue;
      byPdf.set(path.resolve(pdfPath), {
        id: String(row.id || slugify(path.basename(pdfPath, path.extname(pdfPath)))),
        label: String(row.label || path.basename(pdfPath)),
        pdfPath: path.resolve(pdfPath),
        reportPath: row.reportPath ? path.resolve(row.reportPath) : '',
        lastRunAt: row.lastRunAt || null,
        lastStatus: row.lastStatus || null,
      });
    }
    if (!byPdf.has(path.resolve(apt1PdfPath()))) byPdf.set(path.resolve(apt1PdfPath()), defaultEntry);

    const out = { files: Array.from(byPdf.values()).sort((a, b) => a.label.localeCompare(b.label)) };
    await fs.writeFile(cfgPath, `${JSON.stringify(out, null, 2)}\n`, 'utf-8');
    return out.files;
  };

  const updatePipelineFileEntry = async (pdfPath, patch) => {
    const files = await ensurePipelineFileList();
    const abs = path.resolve(pdfPath);
    const next = files.map((f) => (path.resolve(f.pdfPath) === abs ? { ...f, ...patch } : f));
    await fs.writeFile(pipelineListPath(), `${JSON.stringify({ files: next }, null, 2)}\n`, 'utf-8');
    return next;
  };

  const addPdfPaths = async (pathsToAdd) => {
    const files = await ensurePipelineFileList();
    const map = new Map(files.map((f) => [path.resolve(f.pdfPath), f]));
    let added = 0;
    for (const p of pathsToAdd || []) {
      const abs = path.resolve(p);
      if (map.has(abs)) continue;
      added += 1;
      map.set(abs, { id: slugify(path.basename(abs, path.extname(abs))), label: path.basename(abs), pdfPath: abs, reportPath: '', lastRunAt: null, lastStatus: null });
    }
    const payload = { files: Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label)) };
    await fs.writeFile(pipelineListPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    return { added, files: payload.files };
  };

  const readReportJson = async (reportPath = '') => {
    const p = path.resolve(reportPath || activeReportPath || defaultInputPath());
    activeReportPath = p;
    return { path: p, data: JSON.parse(await fs.readFile(p, 'utf-8')) };
  };

  const writeReportJson = async (data, reportPath = '') => {
    const p = path.resolve(reportPath || activeReportPath || defaultInputPath());
    activeReportPath = p;
    await fs.writeFile(p, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    return { path: p };
  };

  const runPipelineForPdf = async (pdfPathInput, runIdInput = '', opts = {}) => {
    const pdfPath = path.resolve(String(pdfPathInput || '').trim());
    if (!pdfPath) throw new Error('Missing PDF path');
    const runId = String(runIdInput || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const slug = slugify(path.basename(pdfPath, path.extname(pdfPath)));
    const outputsRoot = path.resolve(annotariumRoot(), 'outputs');
    const runDir = path.resolve(outputsRoot, 'pipeline', slug);
    const reportsDir = path.resolve(outputsRoot, 'reports');
    const scoringDir = path.resolve(outputsRoot, 'scoring');
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.mkdir(scoringDir, { recursive: true });

    const markdownPath = path.resolve(runDir, `${slug}.md`);
    const extractionPath = path.resolve(runDir, `${slug}.output.json`);
    const validationJsonPath = path.resolve(runDir, `${slug}.validation_report.json`);
    const validationMdPath = path.resolve(runDir, `${slug}.validation_report.md`);
    const fullScorePath = path.resolve(scoringDir, `${slug}.icj_score_report.json`);
    const scoreInputV3Path = path.resolve(runDir, `${slug}.score_input_v3.json`);
    const scoreV3Path = path.resolve(scoringDir, `${slug}.icj_score_report_v3.json`);
    const scoreV4Path = path.resolve(scoringDir, `${slug}.icj_score_report_v4.json`);
    const reportPath = path.resolve(reportsDir, `${slug}_report.json`);
    const outHtmlPath = path.resolve(appDir, 'reports_results', `${slug}_threec_viewer.html`);

    const schemaPath = path.resolve(annotariumRoot(), 'cyber_attribution_markdown_extraction_v2_schema.json');
    const processPdfScript = path.resolve(root, 'my-electron-app', 'scripts', 'process_pdf_mistral_ocr.py');
    const extractScript = path.resolve(annotariumRoot(), 'apply_schema_extraction_offline.py');
    const inferInstitutionsScript = path.resolve(annotariumRoot(), 'infer_source_institutions.py');
    const validateScript = path.resolve(annotariumRoot(), 'validate_score_extraction.py');
    const fullScoreScript = path.resolve(annotariumRoot(), 'score_icj.py');
    const v3ScoreScript = path.resolve(annotariumRoot(), 'score_icj_v2.py');
    const v4ScoreScript = path.resolve(annotariumRoot(), 'score_icj_v4.py');
    const env = { ...process.env, ANNOTARIUM_HOME: annotariumRoot() };
    if (opts && opts.batchMode) {
      env.ANNOTARIUM_BATCH_MODE = '1';
      env.ANNOTARIUM_MISTRAL_BATCH = '1';
      env.ANNOTARIUM_OPENAI_BATCH = '1';
    }
    const stages = [];

    const runStage = async (stageId, cmd, args, output, stageOpts = {}) => {
      const startedAtMs = Date.now();
      let heartbeatTimer = null;
      const heartbeatEveryMs = 15000;
      emit(runId, { event: 'stage_started', stageId, pdfPath, cmd: [cmd, ...args] });
      const res = await runCommand(cmd, args, {
        cwd: root,
        env,
        timeoutMs: Number(stageOpts.timeoutMs || 0),
        onStart: (pid) => {
          emit(runId, { event: 'stage_pid', stageId, pdfPath, pid: Number(pid || 0) });
          heartbeatTimer = setInterval(() => {
            const elapsedSec = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
            const hint = stageId === '01_pdf_to_md'
              ? 'waiting on OCR/provider response or local PDF extraction'
              : 'processing';
            emit(runId, {
              event: 'stage_heartbeat',
              stageId,
              pdfPath,
              elapsed_sec: elapsedSec,
              hint,
            });
          }, heartbeatEveryMs);
        },
        onTimeout: (timeoutMs) => {
          emit(runId, {
            event: 'stage_warning',
            stageId,
            pdfPath,
            message: `Stage timeout reached (${Math.round(Number(timeoutMs || 0) / 1000)}s). Killing process.`,
          });
        },
        onStdout: (chunk) => emit(runId, { event: 'stage_log', stageId, pdfPath, stream: 'stdout', chunk }),
        onStderr: (chunk) => emit(runId, { event: 'stage_log', stageId, pdfPath, stream: 'stderr', chunk }),
      });
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      stages.push({ id: stageId, ...res, output });
      emit(runId, { event: 'stage_finished', stageId, pdfPath, ok: res.ok, timedOut: !!res.timedOut, code: res.code, output });
      return res;
    };

    const sanitizeExtractionForSchema = async (extractionJsonPath) => {
      const raw = await fs.readFile(extractionJsonPath, 'utf-8');
      const obj = JSON.parse(raw);
      if (
        obj
        && typeof obj === 'object'
        && obj.pipeline_config
        && typeof obj.pipeline_config === 'object'
        && Object.prototype.hasOwnProperty.call(obj.pipeline_config, 'institution_inference')
      ) {
        delete obj.pipeline_config.institution_inference;
        await fs.writeFile(extractionJsonPath, `${JSON.stringify(obj, null, 2)}\n`, 'utf-8');
      }
    };

    emit(runId, { event: 'pipeline_started', pdfPath, slug });
    const stage01TimeoutMs = Number(process.env.ANNOTARIUM_STAGE01_TIMEOUT_MS || 480000);
    const s1 = await runStage(
      '01_pdf_to_md',
      'python3',
      [processPdfScript, pdfPath, '--write-full-text-md', markdownPath],
      markdownPath,
      { timeoutMs: stage01TimeoutMs },
    );
    if (!s1.ok) {
      if (s1.timedOut) {
        emit(runId, {
          event: 'stage_warning',
          stageId: '01_pdf_to_md',
          pdfPath,
          message: 'Primary PDF->Markdown timed out. Running offline fallback extraction.',
        });
        const s1b = await runStage(
          '01b_pdf_to_md_offline_fallback',
          'python3',
          [processPdfScript, pdfPath, '--write-full-text-md', markdownPath, '--offline-only', '--no-cache'],
          markdownPath,
          { timeoutMs: 180000 },
        );
        if (!s1b.ok) throw new Error(`PDF->Markdown offline fallback failed\n${s1b.stderr || s1b.stdout}`);
        emit(runId, {
          event: 'stage_warning',
          stageId: '01_pdf_to_md',
          pdfPath,
          message: 'Offline fallback extraction completed after timeout.',
        });
      } else {
        throw new Error(`PDF->Markdown failed\n${s1.stderr || s1.stdout}`);
      }
    }
    const s2 = await runStage('02_schema_extraction', 'python3', [extractScript, '--schema', schemaPath, '--markdown', markdownPath, '--output', extractionPath], extractionPath);
    if (!s2.ok) throw new Error(`Schema extraction failed\n${s2.stderr || s2.stdout}`);
    const s2b = await runStage('02b_source_inference', 'python3', [inferInstitutionsScript, '--input', extractionPath], extractionPath);
    if (!s2b.ok) {
      emit(runId, { event: 'stage_warning', stageId: '02b_source_inference', pdfPath, message: 'Institution inference failed; continuing with extracted sources.' });
    }
    await sanitizeExtractionForSchema(extractionPath);
    const s3 = await runStage('03_validation', 'python3', [validateScript, '--schema', schemaPath, '--markdown', markdownPath, '--output', extractionPath, '--report-json', validationJsonPath, '--report-md', validationMdPath], validationJsonPath);
    if (!s3.ok) {
      const hasValidationJson = await pathExists(validationJsonPath);
      if (!hasValidationJson) {
        throw new Error(`Validation failed\n${s3.stderr || s3.stdout}`);
      }
      emit(runId, {
        event: 'stage_warning',
        stageId: '03_validation',
        pdfPath,
        message: 'Validation returned FAIL certification; continuing with scoring and figures.',
      });
    }
    const s4 = await runStage('04_score_full_icj', 'python3', [fullScoreScript, '--input', extractionPath, '--output', fullScorePath], fullScorePath);
    if (!s4.ok) throw new Error(`Full ICJ scoring failed\n${s4.stderr || s4.stdout}`);

    const extractionObj = JSON.parse(await fs.readFile(extractionPath, 'utf-8'));
    const scoreInputV3 = buildScoreInputV3(extractionObj);
    await fs.writeFile(scoreInputV3Path, `${JSON.stringify(scoreInputV3, null, 2)}\n`, 'utf-8');

    let scoreV3Obj = null;
    const s5 = await runStage('05_score_icj_v3', 'python3', [v3ScoreScript, '--input', scoreInputV3Path, '--output', scoreV3Path], scoreV3Path);
    if (s5.ok) {
      scoreV3Obj = JSON.parse(await fs.readFile(scoreV3Path, 'utf-8'));
    } else {
      emit(runId, { event: 'stage_warning', stageId: '05_score_icj_v3', pdfPath, message: 'ICJ v3 stage failed; continuing with full_icj output.' });
    }
    let scoreV4Obj = null;
    const s5b = await runCommand('python3', [v4ScoreScript, '--input', scoreInputV3Path, '--output', scoreV4Path], {
      cwd: root,
      env,
    });
    if (s5b.ok) {
      scoreV4Obj = JSON.parse(await fs.readFile(scoreV4Path, 'utf-8'));
    } else {
      emit(runId, { event: 'stage_warning', stageId: '05_score_icj_v4', pdfPath, message: 'ICJ v4 stage failed; continuing with v3/full_icj output.' });
    }

    const fullScoreObj = JSON.parse(await fs.readFile(fullScorePath, 'utf-8'));
    const validationObj = JSON.parse(await fs.readFile(validationJsonPath, 'utf-8'));
    const reportObj = {
      report_id: `${slug}_report`,
      generated_at_utc: isoNow(),
      source_files: {
        pdf: pdfPath,
        markdown: markdownPath,
        raw_extraction: extractionPath,
        validation_report_json: validationJsonPath,
        validation_report_md: validationMdPath,
        full_scores: fullScorePath,
        score_input_v3: scoreInputV3Path,
        full_scores_v3: scoreV3Path,
        full_scores_v4: scoreV4Path,
      },
      raw_extraction: extractionObj,
      score_input_v3: scoreInputV3,
      scores: {
        full_icj: fullScoreObj,
        full_icj_v3: scoreV3Obj,
        full_icj_v4: scoreV4Obj,
      },
    };
    reportObj.enrichment = await buildEnrichment({
      extractionObj,
      markdownPath,
      pdfPath,
    });
    await fs.writeFile(reportPath, `${JSON.stringify(reportObj, null, 2)}\n`, 'utf-8');

    emit(runId, { event: 'stage_started', stageId: '06_figures', pdfPath, cmd: ['python3', scriptPath(), '--no_gui', '--input', reportPath, '--out_html', outHtmlPath] });
    const fig = await runViewerBuild(reportPath, outHtmlPath);
    stages.push({ id: '06_figures', ok: true, code: 0, stdout: fig.stdout, stderr: fig.stderr, output: outHtmlPath, cmd: ['python3', scriptPath(), '--no_gui', '--input', reportPath, '--out_html', outHtmlPath] });
    emit(runId, { event: 'stage_finished', stageId: '06_figures', pdfPath, ok: true, code: 0, output: outHtmlPath });

    await updatePipelineFileEntry(pdfPath, {
      reportPath,
      lastRunAt: isoNow(),
      lastStatus: validationObj.certification || 'PASS',
    });

    activeReportPath = reportPath;
    emit(runId, { event: 'pipeline_completed', pdfPath, reportPath, outHtmlPath, certification: validationObj.certification || 'UNKNOWN', overall_score: validationObj.overall_score ?? null });
    return {
      runId,
      pdfPath,
      reportPath,
      outHtmlPath,
      validation: {
        certification: validationObj.certification || 'UNKNOWN',
        overall_score: validationObj.overall_score ?? null,
        summary_counts: validationObj.summary_counts || {},
        category_scores: validationObj.category_scores || {},
      },
      stages: stages.map((s) => ({
        id: s.id,
        ok: s.ok,
        code: s.code,
        output: s.output,
        stdout_tail: String(s.stdout || '').slice(-1200),
        stderr_tail: String(s.stderr || '').slice(-1200),
        cmd: s.cmd || [],
      })),
    };
  };

  const bootstrapReports = async (options = {}) => {
    const autoRunMissing = options.autoRunMissing !== false;
    const discoveredPdfs = await discoverReportsPdfPaths();
    if (discoveredPdfs.length > 0) {
      await addPdfPaths(discoveredPdfs);
    } else {
      await ensurePipelineFileList();
    }

    let files = (await getFileList()).files;
    for (const file of files) {
      const reportExists = file.reportPath ? await pathExists(path.resolve(file.reportPath)) : false;
      if (reportExists) continue;
      const resolved = await resolveExistingReportForPdf(file.pdfPath);
      if (!resolved) continue;
      await updatePipelineFileEntry(file.pdfPath, {
        reportPath: resolved,
        lastStatus: file.lastStatus || 'READY',
      });
    }

    files = (await getFileList()).files;
    const missing = files.filter((f) => !f.reportPath || !fsSync.existsSync(path.resolve(f.reportPath)));
    const runs = [];
    if (autoRunMissing && missing.length > 0) {
      const batchMode = missing.length > 1;
      const batchRunId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      emit(batchRunId, {
        event: 'batch_started',
        stageId: 'batch',
        total: missing.length,
        batchMode,
        message: `Starting batch pipeline for ${missing.length} PDF(s).`,
      });
      for (let i = 0; i < missing.length; i += 1) {
        const file = missing[i];
        const runId = `autorun_${Date.now()}_${String(i + 1).padStart(2, '0')}`;
        emit(batchRunId, {
          event: 'batch_file_started',
          stageId: 'batch',
          index: i + 1,
          total: missing.length,
          pdfPath: file.pdfPath,
          runIdChild: runId,
          message: `Running ${i + 1}/${missing.length}: ${file.label || file.pdfPath}`,
        });
        try {
          const result = await runPipelineForPdf(file.pdfPath, runId, { batchMode });
          runs.push({ ok: true, pdfPath: file.pdfPath, reportPath: result.reportPath, runId });
          emit(batchRunId, {
            event: 'batch_file_finished',
            stageId: 'batch',
            index: i + 1,
            total: missing.length,
            pdfPath: file.pdfPath,
            runIdChild: runId,
            ok: true,
            reportPath: result.reportPath,
          });
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          runs.push({ ok: false, pdfPath: file.pdfPath, runId, error: err && err.message ? err.message : String(err) });
          emit(batchRunId, {
            event: 'batch_file_finished',
            stageId: 'batch',
            index: i + 1,
            total: missing.length,
            pdfPath: file.pdfPath,
            runIdChild: runId,
            ok: false,
            message,
          });
        }
      }
      const okCount = runs.filter((r) => !!r.ok).length;
      const failCount = runs.length - okCount;
      emit(batchRunId, {
        event: 'batch_completed',
        stageId: 'batch',
        total: missing.length,
        okCount,
        failCount,
        message: `Batch pipeline finished: ok=${okCount}, fail=${failCount}`,
      });
    }

    return {
      discoveredPdfCount: discoveredPdfs.length,
      missingBeforeRun: missing.length,
      ran: runs.length,
      batchMode: missing.length > 1,
      runs,
      files: (await getFileList()).files,
    };
  };

  const rescoreReport = async (reportPathInput = '') => {
    const reportPath = path.resolve(String(reportPathInput || activeReportPath || defaultInputPath()));
    const reportObj = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
    const extractionObj = reportObj.raw_extraction;
    if (!extractionObj || typeof extractionObj !== 'object') {
      throw new Error('Cannot rescore: report.raw_extraction is missing');
    }

    const outputsRoot = path.resolve(annotariumRoot(), 'outputs');
    const scoringDir = path.resolve(outputsRoot, 'scoring');
    const pipelineDir = path.resolve(outputsRoot, 'pipeline');
    await fs.mkdir(scoringDir, { recursive: true });
    await fs.mkdir(pipelineDir, { recursive: true });

    const baseStem = path.basename(reportPath, '.json').replace(/_report$/i, '');
    const slug = slugify(baseStem);
    const runDir = path.resolve(pipelineDir, slug);
    await fs.mkdir(runDir, { recursive: true });

    let sourcePdfPath = reportObj?.source_files?.pdf ? path.resolve(String(reportObj.source_files.pdf)) : '';
    let sourceMarkdownPath = reportObj?.source_files?.markdown ? path.resolve(String(reportObj.source_files.markdown)) : '';
    if ((!sourcePdfPath || !sourceMarkdownPath)) {
      const inferred = await inferSourcePdfMd(reportObj);
      sourcePdfPath = sourcePdfPath || inferred.pdfPath;
      sourceMarkdownPath = sourceMarkdownPath || inferred.markdownPath;
    }

    const rawCandidate = reportObj?.source_files?.raw_extraction ? path.resolve(String(reportObj.source_files.raw_extraction)) : '';
    const useRawCandidate = rawCandidate && rawCandidate.includes(`${path.sep}outputs${path.sep}`) && (await pathExists(rawCandidate));
    const extractionPath = useRawCandidate ? rawCandidate : path.resolve(runDir, `${slug}.output.json`);
    const fullScorePath = path.resolve(scoringDir, `${slug}.icj_score_report.json`);
    const scoreInputV3Path = path.resolve(runDir, `${slug}.score_input_v3.json`);
    const scoreV3Path = path.resolve(scoringDir, `${slug}.icj_score_report_v3.json`);
    const scoreV4Path = path.resolve(scoringDir, `${slug}.icj_score_report_v4.json`);
    const outHtmlPath = path.resolve(appDir, 'reports_results', `${slug}_threec_viewer.html`);
    const fullScoreScript = path.resolve(annotariumRoot(), 'score_icj.py');
    const v3ScoreScript = path.resolve(annotariumRoot(), 'score_icj_v2.py');
    const v4ScoreScript = path.resolve(annotariumRoot(), 'score_icj_v4.py');
    const inferInstitutionsScript = path.resolve(annotariumRoot(), 'infer_source_institutions.py');
    const env = { ...process.env, ANNOTARIUM_HOME: annotariumRoot() };

    await fs.writeFile(extractionPath, `${JSON.stringify(extractionObj, null, 2)}\n`, 'utf-8');
    const inferRes = await runCommand('python3', [inferInstitutionsScript, '--input', extractionPath], {
      cwd: root,
      env,
    });
    const scoringExtractionObj = inferRes.ok
      ? JSON.parse(await fs.readFile(extractionPath, 'utf-8'))
      : extractionObj;

    const fullRes = await runCommand('python3', [fullScoreScript, '--input', extractionPath, '--output', fullScorePath], {
      cwd: root,
      env,
    });
    if (!fullRes.ok) {
      throw new Error(`Rescore failed (full_icj)\n${fullRes.stderr || fullRes.stdout}`);
    }

    const scoreInputV3 = buildScoreInputV3(scoringExtractionObj);
    await fs.writeFile(scoreInputV3Path, `${JSON.stringify(scoreInputV3, null, 2)}\n`, 'utf-8');
    const v3Res = await runCommand('python3', [v3ScoreScript, '--input', scoreInputV3Path, '--output', scoreV3Path], {
      cwd: root,
      env,
    });
    const v4Res = await runCommand('python3', [v4ScoreScript, '--input', scoreInputV3Path, '--output', scoreV4Path], {
      cwd: root,
      env,
    });

    const fullScoreObj = JSON.parse(await fs.readFile(fullScorePath, 'utf-8'));
    const v3Obj = v3Res.ok ? JSON.parse(await fs.readFile(scoreV3Path, 'utf-8')) : null;
    const v4Obj = v4Res.ok ? JSON.parse(await fs.readFile(scoreV4Path, 'utf-8')) : null;

    reportObj.generated_at_utc = isoNow();
    reportObj.source_files = {
      ...(reportObj.source_files || {}),
      pdf: sourcePdfPath || (reportObj?.source_files?.pdf || ''),
      markdown: sourceMarkdownPath || (reportObj?.source_files?.markdown || ''),
      raw_extraction: extractionPath,
      full_scores: fullScorePath,
      score_input_v3: scoreInputV3Path,
      full_scores_v3: scoreV3Path,
      full_scores_v4: scoreV4Path,
    };
    reportObj.score_input_v3 = scoreInputV3;
    reportObj.enrichment = await buildEnrichment({
      extractionObj: scoringExtractionObj,
      markdownPath: sourceMarkdownPath || '',
      pdfPath: sourcePdfPath || '',
    });
    reportObj.raw_extraction = scoringExtractionObj;
    reportObj.scores = {
      ...(reportObj.scores || {}),
      full_icj: fullScoreObj,
      full_icj_v3: v3Obj,
      full_icj_v4: v4Obj,
    };
    await fs.writeFile(reportPath, `${JSON.stringify(reportObj, null, 2)}\n`, 'utf-8');

    const fig = await runViewerBuild(reportPath, outHtmlPath);
    activeReportPath = reportPath;

    return {
      reportPath,
      outHtmlPath,
      fullScorePath,
      scoreInputV3Path,
      scoreV3Path,
      scoreV4Path,
      v3Ok: v3Res.ok,
      v4Ok: v4Res.ok,
      stdout: {
        full: fullRes.stdout,
        v3: v3Res.stdout,
        v4: v4Res.stdout,
        figures: fig.stdout,
      },
      stderr: {
        full: fullRes.stderr,
        v3: v3Res.stderr,
        v4: v4Res.stderr,
        figures: fig.stderr,
      },
    };
  };

  const summarizeReportMetadata = async (reportPathInput) => {
    const reportPath = path.resolve(String(reportPathInput || '').trim());
    if (!reportPath || !(await pathExists(reportPath))) return null;
    try {
      const rootObj = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const raw = rootObj.raw_extraction || {};
      const stage1 = raw.stage1_markdown_parse || {};
      const stage2 = raw.stage2_claim_extraction || {};
      const enrichment = rootObj.enrichment || {};
      const pages = Array.isArray(stage1.pages) ? stage1.pages : [];
      const extractedPageCount = pages.length;
      const sourcePdfPath = rootObj?.source_files?.pdf ? path.resolve(String(rootObj.source_files.pdf)) : '';
      const pdfPageCount = sourcePdfPath ? await getPdfPageCount(sourcePdfPath) : null;
      const pageCount = Number.isFinite(Number(pdfPageCount)) && Number(pdfPageCount) > 0
        ? Number(pdfPageCount)
        : extractedPageCount;
      const tableCount = Number((enrichment.stats || {}).table_count ?? pages.reduce((n, p) => n + ((p.tables || []).length || 0), 0));
      const figureCount = Number((enrichment.stats || {}).figure_count ?? pages.reduce((n, p) => n + ((p.figures_images || []).length || 0), 0));
      const imageCount = Number((enrichment.stats || {}).image_count ?? ((enrichment.images || []).length || 0));
      const sources = ((((stage1 || {}).global_indices || {}).sources) || []);
      const artifacts = ((((stage1 || {}).global_indices || {}).artifacts) || []);
      const claims = ((stage2 || {}).attribution_claims) || [];
      let validationCertification = 'UNKNOWN';
      let validationOverallScore = null;
      const validationPath = rootObj?.source_files?.validation_report_json
        ? path.resolve(String(rootObj.source_files.validation_report_json))
        : '';
      if (validationPath && await pathExists(validationPath)) {
        try {
          const vr = JSON.parse(await fs.readFile(validationPath, 'utf-8'));
          validationCertification = String(vr.certification || 'UNKNOWN').toUpperCase();
          validationOverallScore = Number.isFinite(Number(vr.overall_score)) ? Number(vr.overall_score) : null;
        } catch (_err) {
          // ignore malformed validation file and keep defaults
        }
      }
      return {
        pages: pageCount,
        extracted_pages: extractedPageCount,
        pdf_pages: Number.isFinite(Number(pdfPageCount)) ? Number(pdfPageCount) : null,
        tables: tableCount,
        figures: figureCount,
        images: imageCount,
        claims: Array.isArray(claims) ? claims.length : 0,
        sources: Array.isArray(sources) ? sources.length : 0,
        artifacts: Array.isArray(artifacts) ? artifacts.length : 0,
        validation_certification: validationCertification,
        validation_overall_score: validationOverallScore,
      };
    } catch (_err) {
      return null;
    }
  };

  const getFileList = async () => {
    const files = await ensurePipelineFileList();
    const withMeta = await Promise.all(
      files.map(async (f) => {
        const reportPath = f.reportPath ? path.resolve(f.reportPath) : '';
        const reportExists = !!reportPath && await pathExists(reportPath);
        const metadata = reportExists ? await summarizeReportMetadata(reportPath) : null;
        const persisted = String(f.lastStatus || '').toUpperCase();
        const readinessStatus = reportExists ? 'READY' : 'MISSING';
        let validationStatus = metadata?.validation_certification || '';
        if (!validationStatus || validationStatus === 'UNKNOWN') {
          if (persisted === 'PASS' || persisted === 'FAIL' || persisted === 'WARNING' || persisted === 'WARN') {
            validationStatus = persisted === 'WARN' ? 'WARNING' : persisted;
          } else {
            validationStatus = reportExists ? 'UNKNOWN' : 'N/A';
          }
        }
        return {
          ...f,
          reportPath: reportExists ? reportPath : '',
          metadata,
          readinessStatus,
          validationStatus,
        };
      }),
    );
    return { files: withMeta };
  };

  return {
    repoRoot: () => root,
    defaultOutPath,
    defaultInputPath,
    getActiveReportPath: () => activeReportPath,
    setActiveReportPath: (p) => {
      activeReportPath = path.resolve(p);
    },
    ensurePipelineFileList,
    readReportJson,
    writeReportJson,
    runViewerBuild,
    runAggregateViewerBuild,
    buildPortfolioSummary,
    defaultAggregateOutPath,
    getFileList,
    addPdfPaths,
    runPipelineForPdf,
    bootstrapReports,
    rescoreReport,
    updatePipelineFileEntry,
    isoNow,
  };
}

module.exports = { createPipelineBackend };
