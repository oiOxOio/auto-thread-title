/** Read only the current host's saved projects; never infer scope from recent tasks. */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isWithin, nativeAbsolute } from './config.mjs';
import { resolveCodex, withAppServer } from './transport.mjs';

const MAX_REGISTRY_BYTES = 16 * 1024 * 1024;
const MAX_PROJECTS = 10000;
const MAX_ROOTS = 20000;
const MAX_PAGES = 100;
const controls = /[\x00-\x1f\x7f]/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('Cannot read a valid current-host saved-project registry; automatic titles were skipped.');

function nativePath(value, options) {
  if (typeof value !== 'string' || value.length > 32768 || value.startsWith('~') || !nativeAbsolute(value, options)) throw invalid();
  return value;
}

function canonical(value, platform) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const normalized = api.normalize(value).replace(/[\\/]$/u, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function readRegistry(filename) {
  let file;
  try {
    file = await open(filename, 'r');
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_REGISTRY_BYTES) throw invalid();
    // Read at most the limit + 1 even if a concurrent writer grows the file.
    const buffer = Buffer.alloc(MAX_REGISTRY_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await file.read(buffer, size, buffer.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > MAX_REGISTRY_BYTES) throw invalid();
    return JSON.parse(buffer.subarray(0, size).toString('utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw invalid();
  } finally { await file?.close(); }
}

function migratedForHost(state, codexHome, options) {
  if (!Object.hasOwn(state, 'app-server-projects-migration-by-host')) return false;
  const migrations = state['app-server-projects-migration-by-host'];
  if (!object(migrations)) throw invalid();
  let migrated = false;
  for (const [key, value] of Object.entries(migrations)) {
    if (!key.startsWith('local:')) continue;
    const directory = key.slice('local:'.length);
    if (!nativeAbsolute(directory, options)) continue;
    const sameDirectory = canonical(directory, options.platform) === canonical(codexHome, options.platform)
      || (isWithin(directory, codexHome, options) && isWithin(codexHome, directory, options));
    if (!sameDirectory) continue;
    if (!object(value) || (Object.hasOwn(value, 'projectsMigrated') && typeof value.projectsMigrated !== 'boolean')) throw invalid();
    migrated ||= value.projectsMigrated === true;
  }
  return migrated;
}

function collectRoots(projects, options, source) {
  if (projects.length > MAX_PROJECTS) throw invalid();
  const uniqueRoots = new Map();
  const identities = new Map();
  let rootCount = 0;
  for (const project of projects) {
    if (!object(project) || typeof project.id !== 'string' || !project.id || project.id.length > 1024 || controls.test(project.id)
      || !Array.isArray(project.rootPaths)) throw invalid();
    rootCount += project.rootPaths.length;
    if (rootCount > MAX_ROOTS) throw invalid();
    const roots = project.rootPaths.map(value => nativePath(value, options));
    const identity = [...new Set(roots.map(value => canonical(value, options.platform)))].sort().join('\0');
    if (identities.has(project.id) && identities.get(project.id) !== identity) throw invalid();
    identities.set(project.id, identity);
    for (const root of roots) uniqueRoots.set(canonical(root, options.platform), root);
  }
  return { roots: [...uniqueRoots.values()], projectCount: identities.size, source };
}

async function listProjects(request, options) {
  const projects = [];
  const cursors = new Set();
  let rootCount = 0;
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request('project/list', { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (!object(response) || !Array.isArray(response.data) || response.data.length > 100
      || !Object.hasOwn(response, 'nextCursor')
      || (response.nextCursor !== null && (typeof response.nextCursor !== 'string' || !response.nextCursor
        || response.nextCursor.length > 16384 || controls.test(response.nextCursor)))) throw invalid();
    for (const project of response.data) {
      if (!object(project) || !Array.isArray(project.roots)) throw invalid();
      rootCount += project.roots.length;
      if (rootCount > MAX_ROOTS) throw invalid();
      projects.push({ id: project.id, rootPaths: project.roots.map(root => {
        if (!object(root)) throw invalid();
        return root.path;
      }) });
    }
    if (projects.length > MAX_PROJECTS) throw invalid();
    if (response.nextCursor === null) return collectRoots(projects, options, 'project/list');
    if (cursors.has(response.nextCursor)) throw invalid();
    cursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  throw invalid();
}

export async function discoverProjectRoots({ env = process.env, home = os.homedir(), platform = process.platform,
  getLaunch = () => resolveCodex({ env, platform }), readRegistry: read = readRegistry, withServer = withAppServer,
  timeoutMs = 2000, maxDurationMs = 5000 } = {}) {
  const options = { home, platform };
  const api = platform === 'win32' ? path.win32 : path.posix;
  const codexHome = nativePath(env.CODEX_HOME || api.join(home, '.codex'), options);
  let state;
  try { state = await read(api.join(codexHome, '.codex-global-state.json')); }
  catch { throw invalid(); }
  if (state !== undefined) {
    if (!object(state)) throw invalid();
    if (!migratedForHost(state, codexHome, options) && Object.hasOwn(state, 'local-projects')) {
      const registry = state['local-projects'];
      if (!object(registry)) throw invalid();
      const entries = Object.entries(registry);
      if (entries.length > MAX_PROJECTS) throw invalid();
      const projects = [];
      for (const [id, value] of entries) {
        if (!object(value) || (Object.hasOwn(value, 'id') && value.id !== id)) throw invalid();
        // Project names and all unrelated global state are intentionally unused.
        projects.push({ id, rootPaths: value.rootPaths });
      }
      return collectRoots(projects, options, 'local-projects');
    }
  }
  try {
    const launch = await getLaunch();
    return await withServer(launch, request => listProjects(request, options), {
      purpose: 'projects', env: { ...env, CODEX_HOME: codexHome }, timeoutMs, maxDurationMs,
    });
  } catch { throw new Error('Current saved projects could not be listed; use a compatible Codex runtime or explicit projectRoots. No automatic titles changed.'); }
}

const execute = promisify(execFile);
export function resolveGitExecutable({ env = process.env, platform = process.platform } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const pathKey = platform === 'win32' ? Object.keys(env).find(key => key.toUpperCase() === 'PATH') : 'PATH';
  const directories = (env[pathKey] || '').split(platform === 'win32' ? ';' : ':');
  for (const directory of directories) {
    if (!nativeAbsolute(directory, { platform }) || directory.startsWith('~')) continue;
    for (const name of platform === 'win32' ? ['git.exe', 'git.com'] : ['git']) {
      const candidate = api.join(directory, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        const actual = fs.realpathSync.native(candidate);
        if (/\.(?:cmd|bat|ps1)$/iu.test(actual)) continue;
        fs.accessSync(actual, platform === 'win32' ? fs.constants.R_OK : fs.constants.X_OK);
        return actual;
      } catch { /* Continue only through explicit absolute PATH directories. */ }
    }
  }
  throw new Error('Git was not found in an absolute PATH directory; worktree scope was skipped.');
}

async function runGit(cwd, options) {
  const env = Object.fromEntries(Object.entries(options.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const git = resolveGitExecutable({ env, platform: options.platform });
  return execute(git, ['-C', cwd, 'worktree', 'list', '--porcelain', '-z'], {
    shell: false, windowsHide: true, timeout: 1500, maxBuffer: 256 * 1024, encoding: 'utf8', env,
  });
}

export async function matchesSavedProject(cwd, roots, options = {}) {
  const { platform = process.platform, env = process.env, realpath = fs.realpathSync.native,
    stat = fs.statSync, runGit: git = runGit } = options;
  const matchOptions = { ...options, platform, realpath };
  if (!Array.isArray(roots) || !roots.length || !nativeAbsolute(cwd, matchOptions)) return false;
  try {
    if (!stat(cwd).isDirectory()) return false;
    // Resolve cwd even when roots are inaccessible; no Git command for missing paths.
    if (!nativeAbsolute(realpath(cwd), matchOptions)) return false;
  } catch { return false; }
  if (roots.some(root => isWithin(cwd, root, matchOptions))) return true;
  try {
    const result = await git(cwd, { env, platform });
    const stdout = typeof result === 'string' ? result : result.stdout;
    if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 256 * 1024 || !stdout.endsWith('\0')) return false;
    const worktrees = [];
    for (const record of stdout.split('\0')) {
      if (!record.startsWith('worktree ')) continue;
      const root = record.slice('worktree '.length);
      if (!nativeAbsolute(root, matchOptions) || controls.test(root)) return false;
      // Git retains removed worktrees until pruning; an unrelated stale entry
      // must not disable a healthy current worktree. Missing roots never match.
      try { if (!stat(root).isDirectory()) continue; } catch { continue; }
      worktrees.push(root);
      if (worktrees.length > 1000) return false;
    }
    const currentTrees = worktrees.filter(root => isWithin(cwd, root, matchOptions));
    const api = platform === 'win32' ? path.win32 : path.posix;
    for (const source of worktrees) {
      for (const saved of roots) {
        // A saved container can include the entire repository.
        if (isWithin(source, saved, matchOptions) && currentTrees.length) return true;
        // For a saved monorepo subfolder, carry only that relative subfolder
        // into the other worktree; never widen it to the whole repository.
        if (!isWithin(saved, source, matchOptions)) continue;
        const relative = api.relative(realpath(source), realpath(saved));
        if (currentTrees.some(tree => isWithin(cwd, api.join(tree, relative), matchOptions))) return true;
      }
    }
    return false;
  } catch { return false; }
}
