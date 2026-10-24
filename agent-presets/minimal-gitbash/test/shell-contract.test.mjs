/**
 * Contract tests for the `ctx.shell` seam this executor provides.
 *
 * These do NOT spawn bash: a fake subprocess records the spawn spec and settles
 * immediately, so the suite runs on every platform. The real spawn path is
 * exercised end-to-end in a live DSH session (see README).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, resolveConfig } from '../gitbash-executor.mjs'

/** A subprocess double that records spawns and settles at once. */
function fakeSubprocess({ stdoutText = 'ok', exitCode = 0 } = {}) {
  const spawns = []
  return {
    spawns,
    spawn(spec) {
      spawns.push(spec)
      const reader = {
        readFrom: (fromByte) => ({
          text: stdoutText.slice(fromByte),
          lossy: false,
          nextOffset: stdoutText.length,
        }),
      }
      const done = new Promise((resolve) => {
        setImmediate(() => resolve({ exitCode, signal: null }))
      })
      return { collected: { stdout: reader, stderr: reader }, done, terminate() {} }
    },
  }
}

/** Mount the executor the way the preset does, over fake services. */
function mount({ mode = 'workspace-write', config = {}, subprocess = fakeSubprocess() } = {}) {
  const services = {
    subprocess,
    sandboxPolicy: { defaultMode: mode, resolve: () => ({ mode }) },
  }
  const ctx = {
    get: (name) => services[name],
    provide: (name, value) => {
      services[name] = value
    },
  }
  apply(ctx, config)
  return { shell: services.shell, subprocess }
}

test('apply() provides ctx.shell and exposes the claimed sandbox mode', () => {
  const { shell } = mount({ mode: 'workspace-write' })
  assert.ok(shell, 'ctx.shell must be provided')
  assert.equal(shell.sandboxMode, 'workspace-write')
  assert.equal(typeof shell.resolve, 'function')
  assert.equal(typeof shell.execute, 'function')
})

test('resolve() fills workdir, timeout and onExpiry', () => {
  const { shell } = mount()
  const spec = shell.resolve({ command: 'echo hi' })
  assert.equal(spec.command, 'echo hi')
  assert.equal(spec.timeoutMs, 120000)
  assert.equal(spec.onExpiry, 'kill')
  assert.ok(typeof spec.workdir === 'string' && spec.workdir.length > 0)
  assert.equal(spec.sandboxPolicy.mode, 'workspace-write')
})

test('resolve() honours a caller timeout hint and caps it at maxTimeoutMs', () => {
  const { shell } = mount({ config: { timeoutMs: 1000, maxTimeoutMs: 5000 } })
  assert.equal(shell.resolve({ command: 'x', timeoutMs: 3000 }).timeoutMs, 3000)
  assert.equal(shell.resolve({ command: 'x', timeoutMs: 999999 }).timeoutMs, 5000)
  assert.throws(() => shell.resolve({ command: 'x', timeoutMs: 0 }), /positive finite number/)
})

test('execute() runs Git Bash unconfined and reports the enforcement tag', async () => {
  const subprocess = fakeSubprocess({ stdoutText: 'gitbash-ok' })
  const { shell } = mount({ mode: 'workspace-write', subprocess })

  const proc = await shell.execute(shell.resolve({ command: 'echo gitbash-ok' }))
  assert.equal(typeof proc.result, 'function', 'handle must expose result()')
  assert.ok(proc.observed?.stdout?.readFrom, 'handle must expose observed readers')

  const result = await proc.result()
  assert.equal(result.exitCode, 0)
  assert.equal(result.timedOut, false)
  assert.equal(result.aborted, false)
  assert.equal(result.stdout.text, 'gitbash-ok')
  assert.deepEqual(result.sandbox, {
    mode: 'workspace-write',
    denied: false,
    enforcement: 'gitbash-unconfined',
  })
})

test('execute() spawns `<shell> -c <command>` in the resolved workdir', async () => {
  const subprocess = fakeSubprocess()
  const { shell } = mount({ subprocess })
  const spec = shell.resolve({ command: 'echo hi', workdir: 'D:/tmp' })
  await shell.execute(spec).then((proc) => proc.result())

  const spawn = subprocess.spawns[0]
  assert.equal(spawn.argv[0], resolveConfig({}).shellPath)
  assert.equal(spawn.argv[1], '-c')
  assert.equal(spawn.argv[2], 'echo hi')
  // Windows-style workdirs pass through unchanged (only the /d MSYS form is converted).
  assert.equal(spawn.cwd, 'D:/tmp')
  assert.equal(spawn.env.TERM, 'dumb')
})

test('non-zero exits resolve instead of rejecting', async () => {
  const { shell } = mount({ subprocess: fakeSubprocess({ exitCode: 3 }) })
  const result = await (await shell.execute(shell.resolve({ command: 'exit 3' }))).result()
  assert.equal(result.exitCode, 3)
  assert.equal(result.timedOut, false)
})

test('onExpiry "none" arms no deadline', async () => {
  const subprocess = fakeSubprocess()
  const { shell } = mount({ subprocess })
  await shell.execute(shell.resolve({ command: 'x', onExpiry: 'none' })).then((proc) => proc.result())
  assert.equal(subprocess.spawns[0].signal, undefined)
})

test('onExpiry "kill" arms a fused deadline signal', async () => {
  const subprocess = fakeSubprocess()
  const { shell } = mount({ subprocess })
  await shell.execute(shell.resolve({ command: 'x' })).then((proc) => proc.result())
  assert.ok(subprocess.spawns[0].signal instanceof AbortSignal)
})

test('requireFullAccess: true restores the fail-closed refusal', async () => {
  const { shell } = mount({ mode: 'workspace-write', config: { requireFullAccess: true } })
  await assert.rejects(
    () => shell.execute(shell.resolve({ command: 'echo nope' })),
    /cannot start inside the "workspace-write" sandbox/,
  )
})

test('requireFullAccess: true still allows danger-full-access', async () => {
  const { shell } = mount({ mode: 'danger-full-access', config: { requireFullAccess: true } })
  const result = await (await shell.execute(shell.resolve({ command: 'echo ok' }))).result()
  assert.equal(result.exitCode, 0)
  assert.equal(result.sandbox.mode, 'danger-full-access')
  assert.equal(result.sandbox.enforcement, 'gitbash-unconfined')
})

test('a missing subprocess service fails loudly at mount time', () => {
  const ctx = {
    get: () => undefined,
    provide: () => {},
  }
  assert.throws(() => apply(ctx, {}), /ctx\.subprocess is unavailable/)
})

test('resolveConfig() defaults requireFullAccess to false', () => {
  assert.equal(resolveConfig({}).requireFullAccess, false)
  assert.equal(resolveConfig({ requireFullAccess: true }).requireFullAccess, true)
  assert.equal(resolveConfig({ requireFullAccess: 'yes' }).requireFullAccess, false)
})
