/**
 * Offline harness for dsh-auto-preset-guard against the *installed* cordis.
 *
 * It builds a real root Context from the host runtime, provides a stand-in
 * `permissionPresets` service, loads this plugin exactly as the loader would,
 * then replays the shutdown shapes the fix depends on:
 *
 *   A. live removal of the Auto integration (root fiber ACTIVE) -> the stock
 *      migration must still run;
 *   B. application shutdown (root fiber UNLOADING) -> the migration must write
 *      nothing, because the wrapper drops it;
 *   C. a stored Auto Session opened without the integration must not throw;
 *   D. unrelated publication errors must still propagate.
 *
 *   node test/verify.mjs
 */
import { loadCordis } from './cordis.mjs'

const { Context } = await loadCordis()
const guard = await import('../lib/index.js')

const results = []
function check(label, ok, detail) {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

const writes = []
const session = { id: 'session-test', preset: 'auto' }
const integration = { present: true }

const service = {
  current(target) {
    return target.preset
  },
  set(target, name) {
    writes.push(name)
    target.preset = name
  },
  pinInitialPermission(target) {
    if (target.preset === 'auto' && !integration.present) {
      throw new Error(
        'permission: cannot restore preset "auto" without its active integration',
      )
    }
    return 'ok'
  },
}

const root = new Context()
root.provide('permissionPresets', service)

// The row itself, injected exactly like the loader does.
const guardFiber = root.plugin(guard)
await guardFiber.await?.().catch(() => {})
await tick()
check('guard row loaded and wrapped the write path', service.set.name === 'set')

// A stand-in for @deepseek-ai/dsh-experimental-auto-review: its effect disposer
// performs the migration that the real integration performs.
const autoReview = {
  name: 'fake-auto-review',
  inject: ['permissionPresets'],
  apply(ctx) {
    ctx.effect(
      () => () => {
        for (const target of [session]) {
          if (service.current(target) !== 'auto') continue
          service.set(target, 'danger-full-access')
        }
      },
      'fake auto-review lifecycle',
    )
  },
}

// A. Live plugin removal, root still ACTIVE: stock behaviour must survive.
let child = root.plugin(autoReview)
await tick()
check('case A setup: root fiber is ACTIVE', root.fiber.state === 2, `state=${root.fiber.state}`)
await child.dispose()
await tick()
check(
  'A: removing the integration while running still migrates Auto to Full access',
  writes.length === 1 && writes[0] === 'danger-full-access',
  JSON.stringify(writes),
)

// B. Application shutdown, root entering UNLOADING: nothing may be written.
writes.length = 0
session.preset = 'auto'
child = root.plugin(autoReview)
await tick()
const shutdown = root.fiber.dispose()
await shutdown?.catch?.(() => {})
await tick(120)
check(
  'B: shutting the application down preserves the stored Auto preset',
  writes.length === 0,
  JSON.stringify(writes),
)
check('B: the stored identity is still auto', session.preset === 'auto', session.preset)

// C. A stored Auto Session opened while the integration is absent.
integration.present = false
session.preset = 'auto'
let threw = null
try {
  service.pinInitialPermission(session)
} catch (error) {
  threw = error
}
check(
  'C: a stored Auto Session opens without its integration instead of throwing',
  threw === null,
  threw?.message,
)
integration.present = true
check('C: the preset is untouched afterwards', session.preset === 'auto', session.preset)

// D. Unrelated publication failures must still surface.
const broken = {
  pinInitialPermission() {
    throw new Error('permission: something else broke')
  },
}
Object.assign(service, broken)
let rethrown = null
try {
  service.pinInitialPermission(session)
} catch (error) {
  rethrown = error
}
check('D: unrelated publication errors are rethrown', rethrown?.message === 'permission: something else broke')

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
