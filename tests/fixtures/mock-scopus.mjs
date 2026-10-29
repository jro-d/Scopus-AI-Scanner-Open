// Mock "Scopus-like" results page + deterministic demo papers, used by the E2E test and the tutorial
// screenshots. This is NOT real Scopus data — it only imitates the layout (lazy-loaded cards,
// "Show abstract" toggles, record links, author/source links, citations, "View at Publisher").

const TOPIC_BANK = [
  {
    key: 'A', titles: [
      'Scalable orchestration of distributed microservices in multi-cloud environments',
      'Dynamic resource allocation and scheduling for latency-critical cloud services',
      'Fault tolerance and consensus mechanisms in high-throughput distributed systems',
      'Benchmarking data consistency and partitioning in distributed datastores'
    ],
    abs: 'Distributed cloud applications require resilient architectures and efficient resource allocation. This study presents a dynamic scheduling and load-balancing framework for containerized microservices across hybrid cloud clusters. Experimental evaluation on a cluster testbed shows throughput improved by {n}% and latency reduced significantly compared to baseline round-robin algorithms.'
  },
  {
    key: 'B', titles: [
      'Optimization of deep neural network architectures using neural architecture search',
      'Quantization and pruning techniques for efficient edge device inference',
      'Self-supervised representation learning for high-dimensional multimodal datasets',
      'Gradient optimization and stability analysis in deep generative models'
    ],
    abs: 'Deploying deep learning models on resource-constrained devices requires model compression and pruning. This paper proposes an automated quantization framework that preserves predictive performance while reducing memory footprint. Empirical results across benchmark datasets demonstrate a {n}% reduction in model parameters with less than 0.5% accuracy drop.'
  },
  {
    key: 'C', titles: [
      'Automated test case generation for safety-critical embedded systems',
      'Symbolic execution and formal verification of concurrent software components',
      'Static analysis techniques for detecting concurrency and memory safety violations',
      'Comparative study of automated fuzzing strategies on production software'
    ],
    abs: 'Software reliability in critical infrastructure relies on automated testing and formal verification. We introduce a directed symbolic execution framework designed to identify edge-case bugs and race conditions. Evaluation on open-source benchmarks shows bug-finding efficiency improved by {n}% over standard fuzzing approaches.'
  },
  {
    key: 'D', titles: [
      'Machine-learning based predictive modeling for time-series forecasting',
      'Model predictive control and optimization using recurrent neural networks',
      'Deep reinforcement learning for real-time autonomous systems control',
      'Probabilistic forecasting and uncertainty quantification in complex dynamic systems'
    ],
    abs: 'Accurate time-series forecasting is essential for proactive decision-making and control. An LSTM network predicts system states 10 steps ahead with an RMSE reduction of {n}%, feeding an adaptive model predictive controller. Simulation and benchmark comparisons demonstrate robust stability across dynamic operating conditions.'
  },
  {
    key: 'E', titles: [
      'End-to-end security protocols and authentication in distributed edge computing',
      'Zero-trust architectural frameworks for multi-tenant cloud platforms',
      'Intrusion detection systems using semi-supervised graph neural networks',
      'Privacy-preserving computation and federated learning on decentralized devices'
    ],
    abs: 'Decentralized edge architectures face unique vulnerability and privacy challenges. This research develops a zero-trust cryptographic verification protocol for edge gateways. Hardware measurements on embedded devices demonstrate authentication latency reduced by {n}% with low computational overhead.'
  },
  {
    key: 'F', titles: [
      'Empirical evaluation of software engineering practices in open-source projects',
      'Developer productivity and code review dynamics in distributed teams',
      'Continuous integration pipelines: performance bottlenecks and optimization',
      'A multi-repository analysis of software maintainability and technical debt'
    ],
    abs: 'Understanding developer workflows and review processes is vital for software engineering practice. This paper presents an empirical investigation across 100 large-scale repositories, identifying common continuous integration bottlenecks. The findings reveal that automated linting and staged testing improve pull request turnaround time by {n}%.'
  },
  {
    key: 'X', titles: [
      'Convolutional neural networks for agricultural image classification',
      'Blockchain consensus mechanisms for supply-chain provenance',
      'Sentiment analysis of social media text using transformer language models'
    ],
    abs: 'This paper presents an applied machine learning baseline on domain-specific public datasets, achieving an accuracy of {n}%. Results are benchmarked against traditional feature-engineering classifiers.'
  }
];

const AUTHORS = [
  ['Smith, J.', 'Taylor, R.', 'Davies, A.'], ['Chen, L.', 'Wang, H.'], ['Johnson, M.', 'Miller, K.', 'Brown, C.'],
  ['Garcia, R.', 'Martinez, D.'], ['Ahmed, S.', 'Khan, M.U.'], ['Nguyen, T.T.', 'Pham, Q.'], ['Müller, F.', 'Schmidt, A.']
];
const VENUES = [
  ['IEEE Transactions on Software Engineering', 'Article'], ['ACM Computing Surveys', 'Review'], ['IEEE Access', 'Article'],
  ['Journal of Systems and Software', 'Article'], ['Proceedings of IEEE ICSE', 'Conference paper'], ['Empirical Software Engineering', 'Article']
];

