/**
 * Does wrapping a method on a provided service instance stay visible through the
 * cordis service proxy? This is the one runtime assumption dsh-auto-preset-guard
 * makes: auto-review captures `const permissionPresets = ctx.permissionPresets`
 * once at apply time and calls `.set(...)` later, from its disposer.
 *
 * Cordis hands out a fresh proxy per access, so identity differs — what has to
 * hold is that an own property defined on one access is seen by every access,
 * and that a reference captured *before* the wrap dispatches to the wrapper.
 */
import { loadCordis } from './cordis.mjs'

const { Context, Service } = await loadCordis()

const calls = []
class FakeOwner extends Service {
  set(session, preset) {
    calls.push([session, preset])
    return 'original'
  }
  current() {
    return 'auto'
  }
}

const root = new Context()
const owner = new FakeOwner(root)
root.provide('permissionPresets', owner)

// What auto-review does at apply time, before this guard ever runs.
const captured = root.permissionPresets
const originalSet = captured.set

Object.defineProperty(captured, 'set', {
  configurable: true,
  writable: true,
  value: function set(session, preset) {
    if (preset === 'danger-full-access') return 'blocked'
    return originalSet.apply(this, arguments)
  },
})

const checks = []
const check = (label, ok) => {
  checks.push([label, ok])
  console.log((ok ? 'PASS ' : 'FAIL ') + label)
}

check(
  'a reference captured before the wrap reaches the wrapper',
  captured.set('s1', 'danger-full-access') === 'blocked',
)
check(
  'a fresh ctx access reaches the same wrapper',
  root.permissionPresets.set('s1', 'danger-full-access') === 'blocked',
)
check(
  'ordinary presets still reach the owner',
  captured.set('s1', 'workspace-write') === 'original',
)
check(
  'the owner saw exactly the one ordinary write',
  calls.length === 1 && calls[0][1] === 'workspace-write',
)

const failed = checks.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? 'PROXY CHECK PASS' : `PROXY CHECK FAIL (${failed.length})`)
process.exit(failed.length === 0 ? 0 : 1)
