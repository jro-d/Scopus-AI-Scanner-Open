// Preset research projects. A "project" config drives everything: topics, grading rubric, and the
// deep-note fields the AI fills in for each paper.

export const DEFAULT_CRITERIA = [
  {
    id: 'c1',
    label: 'Topic Match',
    description: '0 = unrelated, 1 = loosely related, 2 = clearly related to one of my topics, 3 = directly on-topic and central to my study.'
  },
  {
    id: 'c2',
    label: 'Method Usefulness',
    description: '0 = no usable method, 1 = vague method, 2 = clear method I could adapt, 3 = detailed, reproducible method directly useful to my study.'
  },
  {
    id: 'c3',
    label: 'Evidence Quality',
    description: '0 = no evidence, 1 = weak/simulation-only claims, 2 = solid results with metrics, 3 = strong, validated results (e.g. experiments, large datasets, real deployment).'
  }
];

export const DEFAULT_NOTE_FIELDS = [
  { id: 'n1', label: 'Research problem / objective', instruction: 'What problem does the paper address and what is its objective?' },
  { id: 'n2', label: 'Method / approach', instruction: 'Core method, algorithm or technique used.' },
  { id: 'n3', label: 'System, dataset or sample & scale', instruction: 'What system, dataset or sample was studied and at what scale (sizes, counts, ratings)?' },
  { id: 'n4', label: 'Validation / evaluation', instruction: 'How was it validated (simulation, experiment, case study, survey, benchmark)?' },
  { id: 'n5', label: 'Key results & metrics', instruction: 'Headline quantitative results and metrics, exactly as stated.' },
  { id: 'n6', label: 'Equations / parameters / algorithms', instruction: 'Named equations, parameters or algorithms that are explicitly mentioned.' },
  { id: 'n7', label: 'Limitations', instruction: 'Limitations or weaknesses stated or clearly implied.' },
  { id: 'n8', label: 'Future work', instruction: 'Future work the authors mention.' },
  { id: 'n9', label: 'Possible research gap', instruction: 'A gap this paper leaves open that my study could address.' },
  { id: 'n10', label: 'Suggested literature-review section', instruction: 'Which section of my literature review (RRL) this paper best supports.' }
];

export function blankProject(name = 'My Research') {
  return {
    name,
    thesisTitle: '',
    context: '',
    topics: [],
    criteria: structuredClone(DEFAULT_CRITERIA),
    noteFields: structuredClone(DEFAULT_NOTE_FIELDS),
    recencyEnabled: true,
    tier1Pct: 75,
    tier2Pct: 50
  };
}

const COLORS = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#0891b2', '#e11d48', '#4f46e5', '#65a30d'];
export const topicColor = (i) => COLORS[i % COLORS.length];

export function buildScopusQuery(keywords, yearFrom) {
  const kws = (keywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (!kws.length) return '';
  const body = kws.map((k) => (/\s|-/.test(k) ? `"${k}"` : k)).join(' OR ');
  return `TITLE-ABS-KEY(${body})${yearFrom ? ` AND PUBYEAR > ${Number(yearFrom) - 1}` : ''}`;
}

export const PRESET_LIST = [
  { id: 'blank', label: 'Blank project', make: () => blankProject('My Research') }
];
