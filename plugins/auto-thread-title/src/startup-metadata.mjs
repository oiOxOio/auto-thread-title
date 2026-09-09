/** Optional metadata preflight. No model turns, transcript output, or title writes. */
import { isWithin, nativeAbsolute } from './config.mjs';
import { isFormatted, shanghaiMmdd, SOURCE_KINDS } from './inventory.mjs';
import { withAppServer } from './transport.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function classifyStartupMetadata(event, response, pathOptions = {}) {
  const thread = response?.thread;
  if (!object(thread) || typeof thread.id !== 'string') return { status: 'fallback' };
  // An explicit identity/scope mismatch must never cause a model-side retry.
  if (thread.id !== event.session_id || !nativeAbsolute(thread.cwd, pathOptions)
      || !isWithin(thread.cwd, event.cwd, pathOptions) || !isWithin(event.cwd, thread.cwd, pathOptions)
      || thread.ephemeral === true || thread.parentThreadId != null
      || (thread.source !== undefined && !SOURCE_KINDS.includes(thread.source))) return { status: 'skip' };
  const mmdd = shanghaiMmdd(thread.createdAt);
  if (!mmdd || thread.ephemeral !== false || typeof thread.source !== 'string'
      || !Array.isArray(thread.turns) || thread.turns.length
      || (thread.name != null && typeof thread.name !== 'string')) return { status: 'fallback' };
  if (isFormatted(thread.name, mmdd, event.cwd)) return { status: 'skip' };
  // Do not pass name, preview, turns, session-tree IDs or other metadata to the model.
  return { status: 'ready', mmdd };
}

export async function readStartupMetadata(event, { getLaunch, startedAt = Date.now(), now = Date.now } = {}) {
  // Leave room for process cleanup and the original policy under the 10s hook
  // timeout. Slow project discovery must not lose its already-confirmed scope.
  if (now() - startedAt >= 5000) return { status: 'fallback' };
  try {
    const response = await withAppServer(getLaunch(), request => request('thread/read', {
      threadId: event.session_id, includeTurns: false,
    }), { purpose: 'metadata', threadId: event.session_id, timeoutMs: 600, maxDurationMs: 800 });
    return classifyStartupMetadata(event, response);
  } catch {
    // Includes older CLI versions and threads not yet visible across processes.
    return { status: 'fallback' };
  }
}