function rnd(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function makeMockPapers(count = 100) {
  const r = rnd(42);
  const out = [];
  for (let i = 0; i < count; i++) {
    const topic = i % 9 === 8 ? TOPIC_BANK[6] : TOPIC_BANK[Math.floor(r() * 6)];
    const title = topic.titles[Math.floor(r() * topic.titles.length)] + (i % 4 === 3 ? ' — case study' : '');
    const [venue, type] = VENUES[Math.floor(r() * VENUES.length)];
    const authors = AUTHORS[Math.floor(r() * AUTHORS.length)];
    const year = 2019 + Math.floor(r() * 8);
    const n = Math.floor(8 + r() * 40);
    const eid = `2-s2.0-851${String(10000 + i * 37).padStart(8, '0')}`;
    out.push({
      i, eid, title: `${title}`, authors, venue, type, year, topic: topic.key,
      citations: Math.floor(r() * 60),
      doi: i % 11 === 5 ? '' : `10.1109/mock.${year}.${100000 + i * 13}`,
      abstract: topic.abs.replace(/\{n\}/g, String(n)).replace('{c}', (0.1 + r() * 0.4).toFixed(2))
    });
  }
  return out;
}

export function buildMockPage(papers = makeMockPapers()) {
  const data = JSON.stringify(papers);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scopus | Document search results (DEMO)</title>
<style>
 body{margin:0;font:14px/1.45 Arial,Helvetica,sans-serif;color:#262626;background:#f7f7f7}
 .demo{background:#fff3cd;color:#664d03;padding:6px 16px;font-size:12px;text-align:center;border-bottom:1px solid #ffe69c}
 header.top{background:#fff;border-bottom:1px solid #ddd;padding:10px 24px;display:flex;gap:18px;align-items:center}
 header.top b{color:#e9711c;font-size:22px;letter-spacing:-.5px}
 textarea#q{flex:1;height:44px;border:1px solid #bbb;border-radius:6px;padding:6px 10px;font:13px monospace}
 .meta{padding:14px 24px;font-size:18px;font-weight:700;background:#fff;border-bottom:1px solid #ddd}
 .meta small{font-weight:400;color:#666;font-size:13px;margin-left:12px}
 ul#results{list-style:none;margin:0;padding:0 24px 80px;max-width:1100px}
 li.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;margin:12px 0;padding:14px 16px}
 li.card .row{display:flex;gap:12px}
 .type{font-size:12px;color:#666;text-transform:none;margin-bottom:2px}
 h3{margin:0 0 4px;font-size:16px}h3 a{color:#007398;text-decoration:none}
 .authors a,.src a{color:#444;text-decoration:none}
 .src{color:#555;font-size:13px;margin:2px 0}.cit{font-size:13px;color:#555;margin:2px 0}
 .actions{margin-top:8px;display:flex;gap:16px;align-items:center;font-size:13px}
 .actions button{background:none;border:0;color:#007398;cursor:pointer;font:inherit;padding:0}
 .actions a{color:#007398;text-decoration:none}
 .abs{margin-top:8px;padding:10px 12px;background:#fafafa;border-left:3px solid #e9711c;font-size:13.5px}
</style></head><body>
<div class="demo">DEMO PAGE — mock of the Scopus results layout used for testing and tutorial screenshots. Not real Scopus data.</div>
<header class="top"><b>Scopus</b><textarea id="q">TITLE-ABS-KEY ( ( "distributed systems" OR microservices ) AND ( "cloud computing" OR orchestration ) ) AND PUBYEAR &gt; 2020</textarea></header>
<div class="meta"><span id="count">100</span> document results<small>Show 100 results per page · Sort by: Relevance</small></div>
<ul id="results"></ul>
<script>
 const DATA=${data};
 let shown=0; const list=document.getElementById('results');
 function card(p){
   const li=document.createElement('li'); li.className='card';
   const authors=p.authors.map((a,k)=>'<a href="/authid/detail.uri?authorId='+(5700000+p.i*7+k)+'">'+a+'</a>').join(', ');
   li.innerHTML='<div class="row"><input type="checkbox" aria-label="select"><div class="body">'+
    '<div class="type">'+p.type+'</div>'+
    '<h3><a href="/record/display.uri?eid='+p.eid+'&origin=resultslist">'+p.title+'</a></h3>'+
    '<div class="authors">'+authors+'</div>'+
    '<div class="src"><a href="/sourceid/'+(21100000+p.i)+'">'+p.venue+'</a>, '+p.year+', pp. '+(100+p.i)+'-'+(112+p.i)+'</div>'+
    '<div class="cit">'+p.citations+' Citations</div>'+
    '<div class="actions"><button class="abs-toggle" aria-expanded="false">Show abstract</button>'+
    (p.doi?'<a href="https://doi.org/'+p.doi+'" target="_blank">View at Publisher</a>':'<a href="/related?eid='+p.eid+'">View at Publisher</a>')+
    '<a href="/related?eid='+p.eid+'">Related documents</a></div><div class="abs-slot"></div></div></div>';
   const btn=li.querySelector('.abs-toggle'), slot=li.querySelector('.abs-slot');
   btn.addEventListener('click',()=>{
     if(btn.getAttribute('aria-expanded')==='true'){slot.innerHTML='';btn.textContent='Show abstract';btn.setAttribute('aria-expanded','false');return;}
     const highlightedAbs = p.abstract.replace(/\b(distributed|cloud|neural|network|model|testing|security|framework|system|study)\b/gi, '<span class="highlight">$1</span>');
     setTimeout(()=>{slot.innerHTML='<div class="abs"><p>'+highlightedAbs+'</p></div>';btn.textContent='Hide abstract ^';btn.setAttribute('aria-expanded','true');},70);
   });
   if(p.i<12){btn.click();}
   return li;
 }
 function more(n){for(let k=0;k<n&&shown<DATA.length;k++)list.appendChild(card(DATA[shown++]));}
 more(30);
 // lazy loading: more cards appear as the user (or the scanner) scrolls near the bottom
 window.addEventListener('scroll',()=>{if(innerHeight+scrollY>document.documentElement.scrollHeight-1800)more(20);},{passive:true});
</script></body></html>`;
}
