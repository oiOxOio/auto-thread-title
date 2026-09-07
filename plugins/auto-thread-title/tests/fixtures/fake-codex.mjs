/** Synthetic child-process CLI for tests. Never accesses a Codex installation. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const scenario = option('--scenario') ?? 'normal';
const audit = option('--audit');
const pidFile = option('--pid-file');
if (pidFile) writeFileSync(pidFile, String(process.pid));
const record = (value) => { if (audit) appendFileSync(audit, `${JSON.stringify(value)}\n`); };
if (args.includes('generate-json-schema')) {
  record({ action: 'schema', directory: option('--out') });
  if (scenario === 'schema-timeout') setInterval(() => {}, 1000);
  else if (scenario === 'schema-error') { process.stderr.write('synthetic-private-path'); process.exitCode = 2; }
  else {
    const directory = option('--out');
    const params = { title: 'ThreadListParams', type: 'object', properties: {
      useStateDbOnly: { type: 'boolean', default: false }, archived: { type: ['boolean', 'null'] },
      sourceKinds: { type: 'array', items: { type: 'string' } }, cursor: { type: ['string', 'null'] },
      limit: { type: ['integer', 'null'] }, sortKey: { type: ['string', 'null'], enum: ['created_at', 'updated_at', null] },
      sortDirection: { type: ['string', 'null'], enum: ['asc', 'desc', null] }, modelProviders: { type: 'array', items: { type: 'string' } },
    } };
    const response = { title: 'ThreadListResponse', type: 'object', properties: {
      data: { type: 'array', items: { type: 'object' } }, nextCursor: { type: ['string', 'null'] },
    }, required: ['data', 'nextCursor'] };
    if (scenario === 'schema-missing-field') delete params.properties.useStateDbOnly;
    if (scenario === 'schema-missing-cursor') delete response.properties.nextCursor;
    if (scenario === 'schema-definitions' || scenario === 'schema-defs') {
      delete params.title; delete response.title;
      writeFileSync(path.join(directory, 'protocol.json'), JSON.stringify({
        [scenario === 'schema-defs' ? '$defs' : 'definitions']: { ThreadListParams: params, ThreadListResponse: response },
      }));
    } else {
      mkdirSync(path.join(directory, 'v2'));
      writeFileSync(path.join(directory, 'v2', 'ThreadListParams.json'), scenario === 'schema-invalid' ? '{' : JSON.stringify(params));
      writeFileSync(path.join(directory, 'v2', 'ThreadListResponse.json'), JSON.stringify(response));
    }
  }
} else if (args.includes('app-server') && option('--listen') === 'stdio://') {
  if (scenario === 'ignore-terminate') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
  let initialized = false;
  let ready = false;
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  if (scenario === 'banner') process.stdout.write('Active code page: 65001\n');
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    const message = JSON.parse(line);
    record({ method: message.method, params: message.params });
    if (message.method === 'initialize') {
      if (initialized) process.exit(41);
      initialized = true;
      if (scenario === 'timeout-init') return;
      if (scenario === 'exit-init') process.exit(42);
      if (scenario === 'oversized-line') { process.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1, 120)); return; }
      send({ id: message.id, result: { userAgent: 'synthetic-test-agent' } });
    } else if (message.method === 'initialized') {
      if (!initialized || ready) process.exit(43);
      ready = true;
    } else if (message.method === 'thread/list') {
      if (!ready || message.params.useStateDbOnly !== true) process.exit(44);
      if (scenario === 'timeout-list') return;
      if (scenario === 'error-list') { send({ id: message.id, error: { message: 'synthetic-private-task-content' } }); return; }
      if (scenario === 'malformed-list') { process.stdout.write('synthetic-private-task-content\n'); return; }
      if (scenario === 'interactive') { send({ id: 800, method: 'item/commandExecution/requestApproval', params: {} }); return; }
      if (scenario === 'banner') {
        send({ method: 'synthetic/notification', params: {} });
        send({ id: message.id + 100, result: 'unrelated response' });
      }
      const all = message.params.archived ? [fakeTask('archived')] : [fakeTask('active-1'), fakeTask('active-2')];
      const start = Number(message.params.cursor ?? 0);
      const end = start + message.params.limit;
      send({ id: message.id, result: { data: all.slice(start, end), nextCursor: end < all.length ? String(end) : null } });
    } else process.exit(45);
  });
} else {
  process.stderr.write('Unsupported synthetic CLI command');
  process.exitCode = 46;
}

function fakeTask(id) {
  return { id, name: '待整理标题', source: 'appServer', createdAt: 1788451200,
    cwd: '/Users/synthetic/project', preview: 'synthetic-private-preview', ephemeral: false };
}
