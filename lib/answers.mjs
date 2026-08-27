// 答案库：第一遍收集的正确答案（按规范化题干为键），第二遍按此作答
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';

export function normalizeText(text) {
  return String(text || '')
    .replace(/\u3000/g, ' ').replace(/\xa0/g, ' ')
    // 去掉题号前缀（如 ".1."、"1."）和分数后缀（"(33分)"）
    .replace(/^\s*[.\d、\s]*\.?\s*/, '')
    .replace(/\(\s*\d+(\.\d+)?\s*分\s*\)\s*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function questionKey(text) {
  return crypto.createHash('sha1').update(normalizeText(text)).digest('hex').slice(0, 16);
}

export class AnswerStore {
  constructor(path) {
    this.path = path;
    this.data = { version: 1, questions: {} };
    try {
      const loaded = JSON.parse(readFileSync(path, 'utf-8'));
      if (loaded && loaded.questions) this.data = loaded;
    } catch { /* 首次运行 */ }
  }

  record(questionText, answer, extra = {}) {
    const key = questionKey(questionText);
    this.data.questions[key] = {
      question: questionText,
      answer: String(answer).toUpperCase(),
      type: extra.type || '',
      source: extra.source || '',
      time: new Date().toISOString(),
      updated: this.data.questions[key] ? (this.data.questions[key].updated || 0) + 1 : 0,
    };
    this.save();
  }

  lookup(questionText) {
    return this.data.questions[questionKey(questionText)] || null;
  }

  get size() { return Object.keys(this.data.questions).length; }

  save() {
    mkdirSync(dirname(this.path) || '.', { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}
