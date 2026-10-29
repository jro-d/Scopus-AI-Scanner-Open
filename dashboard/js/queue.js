// Sequential, rate-limited AI evaluation queue. Runs inside the dashboard tab.
import { evaluatePaper, GeminiError } from './gemini.js';

let worker = null;
let nextId = 1;
const pending = new Map();

function workerSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    try {
      worker ||= new Worker(new URL('../timer-worker.js', import.meta.url));
      worker.onmessage = (e) => {
        const fn = pending.get(e.data.id);
        if (fn) (pending.delete(e.data.id), fn());
      };
    } catch {
      worker = null;
    }
    const id = nextId++;
    let t = null;
    const done = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      pending.delete(id);
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (worker) {
      pending.set(id, done);
      worker.postMessage({ id, ms });
    } else {
      t = setTimeout(done, ms);
    }
  });
}

export class AiQueue {
  /**
   * @param {object} h handlers: getPaper(key), getConfig(), getSettings(), onPaper(paper), onState(state), evaluate?
   */
  constructor(h) {
    this.h = h;
    this.keys = [];
    this.state = 'idle'; // idle | running | paused
    this.abort = null;
    this.lastStart = 0;
    this.token = 0;
    this.message = '';
    this.evaluate = h.evaluate || evaluatePaper;
  }

  get remaining() {
    return this.keys.length;
  }

  emit() {
    this.h.onState({ state: this.state, remaining: this.keys.length, message: this.message });
  }

  enqueue(keys) {
    for (const k of keys) if (!this.keys.includes(k)) this.keys.push(k);
  }

  start() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.message = '';
    this.abort = new AbortController();
    this.emit();
    this.loop();
  }

  pause(message = '') {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.message = message;
    this.abort?.abort();
    this.emit();
  }

  clear() {
    this.abort?.abort();
    this.keys = [];
    this.state = 'idle';
    this.message = '';
    this.emit();
  }

  async loop() {
    const signal = this.abort.signal;
    const token = ++this.token;
    while (this.state === 'running' && this.keys.length && token === this.token) {
      const key = this.keys[0];
      const paper = await this.h.getPaper(key);
      if (!paper || paper.decision === 'Exclude') {
        this.keys.shift();
        this.emit();
        continue;
      }
      const settings = this.h.getSettings();
      const wait = this.lastStart + settings.intervalSec * 1000 - Date.now();
      try {
        if (wait > 0) await workerSleep(wait, signal);
      } catch {
        return; // paused / cleared while waiting
      }
      if (this.state !== 'running') return;

      this.lastStart = Date.now();
      paper.status = 'running';
      paper.error = null;
      await this.h.onPaper(paper);
      try {
        const result = await this.evaluate(paper, this.h.getConfig(), {
          apiKey: settings.apiKey,
          model: settings.model,
          signal,
          onRetry: ({ attempt, wait: w }) => {
            this.message = `Rate-limited — retrying in ${Math.round(w / 1000)}s (attempt ${attempt})…`;
            this.emit();
          }
        });
        paper.eval = result;
        paper.status = 'done';
        this.keys.shift();
        this.message = '';
      } catch (e) {
        if (e.name === 'AbortError') {
          paper.status = 'queued';
          await this.h.onPaper(paper);
          return;
        }
        paper.status = 'error';
        paper.error = e.message;
        this.keys.shift();
        const fatal = e instanceof GeminiError && (e.status === 401 || e.status === 403 || e.status === 400 && /API key/i.test(e.message));
        if (fatal || (e instanceof GeminiError && e.status === 429)) {
          paper.status = 'queued';
          paper.error = null;
          this.keys.unshift(key);
          await this.h.onPaper(paper);
          this.pause(
            fatal
              ? 'Gemini rejected your API key. Check it in Settings, then press Resume.'
              : 'Free-tier quota reached. Wait a bit (or until tomorrow for the daily limit), then press Resume.'
          );
          return;
        }
      }
      await this.h.onPaper(paper);
      this.emit();
    }
    if (this.state === 'running' && token === this.token) {
      this.state = 'idle';
      this.message = '';
      this.emit();
    }
  }
}
