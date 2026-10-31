#!/usr/bin/env node
/**
 * 萌百 → VS Code 本地桥
 *
 * 浏览器里的站内用户脚本（user-script.js）把
 * 「条目名 + 源码」POST 到本服务，这里落盘成 .wikitext 并用 VS Code 打开。
 *
 * - 只监听 127.0.0.1，外网访问不到
 * - 带 token，防止随便哪个网页都能调
 * - 本地已有同名文件时不覆盖，只打开（避免覆盖掉改过的草稿）
 *
 * 零依赖，Node 18+ 直接跑： node server.mjs
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, 'config.json');

const defaults = {
  port: 8765,
  token: 'change-me-please',
  vault: 'D:\\萌百编辑',
  openInVSCode: true,
  // 空闲多少分钟没人用就自动退出，0 = 不退出
  idleMinutes: 30,
};

let config = { ...defaults };
try {
  const raw = await fs.readFile(configPath, 'utf8');
  config = { ...config, ...JSON.parse(raw) };
} catch {
  /* 没有 config.json 就用默认值 */
}
if (!config.vault) config.vault = path.join(here, 'drafts');

const ALLOWED_ORIGINS = [
  'https://zh.moegirl.org.cn',
  'https://mzh.moegirl.org.cn',
  'https://mobile.moegirl.org.cn',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-moegirl-token',
    // Chrome/Edge 的私有网络访问（Public → Private）预检要求这个头
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function send(res, status, payload, origin = '') {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(origin),
  });
  res.end(body);
}

