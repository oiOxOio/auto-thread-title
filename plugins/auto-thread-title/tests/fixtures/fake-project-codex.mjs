/** Project RPC-only fixture. Never accesses real Codex state or tasks. */
import { appendFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const scenario = option('--scenario') ?? 'normal';
const audit = option('--audit');
if (option('--pid-file')) writeFileSync(option('--pid-file'), String(process.pid));
if (args.includes('generate-json-schema') || !args.includes('app-server')) process.exit(40);
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
let initialized = false;
let ready = false;
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const message = JSON.parse(line);
  if (audit) appendFileSync(audit, `${JSON.stringify(message)}\n`);
  if (message.method === 'initialize') {
    if (initialized || message.params?.capabilities?.experimentalApi !== true) process.exit(41);
    initialized = true;
    send({ id: message.id, result: { userAgent: 'synthetic-project-agent' } });
  } else if (message.method === 'initialized') {
    if (!initialized || ready) process.exit(42);
    ready = true;
  } else if (message.method === 'project/list') {
    if (!ready) process.exit(43);
    if (scenario === 'timeout') return;
    if (scenario === 'incompatible') { send({ id: message.id, error: { message: 'synthetic-private-diagnostic' } }); return; }
    if (scenario === 'malformed') { process.stdout.write('synthetic-private-diagnostic\n'); return; }
    const project = { id: message.params.cursor ? 'second' : 'first', roots: [{ path: process.cwd() }], name: 'synthetic-private-project-name' };
    send({ id: message.id, result: { data: [project], nextCursor: scenario === 'pagination' && !message.params.cursor ? 'second-page' : null } });
  } else process.exit(44);
});
