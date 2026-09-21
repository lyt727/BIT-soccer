// =============================================================
// 极简 .env 加载器（零依赖，刻意不引入 dotenv 包）。
// 启动时把 <仓库根目录>/.env（或 server/.env）读入 process.env，
// 供后续 config.js 读取。已存在的真实环境变量优先，不会被 .env 覆盖。
// 该文件以“副作用模块”方式被 config.js 最先 import，
// 从而保证任何入口（node src/index.js、脚本、测试）在读取配置前完成加载。
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析单行 "KEY=VALUE"（支持去首尾引号，key 仅限常规标识符）
function parseLine(line) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!m) return null;
  let value = m[2].trim();
  if (value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }
  return { key: m[1], value };
}

export function loadEnv() {
  // server/src/.. → server → 仓库根目录
  const candidates = [
    path.join(__dirname, '..', '..', '.env'), // 仓库根目录（与 .env.example 同级）
    path.join(__dirname, '..', '.env'),       // server/.env
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    let loaded = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
        loaded += 1;
      }
    }
    console.log(`[env] 已加载 ${file}（${loaded} 项生效）`);
    return true;
  }
  return false;
}

// 模块副作用：被 import 即完成加载
loadEnv();
