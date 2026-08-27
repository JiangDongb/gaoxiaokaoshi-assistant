// 通用小工具
import { mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function retry(fn, { tries = 3, delayMs = 2000, log = null, label = '' } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (log) log.warn(`重试 ${label} (${i}/${tries}): ${e.message}`);
      if (i < tries) await sleep(delayMs);
    }
  }
  throw lastErr;
}

// 简单并发限制器
export class Limiter {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async run(fn) {
    if (this.active >= this.max) {
      await new Promise(res => this.queue.push(res));
    }
    this.active++;
    try { return await fn(); }
    finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

let logDirInit = false;
export function makeLogger(name, dir = 'logs') {
  if (!logDirInit) { mkdirSync(dir, { recursive: true }); logDirInit = true; }
  const stream = createWriteStream(join(dir, name + '.log'), { flags: 'a', encoding: 'utf-8' });
  const ts = () => new Date().toISOString().slice(11, 19);
  const emit = (level, msg) => {
    const line = `[${ts()}] [${level}] ${msg}`;
    console.log(line);
    stream.write(line + '\n');
  };
  return {
    info: m => emit('INFO ', m),
    warn: m => emit('WARN ', m),
    error: m => emit('ERROR', m),
    ok: m => emit('OK   ', m),
    close: () => stream.end(),
  };
}

export function safeName(s) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
}
