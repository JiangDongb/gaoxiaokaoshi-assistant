// 配置加载与校验
import { readFileSync } from 'node:fs';

export class ConfigError extends Error {}

export function loadConfig(path = 'config.json') {
  let raw;
  try {
    const text = readFileSync(path, 'utf-8').replace(/^\uFEFF/, ''); // 去除可能存在的 UTF-8 BOM
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`无法读取配置文件 ${path}: ${e.message}`);
  }
  const site = raw.site || {};
  const concurrency = raw.concurrency || {};
  const video = raw.video || {};
  const homework = raw.homework || {};
  const accountsRaw = raw.accounts || [];
  if (accountsRaw.length === 0) throw new ConfigError('配置中至少需要一个账号');

  const accounts = accountsRaw.map((a, i) => {
    const name = String(a.name || `账号${i + 1}`);
    const username = String(a.username || '').trim();
    const password = String(a.password || '');
    if (!username || !password) throw new ConfigError(`账号[${name}] 缺少 username/password`);
    if (username.includes('请填写')) throw new ConfigError(`账号[${name}] 还是占位符，请填写真实用户名`);
    return {
      name,
      username,
      password,
      plan: String(a.plan || '').trim() || null,
      lessons: Array.isArray(a.lessons) ? a.lessons.map(String) : [],
      watch_videos: a.watch_videos !== false,
      do_homework: a.do_homework !== false,
    };
  });

  return {
    site: {
      base_url: String(site.base_url || 'http://www.gaoxiaokaoshi.com').replace(/\/+$/, ''),
      login_page: site.login_page || '/Login.aspx',
      browser: site.browser || 'edge',
      headless: site.headless !== false,
    },
    concurrency: {
      max_accounts: Math.max(1, Number(concurrency.max_accounts) || 2),
      parallel_lessons: Math.max(1, Number(concurrency.parallel_lessons) || 4),
      action_timeout_sec: Number(concurrency.action_timeout_sec) || 20,
      page_timeout_sec: Number(concurrency.page_timeout_sec) || 60,
      cdp_base_port: Number(concurrency.cdp_base_port) || 9400,
    },
    video: {
      mode: video.mode || 'full',
      max_watch_sec: Number(video.max_watch_sec) || 7200,
      poll_sec: Math.max(30, Number(video.poll_sec) || 90),
      stall_tolerance_min: Number(video.stall_tolerance_min) || 8,
    },
    homework: {
      passes: Math.max(1, Number(homework.passes) || 2),
      first_pass_guess: String(homework.first_pass_guess || 'C').toUpperCase(),
      answers_file: homework.answers_file || 'answers.json',
      min_score: Number(homework.min_score) || 60,
    },
    accounts,
  };
}
