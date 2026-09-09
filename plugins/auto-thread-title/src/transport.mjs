/** Bounded, shell-free local CLI transport with a read-only RPC allowlist. */
import { spawn } from 'node:child_process';
import { constants, accessSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SOURCE_KINDS } from './inventory.mjs';

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STDOUT_BYTES = 256 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_SCHEMA_BYTES = 64 * 1024 * 1024;
const ALLOWED_LIST_KEYS = new Set(['limit', 'sortKey', 'sortDirection', 'modelProviders', 'sourceKinds', 'archived', 'useStateDbOnly', 'cursor']);
const ALLOWED_PROJECT_KEYS = new Set(['limit', 'cursor']);
const STARTUP_THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;

function usableFile(file, platform) {
  try {
    if (!statSync(file).isFile()) return false;
    const target = realpathSync(file);
    accessSync(target, platform === 'win32' || /\.[cm]?js$/i.test(target) ? constants.R_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

function readPath(env, platform) {
  const key = platform === 'win32' ? Object.keys(env).find((name) => name.toUpperCase() === 'PATH') : 'PATH';
  return typeof env[key] === 'string' ? env[key] : '';
}

export function resolveCodex({ executable, env = process.env, platform = process.platform } = {}) {
  const override = executable !== undefined ? executable : env.AUTO_THREAD_TITLE_CODEX;
  const supplied = override !== undefined;
  if (supplied && (typeof override !== 'string' || !override.trim() || /[\0\r\n]/.test(override))) {
    throw new Error('Invalid Codex CLI override; set --codex or AUTO_THREAD_TITLE_CODEX to an existing executable');
  }
  const requested = supplied ? override : 'codex';
  const separator = platform === 'win32' ? ';' : ':';
  // Ignore empty/relative PATH entries: never implicitly execute a workspace file.
  const directories = readPath(env, platform).split(separator).filter((directory) => directory && path.isAbsolute(directory));
  if (!supplied) directories.push(path.dirname(process.execPath));
  const isPath = path.isAbsolute(requested) || /[/\\]/.test(requested);
  const names = platform === 'win32' && !/\.(?:exe|com|cmd|bat|ps1|[cm]?js)$/i.test(requested)
    ? [`${requested}.exe`, `${requested}.cmd`, `${requested}.bat`, requested] : [requested];
  const candidates = isPath ? [path.resolve(requested)] : [...new Set(directories)].flatMap((directory) => names.map((name) => path.join(directory, name)));
  const selected = candidates.find((candidate) => usableFile(candidate, platform));
  if (!selected) {
    throw new Error(supplied
      ? 'Configured Codex CLI was not found or is not executable; fix --codex or AUTO_THREAD_TITLE_CODEX (no fallback was used)'
      : 'Codex CLI was not found in PATH; install a compatible CLI or set --codex / AUTO_THREAD_TITLE_CODEX');
  }
  let target;
  try { target = realpathSync(selected); }
  catch { throw new Error('Codex CLI entry point could not be resolved; check its installation'); }
  if (platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(target)) {
    // npm shims are shell scripts. Never feed user-controlled paths through cmd.
    const script = path.join(path.dirname(target), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    try {
      if (statSync(script).isFile()) return { file: process.execPath, args: [realpathSync(script)] };
    } catch { /* A custom wrapper is not an npm installation. */ }
    throw new Error('Unsupported Windows Codex wrapper; select codex.exe or install the official npm CLI with its adjacent codex.js entry point');
  }
  // POSIX npm installs an extensionless `codex` symlink to codex.js. Execute
  // its real JavaScript target with this known-good Node, not its env shebang:
  // desktop launchers may have located Node while GUI PATH still lacks it.
  if (/\.[cm]?js$/i.test(target)) return { file: process.execPath, args: [target] };
  return { file: selected, args: [] };
}

function validateLaunch(launch) {
  if (!launch || typeof launch.file !== 'string' || !launch.file || /[\0\r\n]/.test(launch.file)
      || !Array.isArray(launch.args) || launch.args.some((arg) => typeof arg !== 'string' || /\0/.test(arg))) {
    throw new Error('Invalid CLI launch specification');
  }
  if (/\.(cmd|bat|ps1)$/i.test(launch.file)) {
    throw new Error('Shell wrappers cannot be launched directly; resolve the CLI executable first');
  }
}

function validTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Error('Invalid app-server timeout');
}

async function stopProcess(child) {
  // Flush initialized / the last request before EOF. Destroying stdin then
  // immediately terminating can discard a buffered notification on Windows.
  child.stdin?.end();
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    let terminateTimer;
    let forceTimer;
    let finishTimer;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(terminateTimer);
      clearTimeout(forceTimer);
      clearTimeout(finishTimer);
      child.off('close', done);
      resolve();
    };
    child.once('close', done);
    terminateTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* Already exited. */ } }, 200);
    forceTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* Already exited. */ } }, 700);
    finishTimer = setTimeout(done, 1700);
  });
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function generateSchema(launch, directory, timeoutMs) {
  const child = spawn(launch.file, [...launch.args, 'app-server', 'generate-json-schema', '--out', directory], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let outputBytes = 0;
      const timer = setTimeout(() => reject(new Error('CLI capability check timed out; inventory was not started')), timeoutMs);
      const rejectSafe = (message) => { clearTimeout(timer); reject(new Error(message)); };
      const count = (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_STDERR_BYTES) rejectSafe('CLI capability check exceeded its output limit; inventory was not started');
      };
      child.stdout.on('data', count);
      child.stderr.on('data', count);
      child.on('error', () => rejectSafe('Could not launch Codex CLI; check its executable and runtime dependencies'));
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else rejectSafe('CLI schema generation failed; install a compatible Codex CLI (inventory was not started)');
      });
    });
  } finally { await stopProcess(child); }
}

