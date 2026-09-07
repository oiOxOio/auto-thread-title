import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const PLUGIN_ROOT = fileURLToPath(new URL('../', import.meta.url));
const KEYS = new Set(['enabled', 'projectRoots', 'timezone', 'topicMaxLength', 'codexPath']);
const controls = /[\x00-\x1f\x7f]/u;
export function windowsAbsolute(value) {
  return /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(value);
}

export function expandHome(value, home = os.homedir(), platform = process.platform) {
  if (value === '~') return home;
  if (value.startsWith('~/') || (platform === 'win32' && value.startsWith('~\\'))) {
    return (platform === 'win32' ? path.win32 : path.posix).join(home, value.slice(2));
  }
  return value;
}

export function nativeAbsolute(value, { platform = process.platform, home = os.homedir() } = {}) {
  if (typeof value !== 'string' || !value.trim() || controls.test(value)) return null;
  const expanded = expandHome(value, home, platform);
  if (platform === 'win32') return windowsAbsolute(expanded) ? expanded : null;
  return expanded.startsWith('/') && !expanded.startsWith('//') ? expanded : null;
}

export function isWithin(cwd, root, options = {}) {
  const { platform = process.platform, realpath = fs.realpathSync.native } = options;
  const candidate = nativeAbsolute(cwd, options);
  const boundary = nativeAbsolute(root, options);
  if (!candidate || !boundary) return false;
  try {
    const api = platform === 'win32' ? path.win32 : path.posix;
    const canon = value => {
      const result = api.normalize(realpath(value));
      return platform === 'win32' ? result.toLowerCase() : result;
    };
    const relative = api.relative(canon(boundary), canon(candidate));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative));
  } catch { return false; }
}

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Config must be a JSON object.');
  if (Object.keys(value).some(key => !KEYS.has(key))) throw new Error('Unknown config field; check the documented config schema.');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean.');
  if (!Array.isArray(value.projectRoots) || value.projectRoots.some(root =>
    typeof root !== 'string' || !root.trim() || controls.test(root) ||
    !(windowsAbsolute(root) || root.startsWith('/') || root === '~' || root.startsWith('~/') || root.startsWith('~\\')))) {
    throw new Error('projectRoots must contain absolute directories or ~/ paths; relative paths are rejected.');
  }
  if (value.timezone !== 'Asia/Shanghai' || value.topicMaxLength !== 18) {
    throw new Error('All title modes use timezone Asia/Shanghai and topicMaxLength 18.');
  }
  if (value.codexPath !== undefined && value.codexPath !== null &&
      (typeof value.codexPath !== 'string' || controls.test(value.codexPath) ||
       !(windowsAbsolute(value.codexPath) || value.codexPath.startsWith('/')))) {
    throw new Error('codexPath must be an absolute executable path.');
  }
  return value;
}

export function configPath({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const base = env.CODEX_HOME || api.join(home, '.codex');
  const result = env.AUTO_THREAD_TITLE_CONFIG || api.join(base, 'auto-thread-title', 'config.json');
  const absolute = nativeAbsolute(result, { home, platform });
  if (!absolute) throw new Error('Config location must be an absolute native path.');
  return absolute;
}

function readJson(filename) {
  try {
    if (fs.statSync(filename).size > 128 * 1024) throw new Error('oversize');
    const raw = fs.readFileSync(filename, 'utf8');
    if (Buffer.byteLength(raw) > 128 * 1024) throw new Error('oversize');
    return JSON.parse(raw.replace(/^\uFEFF/u, ''));
  } catch { throw new Error('Cannot read valid plugin configuration; no automatic titles changed.'); }
}

export function loadConfig(options = {}) {
  const filename = configPath(options);
  const defaults = readJson(path.join(PLUGIN_ROOT, 'config.json'));
  let custom = {};
  try { fs.lstatSync(filename); custom = readJson(filename); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new Error('Config must be a JSON object.');
  const config = validateConfig({ ...defaults, ...custom });
  return { config, filename, customized: Object.keys(custom).length > 0 };
}

// Only the explicit configure command calls this. Hooks and inventories never write config.
export function saveConfig(config, options = {}) {
  validateConfig(config);
  const filename = configPath(options);
  const parent = path.dirname(filename);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.config-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return filename;
}
