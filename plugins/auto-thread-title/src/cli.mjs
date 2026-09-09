#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig, saveConfig, nativeAbsolute, isWithin } from './config.mjs';
import { buildContext, eligibleStartup } from './policy.mjs';
import { discoverProjectRoots, matchesSavedProject } from './projects.mjs';
import { resolveProjectCodex } from './project-runtime.mjs';
import { collectTasks } from './inventory.mjs';
import { resolveCodex, probeCapabilities, withAppServer } from './transport.mjs';

const HELP = `Auto Thread Title — Node.js 22+, no npm dependencies
Usage: node <plugin>/src/cli.mjs <command> [options]
  hook                 Read one SessionStart JSON event on stdin; never writes titles directly
  doctor [--probe] [--projects] Check runtime; --projects checks saved project scope, not tasks
  configure            Save user config outside the plugin installation
    --scope projects|manual Follow saved Codex projects (default), or use explicit roots
    --project-root ABS Repeat to replace the automatic scope with explicit directories
    --add-project-root ABS Repeat to add directories without changing existing roots
    --enable | --disable
    --codex ABS         Persist an explicit Codex executable path
  inventory            Complete read-only local task inventory, then optional output slicing
    --codex ABS --page-size 1..200 --needs-review --summary-only
    --offset N --limit N
Environment: AUTO_THREAD_TITLE_NODE (launcher), AUTO_THREAD_TITLE_CONFIG,
             AUTO_THREAD_TITLE_CODEX; existing CODEX_HOME is respected.
No command in this helper renames tasks. Batch renaming requires desktop tools and confirmation.
`;

function parse(argv) {
  const [command, ...tokens] = argv;
  if (!command || command === '--help' || command === 'help') return { command: 'help' };
  const rules = {
    hook: {},
    doctor: { '--probe': 'boolean', '--projects': 'boolean', '--codex': 'value' },
    configure: { '--scope': 'value', '--project-root': 'repeat', '--add-project-root': 'repeat', '--enable': 'boolean', '--disable': 'boolean', '--codex': 'value' },
    inventory: { '--codex': 'value', '--page-size': 'number', '--needs-review': 'boolean', '--summary-only': 'boolean', '--offset': 'number', '--limit': 'number' },
  };
  if (!rules[command]) throw new Error('Unknown command. Use --help.');
  const options = { command };
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index], kind = rules[command][key];
    if (!kind) throw new Error('Unknown option. Use --help.');
    if (kind !== 'repeat' && key in options) throw new Error('Duplicate option.');
    if (kind === 'boolean') { options[key] = true; continue; }
    const value = tokens[++index];
    if (!value || value.startsWith('--')) throw new Error('Option requires a value.');
    if (kind === 'number') {
      if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Numeric options must be non-negative safe integers.');
      options[key] = Number(value);
    } else if (kind === 'repeat') (options[key] ??= []).push(value);
    else options[key] = value;
  }
  if (options['--enable'] && options['--disable']) throw new Error('Choose --enable or --disable, not both.');
  if (options['--project-root'] && options['--add-project-root']) throw new Error('Choose root replacement or addition, not both.');
  if (options['--scope'] && !['projects', 'manual'].includes(options['--scope'])) throw new Error('scope must be projects or manual.');
  if (options['--scope'] === 'projects' && (options['--project-root'] || options['--add-project-root'])) throw new Error('Choose saved projects or explicit roots, not both.');
  if (options['--page-size'] !== undefined && !(options['--page-size'] >= 1 && options['--page-size'] <= 200)) throw new Error('page-size must be 1..200.');
  if (options['--limit'] === 0) throw new Error('limit must be at least 1.');
  return options;
}

async function readEvent() {
  let size = 0;
  const parts = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Hook event exceeds the input limit.');
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/u, '')); }
  catch { return null; }
}

