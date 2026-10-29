// Pure scoring helpers (no DOM, no chrome.* APIs) so they can be unit-tested in Node.

export const SCORE_MAX_PER_CRITERION = 3;

/** Recency points: <=2 years old = 3, <=4 = 2, <=6 = 1, older = 0. */
export function recencyScore(year, currentYear) {
  const y = Number(year);
  if (!y || !currentYear) return 0;
  const age = currentYear - y;
  if (age <= 2) return 3;
  if (age <= 4) return 2;
  if (age <= 6) return 1;
  return 0;
}

export function clampScore(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(SCORE_MAX_PER_CRITERION, n));
}

export function maxTotal(config) {
  const n = (config.criteria || []).length + (config.recencyEnabled === false ? 0 : 1);
  return n * SCORE_MAX_PER_CRITERION;
}

/** Returns { criteriaTotal, recency, total, max, pct, tier } for a paper that has an `eval`. */
export function computeGrade(paper, config, currentYear = new Date().getFullYear()) {
  if (!paper?.eval) return null;
  const criteria = config.criteria || [];
  let criteriaTotal = 0;
  for (const c of criteria) criteriaTotal += clampScore(paper.eval.criteria?.[c.id]);
  const recency = config.recencyEnabled === false ? 0 : recencyScore(paper.year, currentYear);
  const total = criteriaTotal + recency;
  const max = maxTotal(config);
  const pct = max ? (total / max) * 100 : 0;
  const t1 = config.tier1Pct ?? 75;
  const t2 = config.tier2Pct ?? 50;
  const tier = pct >= t1 ? 'Tier 1' : pct >= t2 ? 'Tier 2' : 'Tier 3';
  return { criteriaTotal, recency, total, max, pct, tier };
}

/** Pick the topic code with highest relevance (ties -> first topic in config order). */
export function bestTopicOf(evalResult, topics) {
  if (!evalResult) return null;
  const rel = evalResult.topicRelevance || {};
  let best = null;
  let bestScore = 0;
  for (const t of topics) {
    const s = clampScore(rel[t.code]);
    if (s > bestScore) {
      best = t.code;
      bestScore = s;
    }
  }
  return best;
}

/** Count how many keywords of each topic appear in the paper's title/abstract (pre-AI preview). */
export function keywordHits(paper, topics) {
  const text = `${paper.title || ''} ${paper.abstract || ''}`.toLowerCase();
  const out = {};
  for (const t of topics) {
    let hits = 0;
    for (const kw of t.keywords || []) {
      const k = String(kw).trim().toLowerCase();
      if (k && text.includes(k)) hits++;
    }
    out[t.code] = hits;
  }
  return out;
}

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 160);
}

/** Stable id used for de-duplication across scans. */
export function paperSignature(p) {
  const doi = String(p.doi || '').toLowerCase().trim();
  if (doi) return `doi:${doi}`;
  if (p.eid) return `eid:${p.eid}`;
  return `t:${normalizeTitle(p.title)}:${p.year || ''}`;
}

/** Matrix of topic x tier counts + average score, based on each paper's best topic. */
export function buildTopicMatrix(papers, config, currentYear) {
  const rows = config.topics.map((t) => ({
    code: t.code,
    name: t.name,
    color: t.color,
    tier1: 0,
    tier2: 0,
    tier3: 0,
    total: 0,
    avgPct: 0,
    _sum: 0
  }));
  const unassigned = { code: '—', name: 'No clear topic match', color: '#94a3b8', tier1: 0, tier2: 0, tier3: 0, total: 0, avgPct: 0, _sum: 0 };
  for (const p of papers) {
    if (!p.eval || p.decision === 'Exclude') continue;
    const g = computeGrade(p, config, currentYear);
    const code = bestTopicOf(p.eval, config.topics);
    const row = rows.find((r) => r.code === code) || unassigned;
    row.total++;
    row._sum += g.pct;
    if (g.tier === 'Tier 1') row.tier1++;
    else if (g.tier === 'Tier 2') row.tier2++;
    else row.tier3++;
  }
  const all = [...rows, unassigned].filter((r) => r !== unassigned || r.total > 0);
  for (const r of all) {
    r.avgPct = r.total ? r._sum / r.total : 0;
    delete r._sum;
  }
  return all;
}
