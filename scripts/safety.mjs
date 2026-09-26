// =============================================================
// 真实数据保护层
//
// 线上已经有人在用真实信息（手机号、学生卡照片）参赛了。
// 任何会「写数据」或「清数据」的脚本，动手之前先过这一层：
//   1. 测试脚本只允许打本机 / 局域网地址，绝不允许打线上地址；
//   2. 线上域名与服务器 IP 被硬编码为禁止目标，没有开关可以绕过；
//   3. 重置演示库必须显式确认，并且先把数据备份出来再删。
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 本机与局域网：可以随便跑写数据的测试
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'];
const PRIVATE_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// 本项目的线上环境：无论怎么设置都不允许跑会写数据的脚本
const PROD_HOSTS = ['bitsoccer.cn', 'www.bitsoccer.cn', '47.243.204.184'];

function warnBlock(title, lines) {
  const bar = '='.repeat(64);
  console.error(`\n${bar}\n${title}\n${bar}`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(`${bar}\n`);
}

// 测试脚本（会创建用户 / 改赛事状态 / 写比赛结果 / 删比赛）统一调用这个
export function assertSafeTestTarget(rawBase) {
  const base = String(rawBase || 'http://localhost:3000');
  let host = '';
  try {
    host = new URL(base).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`API_BASE 不是合法地址：${base}`);
  }
  if (PROD_HOSTS.includes(host)) {
    warnBlock('已阻止：这是本项目的线上环境', [
      `目标地址：${base}`,
      '测试脚本会创建账号、审核报名、写比赛结果、改赛事状态、删除比赛。',
      '线上已有同学的真实报名信息，跑一次就会污染真实数据。',
      '正确做法：在本机起一个临时库再跑测试（见 README「本地开发与测试」）。',
    ]);
    throw new Error('测试脚本禁止对线上环境运行（无绕过开关）');
  }
  if (LOCAL_HOSTS.includes(host) || PRIVATE_RE.test(host)) {
    console.log(`[安全] 测试目标 ${base}（本机 / 局域网，允许运行）`);
    return base;
  }
  if (process.env.GB_ALLOW_REMOTE_TESTS === '1') {
    warnBlock('警告：正在对非本机地址运行会写数据的测试', [
      `目标地址：${base}`,
      '请确认这是一次性测试库，不是任何人在用的环境。',
    ]);
    return base;
  }
  warnBlock('已阻止：目标不是本机地址', [
    `目标地址：${base}`,
    '测试脚本会写入并删除数据，默认只允许打本机 / 局域网。',
    '若确认该地址是一次性测试库，请设置 GB_ALLOW_REMOTE_TESTS=1 后再运行。',
  ]);
  throw new Error('测试脚本只允许对本机 / 局域网运行');
}

// reset-demo 会删除整个数据库与全部上传文件，必须显式确认
export function assertResetAllowed() {
  if (process.env.GB_CONFIRM_RESET_DEMO !== 'yes') {
    warnBlock('已阻止：reset-demo 会清空数据库与学生卡照片', [
      '这个脚本会删除 server/data/greensinbit.db 和 server/data/uploads 里的全部内容。',
      '线上已有同学的真实报名信息与上传的学生卡照片，勿在服务器上执行。',
      '确实要在本地演示库重置，请加环境变量后再运行：',
      '    GB_CONFIRM_RESET_DEMO=yes node scripts/reset-demo.mjs',
    ]);
    throw new Error('重置演示库需要显式确认（GB_CONFIRM_RESET_DEMO=yes）');
  }
  if (process.env.NODE_ENV === 'production') {
    warnBlock('已阻止：当前是生产环境', [
      'NODE_ENV=production 说明这是在线上服务器里运行。',
      'reset-demo 会清掉真实用户的报名信息与学生卡照片，已拒绝执行。',
    ]);
    throw new Error('生产环境禁止重置演示库');
  }
}

