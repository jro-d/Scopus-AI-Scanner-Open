// Grading Matrix tab: topic x tier summary + paper x topic relevance heat-map.
import { state, on, esc, $, currentYear } from './state.js';
import { buildTopicMatrix, computeGrade, bestTopicOf } from './scoring.js';
import { openPaper } from './papers-view.js';

export function renderMatrix() {
  if (!state.project) return;
  const cfg = state.project;
  const rows = buildTopicMatrix(state.papers, cfg, currentYear());
  const graded = state.papers.filter((p) => p.eval && p.decision !== 'Exclude');
  if (!graded.length) {
    $('#matrixTable').innerHTML = '<p class="muted">No graded papers yet. Run the AI evaluation on the Papers tab to fill this matrix.</p>';
    $('#heatmap').innerHTML = '';
    return;
  }
  $('#matrixTable').innerHTML = `<table class="mtable"><thead><tr><th>Topic</th><th>Tier 1</th><th>Tier 2</th><th>Tier 3</th><th>Graded</th><th>Avg score</th><th>Distribution</th></tr></thead><tbody>${rows
    .map((r) => {
      const t = r.total || 1;
      return `<tr><td><span class="tchip"><i style="background:${esc(r.color)}"></i>${esc(r.code)}</span> ${esc(r.name)}</td>
        <td><b style="color:var(--ok)">${r.tier1}</b></td><td><b style="color:var(--warn)">${r.tier2}</b></td><td>${r.tier3}</td><td>${r.total}</td>
        <td>${r.total ? Math.round(r.avgPct) + '%' : '—'}</td>
        <td><div class="mbar"><i style="width:${(r.tier1 / t) * 100}%"></i><i style="width:${(r.tier2 / t) * 100}%"></i><i style="width:${(r.tier3 / t) * 100}%"></i></div></td></tr>`;
    })
    .join('')}</tbody></table>`;

  const sorted = [...graded].sort((a, b) => computeGrade(b, cfg, currentYear()).pct - computeGrade(a, cfg, currentYear()).pct);
  $('#heatmap').innerHTML = `<table class="heat mtable"><thead><tr><th>Paper</th><th>Tier</th>${cfg.topics.map((t) => `<th title="${esc(t.name)}">${esc(t.code)}</th>`).join('')}<th>Best</th></tr></thead><tbody>${sorted
    .map((p) => {
      const g = computeGrade(p, cfg, currentYear());
      const best = bestTopicOf(p.eval, cfg.topics);
      return `<tr data-key="${esc(p.key)}" style="cursor:pointer"><td>${esc(p.title.length > 90 ? p.title.slice(0, 90) + '…' : p.title)}</td><td>${g.tier}</td>${cfg.topics
        .map((t) => {
          const v = p.eval.topicRelevance?.[t.code] ?? 0;
          return `<td class="h h${v}">${v}</td>`;
        })
        .join('')}<td>${esc(best || '—')}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

export function initMatrixView() {
  $('#heatmap').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (tr) openPaper(tr.dataset.key);
  });
  on('papers-changed', renderMatrix);
  on('config-changed', renderMatrix);
  on('project-changed', renderMatrix);
  on('tab-shown', (tab) => tab === 'matrix' && renderMatrix());
}
