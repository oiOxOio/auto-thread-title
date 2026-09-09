import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeAbsolute } from './config.mjs';
import { resolveCodex } from './transport.mjs';

// Desktop maintains this executable for local plugin operations. Prefer it to
// a separately installed CLI, which can lag behind the desktop project API.
export function resolveProjectCodex({ executable, env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (executable !== undefined || env.AUTO_THREAD_TITLE_CODEX !== undefined) {
    return resolveCodex({ executable, env, platform });
  }
  const api = platform === 'win32' ? path.win32 : path.posix;
  const codexHome = nativeAbsolute(env.CODEX_HOME || api.join(home, '.codex'), { platform, home });
  if (!codexHome) throw new Error('Codex home must be an absolute native directory.');
  const desktop = api.join(codexHome, 'plugins', '.plugin-appserver', platform === 'win32' ? 'codex.exe' : 'codex');
  let available = false;
  try { available = fs.statSync(desktop).isFile(); } catch { /* Standalone CLI installation. */ }
  return resolveCodex({ ...(available ? { executable: desktop } : {}), env, platform });
}