function emit(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const options = parse(process.argv.slice(2));
  if (options.command === 'help') { process.stdout.write(HELP); return; }
  const { config, filename } = loadConfig();
  const executable = options['--codex'] || process.env.AUTO_THREAD_TITLE_CODEX || config.codexPath;
  const getLaunch = () => resolveProjectCodex({ executable });
  if (options.command === 'hook') {
    const event = await readEvent();
    // Ineligible events must not read project metadata or start any subprocess.
    if (!eligibleStartup(event, config) || !nativeAbsolute(event.cwd)) return;
    let effective = config;
    if (config.scope === 'projects') {
      const { roots } = await discoverProjectRoots({ getLaunch });
      if (!await matchesSavedProject(event.cwd, roots)) return;
      effective = { ...config, projectRoots: [event.cwd] };
    }
    const context = buildContext(event, effective);
    if (context) emit({ continue: true, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
    return;
  }
  if (options.command === 'configure') {
    if (Object.keys(options).length === 1) throw new Error('Specify a configuration change; use --help.');
    const requestedRoots = options['--project-root'] || options['--add-project-root'];
    if (options['--scope']) config.scope = options['--scope'];
    if (requestedRoots) {
      const validatedRoots = requestedRoots.map(root => {
        const absolute = nativeAbsolute(root);
        if (!absolute) throw new Error('Project root must be an absolute native directory (or ~/).');
        try { if (fs.statSync(absolute).isDirectory()) return fs.realpathSync.native(absolute); } catch {}
        throw new Error('Project root must be an existing accessible directory.');
      });
      config.projectRoots = [...new Set([...(options['--add-project-root'] ? config.projectRoots : []), ...validatedRoots])];
      config.scope = 'manual';
    }
    if (options['--enable']) config.enabled = true;
    if (options['--disable']) config.enabled = false;
    if (options['--codex']) {
      if (!nativeAbsolute(options['--codex'])) throw new Error('Codex override must be an absolute native path.');
      resolveCodex({ executable: options['--codex'] });
      config.codexPath = options['--codex'];
    }
    emit({ saved: saveConfig(config), automaticEnabled: config.enabled, scope: config.scope, projectRootCount: config.projectRoots.length });
    return;
  }
  // Environment override is handled by resolveCodex; a CLI flag takes precedence over saved config.
  if (options.command === 'doctor') {
    const roots = config.projectRoots.map(root => {
      const local = nativeAbsolute(root);
      let accessible = false;
      try { accessible = !!local && fs.statSync(local).isDirectory(); } catch {}
      return { native: !!local, accessible };
    });
    let launch, cliError;
    try { launch = config.scope === 'projects' ? getLaunch() : resolveCodex({ executable }); }
    catch (error) { cliError = error.message; }
    let api = { checked: false };
    if (options['--probe'] && launch) {
      try { api = { checked: true, supported: true, details: await probeCapabilities(launch) }; }
      catch (error) { api = { checked: true, supported: false, error: error.message }; }
    }
    let projectDiscovery = { checked: false };
    if (options['--projects'] && config.scope === 'projects') {
      try {
        const projects = await discoverProjectRoots({ getLaunch });
        projectDiscovery = {
          checked: true, supported: true, source: projects.source, projectCount: projects.projectCount,
          rootCount: projects.roots.length,
          accessibleRootCount: projects.roots.filter(root => isWithin(root, root)).length,
          currentDirectoryMatched: await matchesSavedProject(process.cwd(), projects.roots),
        };
      } catch (error) { projectDiscovery = { checked: true, supported: false, error: error.message }; }
    }
    const automaticReady = !config.enabled ? false : config.scope === 'projects'
      ? (projectDiscovery.checked ? !!projectDiscovery.supported && projectDiscovery.accessibleRootCount > 0 : null)
      : roots.some(root => root.accessible);
    const result = {
      node: process.versions.node, platform: process.platform, architecture: process.arch,
      configPath: filename, automaticEnabled: config.enabled, scope: config.scope, automaticScopeReady: automaticReady,
      projectDiscovery,
      roots, cliFound: !!launch, cli: launch ?? null, ...(cliError ? { cliError } : {}), api,
      desktopTools: 'Not checked: discover local read_thread/set_thread_title in the host before renaming.',
      note: 'A valid runtime is not desktop end-to-end verification. No task data was read.',
    };
    emit(result);
    if (!launch || (api.checked && !api.supported) || (projectDiscovery.checked && !projectDiscovery.supported)) process.exitCode = 1;
    return;
  }
  const launch = resolveCodex({ executable });
  await probeCapabilities(launch);
  const result = await withAppServer(launch, request => collectTasks(request, { pageSize: options['--page-size'] ?? 100 }));
  if (options['--summary-only']) {
    delete result.tasks;
  } else {
    const eligible = options['--needs-review'] ? result.tasks.filter(row => !row.formatted) : result.tasks;
    const offset = options['--offset'] ?? 0;
    const limit = options['--limit'] ?? eligible.length;
    result.tasks = eligible.slice(offset, offset + limit);
    result.outputTotal = eligible.length;
    result.offset = offset;
    result.nextOffset = offset + result.tasks.length < eligible.length ? offset + result.tasks.length : null;
    result.outputComplete = offset === 0 && result.nextOffset === null;
  }
  emit(result);
}

process.stdout.on('error', error => {
  if (error.code === 'EPIPE') process.exit(1);
  throw error;
});
main().catch(error => {
  // Errors are sanitized by the underlying config/transport helpers; never print event/task data.
  const hook = process.argv[2] === 'hook';
  process.stderr.write(`${JSON.stringify({ complete: false, error: error.message || 'Plugin failed; no titles changed.' })}\n`);
  process.exitCode = hook ? 0 : 1;
});