async function inspectSchemas(directory, deadline) {
  const found = new Map();
  const pending = [{ directory, depth: 0 }];
  let totalBytes = 0;
  let entriesSeen = 0;
  let nodesSeen = 0;
  while (pending.length) {
    if (Date.now() > deadline) throw new Error('CLI capability check timed out; inventory was not started');
    const next = pending.pop();
    const entries = await readdir(next.directory, { withFileTypes: true });
    entriesSeen += entries.length;
    if (entriesSeen > 10000 || next.depth > 8) throw new Error('CLI schema exceeded safety limits; inventory was not started');
    for (const entry of entries) {
      if (Date.now() > deadline) throw new Error('CLI capability check timed out; inventory was not started');
      const file = path.join(next.directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('CLI schema contains unsupported links; inventory was not started');
      if (entry.isDirectory()) { pending.push({ directory: file, depth: next.depth + 1 }); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const size = (await stat(file)).size;
      totalBytes += size;
      if (size > 16 * 1024 * 1024 || totalBytes > MAX_SCHEMA_BYTES) throw new Error('CLI schema exceeded safety limits; inventory was not started');
      let document;
      try { document = JSON.parse(await readFile(file, 'utf8')); }
      catch { throw new Error('CLI generated an invalid JSON schema; inventory was not started'); }
      const stack = [{ value: document, name: entry.name.replace(/\.json$/, '') }];
      while (stack.length) {
        const { value, name } = stack.pop();
        if (!value || typeof value !== 'object') continue;
        nodesSeen += 1;
        if (nodesSeen > 500000) throw new Error('CLI schema exceeded safety limits; inventory was not started');
        const identity = value.title === 'ThreadListParams' || value.title === 'ThreadListResponse' ? value.title : name;
        if ((identity === 'ThreadListParams' || identity === 'ThreadListResponse') && value.properties && typeof value.properties === 'object') {
          found.set(identity, new Set(Object.keys(value.properties)));
        }
        // Walk only schema containers, not descriptions or arbitrary sample data.
        for (const container of ['definitions', '$defs']) {
          for (const [childName, child] of Object.entries(value[container] ?? {})) stack.push({ value: child, name: childName });
        }
        for (const child of Object.values(value.properties ?? {})) stack.push({ value: child, name: '' });
        for (const key of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(value[key])) for (const child of value[key]) stack.push({ value: child, name: '' });
        if (value.items && typeof value.items === 'object') stack.push({ value: value.items, name: '' });
      }
    }
  }
  const params = found.get('ThreadListParams');
  const response = found.get('ThreadListResponse');
  if (!['useStateDbOnly', 'archived', 'sourceKinds', 'cursor', 'limit', 'sortKey', 'sortDirection', 'modelProviders'].every((key) => params?.has(key))
      || !['data', 'nextCursor'].every((key) => response?.has(key))) {
    throw new Error('Codex CLI lacks required state-only task listing or cursor support; upgrade the CLI (inventory was not started)');
  }
  return { stateDbOnly: true, archived: true, sourceKinds: true, pagination: true };
}

export async function probeCapabilities(launch, { timeoutMs = 10000 } = {}) {
  validateLaunch(launch);
  validTimeout(timeoutMs);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'auto-thread-title-schema-'));
  const deadline = Date.now() + timeoutMs;
  try {
    await generateSchema(launch, directory, timeoutMs);
    return await inspectSchemas(directory, deadline);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function validateListRequest(method, params) {
  if (method !== 'thread/list' || !params || typeof params !== 'object' || Array.isArray(params)
      || Object.keys(params).some((key) => !ALLOWED_LIST_KEYS.has(key))
      || params.useStateDbOnly !== true || typeof params.archived !== 'boolean'
      || params.sortKey !== 'created_at' || params.sortDirection !== 'desc'
      || !Array.isArray(params.modelProviders) || params.modelProviders.length !== 0
      || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 200
      || !Array.isArray(params.sourceKinds) || !params.sourceKinds.length
      || params.sourceKinds.some((kind) => !SOURCE_KINDS.includes(kind))
      || (Object.hasOwn(params, 'cursor') && (typeof params.cursor !== 'string' || !params.cursor || params.cursor.length > 16384))) {
    throw new Error('Only bounded, state-only, read-only task inventory requests are allowed');
  }
}

function validateProjectRequest(method, params) {
  if (method !== 'project/list' || !params || typeof params !== 'object' || Array.isArray(params)
      || Object.keys(params).some((key) => !ALLOWED_PROJECT_KEYS.has(key))
      || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 100
      || (Object.hasOwn(params, 'cursor') && (typeof params.cursor !== 'string' || !params.cursor
        || params.cursor.length > 16384 || /[\x00-\x1f\x7f]/u.test(params.cursor)))) {
    throw new Error('Only bounded, read-only saved-project listing requests are allowed');
  }
}

function validateMetadataRequest(method, params, threadId) {
  if (method !== 'thread/read' || !params || typeof params !== 'object' || Array.isArray(params)
      || Object.keys(params).length !== 2 || !Object.hasOwn(params, 'threadId') || !Object.hasOwn(params, 'includeTurns')
      || params.threadId !== threadId || params.includeTurns !== false) {
    throw new Error('Only the bound startup task may be read with includeTurns explicitly false');
  }
}

export async function withAppServer(launch, callback, { timeoutMs = 30000, maxDurationMs = 120000, purpose = 'inventory', threadId, env = process.env } = {}) {
  validateLaunch(launch);
  validTimeout(timeoutMs);
  validTimeout(maxDurationMs);
  if (!['inventory', 'projects', 'metadata'].includes(purpose)) throw new Error('Invalid read-only app-server purpose');
  if (purpose === 'metadata' && (typeof threadId !== 'string' || !STARTUP_THREAD_ID.test(threadId))) {
    throw new Error('Metadata reads require a valid bound startup task ID');
  }
  if (typeof callback !== 'function') throw new Error('An inventory callback is required');
  const child = spawn(launch.file, [...launch.args, 'app-server', '--listen', 'stdio://'], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
  });
  let closing = false;
  let fatalError;
  let pending;
  let sequence = 0;
  let metadataReadSent = false;
  let totalBytes = 0;
  let stderrBytes = 0;
  let messageCount = 0;
  let segments = [];
  let lineBytes = 0;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  failure.catch(() => {});
  const fail = (message) => {
    if (closing || fatalError) return;
    fatalError = new Error(message);
    if (pending) { clearTimeout(pending.timer); pending.reject(fatalError); pending = undefined; }
    rejectFailure(fatalError);
  };
  const deadline = setTimeout(() => fail('Whole inventory time limit reached; inventory is incomplete'), maxDurationMs);
  child.on('error', () => fail('Could not launch Codex CLI; check its executable and runtime dependencies'));
  child.stdin.on('error', () => fail('Local app-server input closed before inventory completed'));
  child.stdout.on('error', () => fail('Local app-server output closed before inventory completed'));
  child.stderr.on('error', () => fail('Local app-server diagnostic stream failed'));
  child.on('close', () => fail('Local app-server closed before completing inventory'));
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_STDERR_BYTES) fail('Local app-server exceeded diagnostic output limit');
  });
  const receive = (line) => {
    if (fatalError || closing || !line.length) return;
    messageCount += 1;
    if (messageCount > 100000) { fail('Local app-server exceeded message limit'); return; }
    let message;
    try { message = JSON.parse(line.toString('utf8')); }
    catch {
      if (/^Active code page: \d+\r?$/.test(line.toString('utf8'))) return;
      fail('Local app-server emitted invalid protocol data'); return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { fail('Local app-server emitted invalid protocol data'); return; }
    if (Object.hasOwn(message, 'id') && typeof message.method === 'string') { fail('Local app-server requested an unsupported interactive action'); return; }
    if (!pending || message.id !== pending.id) return;
    if (Object.hasOwn(message, 'error')) { fail('Local app-server rejected the read-only request; check CLI compatibility'); return; }
    if (!Object.hasOwn(message, 'result')) { fail('Local app-server returned an invalid response'); return; }
    clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = undefined;
    resolve(message.result);
  };
  child.stdout.on('data', (chunk) => {
    if (fatalError || closing) return;
    totalBytes += chunk.length;
    if (totalBytes > MAX_STDOUT_BYTES) { fail('Local app-server exceeded total output limit'); return; }
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      lineBytes += part.length;
      if (lineBytes > MAX_LINE_BYTES) { fail('Local app-server response exceeded line limit'); return; }
      if (part.length) segments.push(part);
      if (newline < 0) break;
      receive(Buffer.concat(segments, lineBytes));
      segments = []; lineBytes = 0;
      if (fatalError) return;
      offset = newline + 1;
    }
  });
  const send = (message) => {
    const readMethod = purpose === 'projects' ? 'project/list' : purpose === 'metadata' ? 'thread/read' : 'thread/list';
    if (!['initialize', 'initialized', readMethod].includes(message.method)) throw new Error('Only read-only inventory methods are allowed');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const rpc = (method, params) => {
    if (closing || fatalError) return Promise.reject(fatalError ?? new Error('Read-only app-server session is closed'));
    if (pending) return Promise.reject(new Error('Concurrent inventory requests are not supported'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending = { id, resolve, reject, timer: setTimeout(() => fail('Local app-server request timed out; no titles changed'), timeoutMs) };
      try { send({ id, method, params }); }
      catch { fail('Local app-server request could not be sent'); }
    });
  };
  const request = async (method, params) => {
    if (purpose === 'metadata') {
      validateMetadataRequest(method, params, threadId);
      if (metadataReadSent) throw new Error('Only one startup metadata read is allowed per session');
      metadataReadSent = true;
      // Serialize only the validated bound identity, never caller-controlled
      // getters, later mutations, or a custom params.toJSON implementation.
      return rpc('thread/read', { threadId, includeTurns: false });
    }
    (purpose === 'projects' ? validateProjectRequest : validateListRequest)(method, params);
    return rpc(method, params);
  };
  try {
    await rpc('initialize', {
      clientInfo: { name: `auto_thread_title_${purpose}`, version: '2.0.0' },
      ...(purpose === 'projects' ? { capabilities: { experimentalApi: true } } : {}),
    });
    send({ method: 'initialized', params: {} });
    return await Promise.race([Promise.resolve().then(() => callback(request)), failure]);
  } finally {
    closing = true;
    clearTimeout(deadline);
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Read-only app-server session closed')); pending = undefined; }
    segments = [];
    await stopProcess(child);
  }
}
