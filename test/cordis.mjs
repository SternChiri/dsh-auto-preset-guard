/**
 * Resolve the cordis runtime the plugin will actually run inside.
 *
 * Default: the bare specifier `@deepseek-ai/cordis`, which resolves to the
 * host's copy when this package lives in a profile's node_modules.
 * Override with DSH_CORDIS, which accepts a bare specifier, a file URL, or a
 * filesystem path (including a path inside an Electron asar archive).
 */
import { pathToFileURL } from 'node:url'

const LOOKS_LIKE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])/

export function cordisSpecifier() {
  return process.env.DSH_CORDIS ?? '@deepseek-ai/cordis'
}

export function resolveSpecifier(specifier) {
  if (specifier.startsWith('file:')) return specifier
  // The ESM loader refuses a bare drive letter, so paths go through pathToFileURL.
  if (LOOKS_LIKE_PATH.test(specifier)) return pathToFileURL(specifier).href
  return specifier
}

export async function loadCordis() {
  const specifier = cordisSpecifier()
  try {
    return await import(resolveSpecifier(specifier))
  } catch (error) {
    throw new Error(
      `cannot load cordis from ${JSON.stringify(specifier)}: ${error?.message ?? error}\n` +
        'Set DSH_CORDIS to the cordis entry file of the DSH installation running this plugin.',
      { cause: error },
    )
  }
}
