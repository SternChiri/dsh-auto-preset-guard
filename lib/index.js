/**
 * Keep the Auto permission preset alive across application restarts.
 *
 * Two upstream behaviours in @deepseek-ai/dsh-permission-presets and
 * @deepseek-ai/dsh-experimental-auto-review break a stored `auto` identity on
 * every DSH quit:
 *
 * 1. The auto-review integration migrates every live Auto Session to
 *    `danger-full-access` from its effect disposer. Cordis runs child disposers
 *    both for "the plugin was removed while the app keeps running" and for "the
 *    application is shutting down"; only the first is meant to migrate. So every
 *    quit appends `permission/preset: danger-full-access` plus
 *    `approval/policy: never` to the Session log, and the next launch reopens the
 *    Session one privilege tier higher with approval switched off.
 * 2. Restoring a stored `auto` identity while the Auto integration is absent
 *    throws from `pinInitialPermission`, so such a Session cannot be opened at
 *    all (upstream reports this as "cannot restore preset auto without its
 *    active integration").
 *
 * The host cordis already distinguishes the two shutdown cases: a root context
 * entering unload sets its fiber state to `UNLOADING` *before* any child
 * disposer runs (`Fiber._unload` defers every disposer through
 * `await Promise.resolve()`, while `_updateState` has already published state 5).
 * That is the same signal upstream's own fix uses (`ctx.root.fiber.state ===
 * FiberState.ACTIVE` guards its migration). This plugin reaches the same
 * behaviour without patching the installation, by wrapping the one service
 * method the migration calls.
 *
 * Nothing here is unwrapped on dispose, deliberately: this row is typically the
 * last profile bundle, so it is disposed *before* the auto-review integration
 * that would then migrate. Restoring the original methods in our own disposer
 * would hand the bug straight back during exactly the shutdown we are guarding.
 *
 * @module dsh-auto-preset-guard
 */

/** Name of the Auto preset this module protects, matching the permission owner. */
const AUTO_PRESET = 'auto'

/** The preset the unload migration rewrites Auto Sessions to. */
const FULL_ACCESS_PRESET = 'danger-full-access'

/** `FiberState.ACTIVE` in @deepseek-ai/cordis. */
const FIBER_ACTIVE = 2

/** Idempotence marker: a reloaded row must not stack a second wrapper. */
const GUARDED = Symbol.for('dsh-auto-preset-guard/guarded')

const debugEnabled = process.env.DSH_AUTO_PRESET_GUARD_DEBUG === '1'

/**
 * Report one guarded decision when the operator asked for it. Never throws: a
 * logging failure must not break the permission write path it is describing.
 */
function debug(message, detail) {
  if (!debugEnabled) return
  try {
    console.log(`[dsh-auto-preset-guard] ${message}`, detail ?? '')
  } catch {}
}

/**
 * Whether the deepest context owner is going down rather than reloading one
 * plugin. A missing or foreign `fiber` is read as "still running" so an unknown
 * host keeps the stock behaviour instead of silently disabling the migration
 * for live plugin removal.
 */
function rootIsUnloading(root) {
  try {
    const state = root?.fiber?.state
    return typeof state === 'number' && state !== FIBER_ACTIVE
  } catch {
    return false
  }
}

/**
 * Whether an error is the permission owner refusing to publish a stored Auto
 * Session because the Auto integration is not installed.
 */
function isMissingAutoIntegration(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  return /cannot restore preset ["']?auto["']?/i.test(message)
}

export const name = 'dsh-auto-preset-guard'

export const inject = ['permissionPresets']

/**
 * Wrap the permission owner's write path for the lifetime of the process.
 *
 * @param ctx — this row's context; `permissionPresets` is injected and therefore
 *   guaranteed present by the time `apply` runs.
 */
export function apply(ctx) {
  const service = ctx.permissionPresets
  if (!service || service[GUARDED]) return
  const root = ctx.root

  const originalSet = service.set
  if (typeof originalSet !== 'function') {
    debug('permissionPresets.set is missing; nothing wrapped')
    return
  }

  Object.defineProperty(service, 'set', {
    configurable: true,
    writable: true,
    value: function set(session, preset) {
      try {
        // The unload migration is exactly "current preset is auto, target preset
        // is Full access". A real user switch happens while the root fiber is
        // ACTIVE, so it still writes normally, including one made through the
        // composer picker during the same session.
        if (preset === FULL_ACCESS_PRESET && rootIsUnloading(root)) {
          const current = service.current(session)
          if (current === AUTO_PRESET) {
            debug('kept Auto through shutdown', { session: describe(session) })
            return undefined
          }
        }
      } catch (error) {
        // A failed predicate must fall through to the ordinary write, never
        // swallow a real preset change.
        debug('guard predicate failed; writing normally', error)
      }
      return originalSet.apply(this, arguments)
    },
  })

  const originalPin = service.pinInitialPermission
  if (typeof originalPin === 'function') {
    Object.defineProperty(service, 'pinInitialPermission', {
      configurable: true,
      writable: true,
      value: function pinInitialPermission(session) {
        try {
          return originalPin.call(this, session)
        } catch (error) {
          if (!isMissingAutoIntegration(error)) throw error
          // The stored Auto identity stays in the log untouched. The Session
          // opens with the sandbox and approval facts it already carries instead
          // of failing publication, so reinstalling the integration restores the
          // option without a written downgrade.
          debug('opened stored Auto Session without its integration', {
            session: describe(session),
          })
          return undefined
        }
      },
    })
  }

  Object.defineProperty(service, GUARDED, {
    configurable: true,
    writable: false,
    value: true,
  })

  debug('installed')
}

/** Best-effort session label for the debug log. */
function describe(session) {
  try {
    return session?.id ?? session?.header?.id ?? '(unknown)'
  } catch {
    return '(unknown)'
  }
}