/** 把条目标题变成安全的文件名：子页面的 / 变下划线，其余非法字符替换掉 */
function toStem(title) {
  let s = String(title ?? '').trim();
  s = s.replace(/\//g, '_');
  s = s.replace(/[<>:"\\|?*\u0000-\u001f]/g, '_');
  s = s.replace(/^\.+$/, '_');
  s = s.slice(0, 120).trim();
  return s || 'untitled';
}

async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大（超过 16 MB）');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function launchCode(file) {
  // 必须把参数分开交给 cmd：把 `code -r "路径"` 当一整个字符串传时，
  // 中文路径会被 cmd 的代码页转坏，VS Code 拿到不存在的路径 → 打开空白缓冲区。
  spawn('cmd.exe', ['/c', 'code', '-r', file], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function tokenOf(req, url) {
  return req.headers['x-moegirl-token'] || url.searchParams.get('token') || '';
}

/** 记一份最近打开列表，右键菜单用（只留 20 条） */
async function rememberRecent(title, file) {
  const p = path.join(here, 'recent.json');
  let items = [];
  try {
    items = JSON.parse(await fs.readFile(p, 'utf8'));
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }
  items = items.filter((x) => x && x.title !== title);
  items.unshift({ title, file, at: new Date().toISOString() });
  items = items.slice(0, 20);
  await fs.writeFile(p, JSON.stringify(items, null, 2), 'utf8').catch(() => {});
}

/** 行级差异统计（LCS）；太大就退化，不做逐行 */
function lineDiff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  if (A.length > 8000 || B.length > 8000) {
    return { added: -1, removed: -1, note: '文件太大，跳过逐行统计' };
  }
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcs = dp[m][n];
  return { added: n - lcs, removed: m - lcs };
}

let lastActivity = Date.now();

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  const origin = req.headers.origin || '';
  const url = new URL(req.url, `http://127.0.0.1:${config.port}`);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/ping') {
      return send(res, 200, { ok: true, vault: config.vault, port: config.port }, origin);
    }

    // 在 VS Code 里直接打开素材目录（右键菜单「打开目录」）
    if (req.method === 'POST' && url.pathname === '/open-folder') {
      if (tokenOf(req, url) !== config.token) {
        return send(res, 403, { ok: false, error: 'token 不匹配' }, origin);
      }
      spawn('cmd.exe', ['/c', 'code', '-r', config.vault], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      return send(res, 200, { ok: true, vault: config.vault }, origin);
    }

    // 最近打开的条目（右键菜单用）
    if (req.method === 'GET' && url.pathname === '/recent') {
      let items = [];
      try {
        items = JSON.parse(await fs.readFile(path.join(here, 'recent.json'), 'utf8'));
      } catch {
        items = [];
      }
      return send(res, 200, { ok: true, items }, origin);
    }

    // 打开本地已存在的草稿（「最近打开」用）
    if (req.method === 'POST' && url.pathname === '/open-file') {
      if (tokenOf(req, url) !== config.token) {
        return send(res, 403, { ok: false, error: 'token 不匹配' }, origin);
      }
      const b = JSON.parse(await readBody(req));
      const title = String(b.title ?? '').trim();
      if (!title) return send(res, 400, { ok: false, error: '缺少 title' }, origin);
      const file = path.join(config.vault, `${toStem(title)}.wikitext`);
      const exists = await fs.access(file).then(() => true).catch(() => false);
      if (!exists) {
        return send(res, 404, { ok: false, error: `本地还没有《${title}》的草稿` }, origin);
      }
      launchCode(file);
      return send(res, 200, { ok: true, file }, origin);
    }

    // 本地草稿 vs 线上源码：差异统计
    if (req.method === 'POST' && url.pathname === '/compare') {
      if (tokenOf(req, url) !== config.token) {
        return send(res, 403, { ok: false, error: 'token 不匹配' }, origin);
      }
      const b = JSON.parse(await readBody(req));
      const title = String(b.title ?? '').trim();
      const remote = String(b.content ?? '');
      if (!title) return send(res, 400, { ok: false, error: '缺少 title' }, origin);
      const file = path.join(config.vault, `${toStem(title)}.wikitext`);
      const exists = await fs.access(file).then(() => true).catch(() => false);
      if (!exists) {
        return send(
          res,
          200,
          { ok: true, exists: false, remoteBytes: Buffer.byteLength(remote, 'utf8'), message: '本地还没有草稿，没有可比的内容' },
          origin,
        );
      }
      const local = await fs.readFile(file, 'utf8');
      if (local === remote) {
        return send(res, 200, { ok: true, exists: true, identical: true, message: '本地与线上完全一致' }, origin);
      }
      const d = lineDiff(local, remote);
      return send(
        res,
        200,
        {
          ok: true,
          exists: true,
          identical: false,
          localAdded: d.removed, // 本地比线上多出来的行
          localRemoved: d.added, // 本地比线上少掉的行
          localBytes: Buffer.byteLength(local, 'utf8'),
          remoteBytes: Buffer.byteLength(remote, 'utf8'),
          note: d.note,
          file,
        },
        origin,
      );
    }

    if (req.method !== 'POST' || url.pathname !== '/open') {
      return send(res, 404, { ok: false, error: '没有这个接口' }, origin);
    }

    if (tokenOf(req, url) !== config.token) {
      return send(res, 403, { ok: false, error: 'token 不匹配' }, origin);
    }

    const body = JSON.parse(await readBody(req));
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '');
    if (!title) return send(res, 400, { ok: false, error: '缺少 title' }, origin);
    if (!content) return send(res, 400, { ok: false, error: '源码为空' }, origin);

    const stem = toStem(title);
    const file = path.join(config.vault, `${stem}.wikitext`);
    const existed = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);

    if (existed && !body.force) {
      if (config.openInVSCode) launchCode(file);
      await rememberRecent(title, file);
      return send(
        res,
        200,
        { ok: true, status: 'exists', file, opened: config.openInVSCode, message: '本地已有草稿，只打开不覆盖' },
        origin,
      );
    }

    await fs.mkdir(config.vault, { recursive: true });
    await fs.writeFile(file, content, 'utf8');
    if (config.openInVSCode) launchCode(file);
    await rememberRecent(title, file);

    return send(
      res,
      200,
      {
        ok: true,
        status: existed ? 'overwritten' : 'written',
        file,
        bytes: Buffer.byteLength(content, 'utf8'),
        opened: config.openInVSCode,
      },
      origin,
    );
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message ?? err) }, origin);
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`萌百 → VS Code 桥已启动`);
  console.log(`  地址：http://127.0.0.1:${config.port}/ping`);
  console.log(`  目录：${config.vault}`);

  const idleMinutes = Number(config.idleMinutes || 0);
  if (idleMinutes > 0) {
    console.log(`  空闲 ${idleMinutes} 分钟后自动退出`);
    setInterval(() => {
      if (Date.now() - lastActivity > idleMinutes * 60000) {
        console.log(`空闲 ${idleMinutes} 分钟，自动退出（下次打开 VS Code 会自动拉起）`);
        process.exit(0);
      }
    }, 60000).unref();
  }
});