// 统计库里各类数据的条数，写进备份清单，方便日后确认备份有没有内容
// 数据目录解析：同一份数据在不同环境下路径不一样，写死一个必然出错
//   本地仓库：  <root>/server/data/{greensinbit.db, uploads}
//   服务器上：  <root>/data/{greensinbit.db, uploads}
//              （compose 把主机的 ./data 挂进容器，在容器里显示成 /app/server/data）
// 优先级：环境变量 → 哪个目录里真有 greensinbit.db → 哪个目录存在 → 默认 server/data
export function resolveDataPaths(root) {
  let base = null;
  let from = 'auto';
  const envDb = process.env.DB_FILE;
  if (envDb) {
    base = path.dirname(path.resolve(envDb));
    from = 'DB_FILE';
  } else {
    const candidates = [path.join(root, 'server', 'data'), path.join(root, 'data')];
    const withDb = candidates.find((d) => fs.existsSync(path.join(d, 'greensinbit.db')));
    const existing = candidates.find((d) => fs.existsSync(d));
    base = withDb || existing || candidates[0];
  }
  return {
    dir: base,
    from,
    dbFile: envDb || path.join(base, 'greensinbit.db'),
    uploadDir: process.env.UPLOAD_DIR || path.join(base, 'uploads'),
    backupsRoot: process.env.BACKUP_DIR || path.join(base, 'backups'),
  };
}

// 清理旧备份。只删「本脚本自己生成的备份目录」：
// 必须在 backupsRoot 下面，而且里面得有 manifest.json。
// 这样即使哪天目录配错了，也不会把 uploads 之类的真实目录删掉。
export function pruneBackups(backupsRoot, keep) {
  if (!fs.existsSync(backupsRoot)) return { removed: [], total: 0 };
  const dirs = fs.readdirSync(backupsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
  const removed = [];
  for (const name of dirs.slice(keep)) {
    const full = path.join(backupsRoot, name);
    if (path.dirname(path.resolve(full)) !== path.resolve(backupsRoot)) continue;
    if (!fs.existsSync(path.join(full, 'manifest.json'))) continue;
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(name);
  }
  return { removed, total: dirs.length };
}

function readCounts(dbFile) {
  const tables = ['users', 'events', 'registrations', 'registration_members',
    'matches', 'files', 'player_suspensions'];
  const out = {};
  try {
    const raw = new DatabaseSync(dbFile);
    for (const t of tables) {
      try {
        out[t] = raw.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      } catch { out[t] = null; }
    }
    raw.close();
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

// 生成一份「数据库 + 上传文件」的快照。
// 数据库用 SQLite 的 VACUUM INTO 做一致性快照，不需要停服务；
// 万一失败（例如库被占用）退化成文件拷贝，并在清单里标注。
export function snapshotData({ outDir, dbFile, uploadDir, label = 'backup' }) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = { label, outDir, createdAt: new Date().toISOString(), db: null, uploads: null, consistent: true };

  if (fs.existsSync(dbFile)) {
    const target = path.join(outDir, path.basename(dbFile));
    try {
      const raw = new DatabaseSync(dbFile);
      raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      raw.close();
    } catch (err) {
      fs.copyFileSync(dbFile, target);
      result.consistent = false;
      result.note = `VACUUM INTO 失败（${err.message}），已退化为文件拷贝`;
    }
    result.db = target;
    result.dbBytes = fs.statSync(target).size;
    result.counts = readCounts(target);
  } else {
    result.note = `数据库文件不存在：${dbFile}`;
  }

  if (fs.existsSync(uploadDir)) {
    const dest = path.join(outDir, path.basename(uploadDir));
    fs.cpSync(uploadDir, dest, { recursive: true });
    result.uploads = dest;
    result.uploadFiles = countFiles(dest);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'),
    `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

export function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else n += 1;
    }
  };
  try { walk(dir); } catch { /* 目录不存在 */ }
  return n;
}
