/**
 * Unit tests for gitbash-executor.mjs pure functions.
 *
 * Run from the preset directory:
 *   node --test test/
 *
 * Only pure functions are tested here (no ctx, no real spawn); the real
 * spawn path is verified end-to-end in a live DSH session.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import {
  toWindowsPath,
  detectShellPath,
  resolveConfig,
} from '../gitbash-executor.mjs'

// ── toWindowsPath ──────────────────────────────────────────────────────────

test('toWindowsPath converts MSYS drive paths', () => {
  assert.equal(toWindowsPath('/d/foo'), 'D:\\foo')
  assert.equal(toWindowsPath('/d/foo/bar.txt'), 'D:\\foo\\bar.txt')
  assert.equal(toWindowsPath('/d'), 'D:\\')
  assert.equal(toWindowsPath('/d/'), 'D:\\')
  assert.equal(toWindowsPath('/D/Foo'), 'D:\\Foo')
  assert.equal(toWindowsPath('/c/Users/ROG'), 'C:\\Users\\ROG')
})

test('toWindowsPath leaves non-drive paths untouched', () => {
  // MSYS root paths must NOT be mangled into drive paths.
  assert.equal(toWindowsPath('/usr/bin'), '/usr/bin')
  assert.equal(toWindowsPath('/usr'), '/usr')
  assert.equal(toWindowsPath('/tmp/x'), '/tmp/x')
  // Windows-native and UNC paths pass through.
  assert.equal(toWindowsPath('D:\\foo'), 'D:\\foo')
  assert.equal(toWindowsPath('D:/foo'), 'D:/foo')
  assert.equal(toWindowsPath('\\\\server\\share\\x'), '\\\\server\\share\\x')
  // Relative and empty values.
  assert.equal(toWindowsPath('foo/bar'), 'foo/bar')
  assert.equal(toWindowsPath(''), '')
  assert.equal(toWindowsPath(undefined), undefined)
})

// ── detectShellPath ────────────────────────────────────────────────────────

/** This machine's known Git install, used as a fallback candidate. */
const KNOWN_GIT_BASH = 'D:\\applications\\Git\\bin\\bash.exe'
const hasKnownGitBash = existsSync(KNOWN_GIT_BASH)

test('detectShellPath: explicit config wins', () => {
  assert.equal(
    detectShellPath('C:\\Custom\\Git\\bin\\bash.exe', {}),
    'C:\\Custom\\Git\\bin\\bash.exe',
  )
})

test('detectShellPath: GIT_BASH env wins over install roots', () => {
  // process.execPath is a real, existing executable.
  const env = {
    GIT_BASH: process.execPath,
    ProgramFiles: 'C:\\Program Files',
  }
  assert.equal(detectShellPath(undefined, env), process.execPath)
})

test('detectShellPath: falls back through candidates and PATH', () => {
  // With no env hints the known-install fallback wins when present.
  assert.equal(detectShellPath(undefined, {}), hasKnownGitBash ? KNOWN_GIT_BASH : 'bash')
  // A PATH without bash.exe still falls back to the known install / bare name.
  assert.equal(
    detectShellPath(undefined, { PATH: 'C:\\Windows\\System32' }),
    hasKnownGitBash ? KNOWN_GIT_BASH : 'bash',
  )
})

test('detectShellPath: a PATH entry whose bash.exe exists is picked up', {
  skip: !hasKnownGitBash,
}, () => {
  const env = { PATH: 'Z:\\nope;D:\\applications\\Git\\bin' }
  assert.equal(detectShellPath(undefined, env), 'D:\\applications\\Git\\bin\\bash.exe')
})

// ── resolveConfig ──────────────────────────────────────────────────────────

test('resolveConfig: defaults resolve numeric config and a shell path', () => {
  const resolved = resolveConfig({}, {})
  // shellPath is whatever detection found on this machine (a string).
  assert.equal(typeof resolved.shellPath, 'string')
  assert.ok(resolved.shellPath.length > 0)
  assert.equal(resolved.timeoutMs, 120000)
  assert.equal(resolved.maxTimeoutMs, 600000)
  assert.equal(resolved.maxOutputBytes, 64000)
  assert.equal(resolved.graceMs, 3000)
})

test('resolveConfig: converts MSYS-style shellPath and cwd', () => {
  const resolved = resolveConfig(
    { shellPath: '/d/Git/bin/bash.exe', cwd: '/d/projects/x' },
    {},
  )
  assert.equal(resolved.shellPath, 'D:\\Git\\bin\\bash.exe')
  assert.equal(resolved.cwd, 'D:\\projects\\x')
})

test('resolveConfig: rejects timer values beyond the Node timer ceiling', () => {
  assert.throws(() => resolveConfig({ timeoutMs: 999999999999 }, {}), /no greater than/)
  assert.throws(() => resolveConfig({ maxTimeoutMs: 999999999999 }, {}), /no greater than/)
  assert.throws(() => resolveConfig({ graceMs: 999999999999 }, {}), /no greater than/)
})

test('resolveConfig: rejects non-positive numeric config', () => {
  assert.throws(() => resolveConfig({ timeoutMs: 0 }, {}), /positive/)
  assert.throws(() => resolveConfig({ maxOutputBytes: -1 }, {}), /positive/)
  assert.throws(() => resolveConfig({ maxSpillBytes: NaN }, {}), /positive/)
})
