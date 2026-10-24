/**
 * gitbash-executor: Git-for-Windows bash provider for the `minimal-gitbash`
 * agent preset.
 *
 * Why this file exists:
 *  - the shipped presets disable the bash tool on win32 (only pwsh survives
 *    there), and
 *  - the minimal preset's persistent bash needs a PTY, which
 *    `@deepseek-ai/dsh-subprocess-local` cannot start on Windows at all.
 *
 * This plugin therefore replaces `ctx.shell` inside an entry-local realm (see
 * the preset's `gitbash-shell` group) and runs every command as
 * `"<git bash>" -c <command>` through the host subprocess service: a fresh
 * shell per call, with the same `bash` tool name and `str_replace_editor`
 * surface as the original preset. Only Node built-in modules are imported:
 * preset-local files resolve against the preset directory, so DSH package
 * imports would fail, while `node:fs` is always available.
 *
 * Contract (see `@deepseek-ai/dsh-shell`'s ShellExecutor, DSH 0.2.1-rc.2):
 *  - `resolve(request) -> spec` fills `workdir`, `timeoutMs`, `onExpiry` and
 *    `sandboxPolicy`;
 *  - `execute(spec) -> handle` publishes a process handle whose `result()`
 *    resolves with the run outcome, and whose `observed.stdout/stderr` readers
 *    back the job registry's pull surface;
 *  - `sandboxMode` advertises the mode this executor claims to apply.
 * DSH 0.2.0 and earlier shipped a `run()` / `start()` seam instead, which is
 * what 0.1.2 and earlier implemented (see CHANGELOG).
 *
 * Sandbox: the MSYS runtime cannot initialize inside the Windows restricted
 * token sandbox (it cannot create its signal pipes), so the DSH ACL runner
 * cannot wrap a Git Bash argv — wrapping it aborts every command. The executor
 * therefore runs Git Bash unconfined and says so: every result carries
 * `sandbox: { mode, denied: false, enforcement: 'gitbash-unconfined' }`, which
 * `@deepseek-ai/dsh-tool-bash` forwards to the model-facing result. Set
 * `requireFullAccess: true` to restore the old fail-closed policy instead
 * (refuse every command unless the session is danger-full-access).
 */

import { existsSync } from 'node:fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'gitbash-executor'

/** Required host services; ordering matters because apply() reads them eagerly. */
export const inject = ['subprocess', 'sandboxPolicy']

/** Node's maximum timer delay before setTimeout clamps to 1ms. */
const MAX_TIMER_DELAY_MS = 2147483647

/** Enforcement tag reported for Git Bash runs: the command runs unconfined. */
const UNCONFINED = 'gitbash-unconfined'

const ENV_OVERRIDES = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
}

/**
 * Convert a Git Bash / MSYS drive path such as `/d/foo` into the Windows path
 * `D:\foo` that Node's child_process can use as cwd or executable path.
 * Only the single-letter drive form is converted: `/d`, `/d/`, `/d/foo`
 * (the letter must be immediately followed by `/` or end the string), so
 * MSYS root paths like `/usr/bin` are left untouched instead of being
 * mangled into `U:\sr\bin`. Everything else (UNC, `D:\`, `D:/`) passes
 * through unchanged.
 */
export function toWindowsPath(value) {
  if (process.platform !== 'win32' || typeof value !== 'string' || value.length === 0) {
    return value
  }
  const match = /^\/\s*([A-Za-z])(?:$|\/(.*))$/.exec(value)
  if (match === null) return value
  const drive = `${match[1].toUpperCase()}:`
  const rest = match[2] ?? ''
  if (rest === '') return `${drive}\\`
  return `${drive}\\${rest.replace(/\//g, '\\')}`
}

/**
 * True for the directories that hold the Microsoft bash.exe stubs (the WSL
 * launcher): `<SystemRoot>\System32` and the WoW64 mirrors. The stub merely
 * bridges to `wsl.exe` — using it as the shell fails with "no installed
 * distribution" when WSL has no distro (see liceses/dsh-gitbash-preset#1).
 */
export function isWslBashDirectory(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return false
  return /(?:\\|\/)(?:system32|sysnative|syswow64)$/i.test(dir)
}

/**
 * Candidates for the Git-for-Windows bash executable, in preference order:
 * the GIT_BASH environment variable, the standard install roots, this
 * machine's known install location, then every real `bash.exe` found on PATH
 * (WSL launcher directories under System32 are skipped).
 */
function shellPathCandidates(env) {
  const candidates = [
    env.GIT_BASH,
    env.ProgramFiles === undefined ? undefined : `${env.ProgramFiles}\\Git\\bin\\bash.exe`,
    env['ProgramFiles(x86)'] === undefined ? undefined : `${env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`,
    env.LOCALAPPDATA === undefined ? undefined : `${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    'D:\\applications\\Git\\bin\\bash.exe',
  ]
  if (typeof env.PATH === 'string' && env.PATH.length > 0) {
    for (const dir of env.PATH.split(';')) {
      if (dir.length === 0) continue
      if (isWslBashDirectory(dir)) continue
      candidates.push(`${dir}\\bash.exe`)
    }
  }
  return candidates
}

/**
 * Resolve the shell executable to spawn. An explicit configuration wins; a
 * POSIX host always gets `bash`. On Windows the first existing candidate is
 * used (GIT_BASH → install roots → PATH), falling back to the bare `bash`
 * name when nothing exists so spawn reports a resolution error.
 */
export function detectShellPath(explicit, env = process.env) {
  if (process.platform !== 'win32') {
    return typeof explicit === 'string' && explicit.length > 0 ? explicit : 'bash'
  }
  if (typeof explicit === 'string' && explicit.length > 0) return toWindowsPath(explicit)
  for (const candidate of shellPathCandidates(env)) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    if (existsSync(candidate)) return toWindowsPath(candidate)
  }
  return 'bash'
}

function positiveNumber(config, label, fallback) {
  const value = config[label] ?? fallback
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name}: ${label} must be a positive finite number`)
  }
  return value
}

export function resolveConfig(config, env = process.env) {
  const source = config ?? {}
  const timeoutMs = positiveNumber(source, 'timeoutMs', 120000)
  const maxTimeoutMs = positiveNumber(source, 'maxTimeoutMs', 600000)
  const graceMs = positiveNumber(source, 'graceMs', 3000)
  if (timeoutMs > MAX_TIMER_DELAY_MS || maxTimeoutMs > MAX_TIMER_DELAY_MS || graceMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`${name}: timeoutMs, maxTimeoutMs and graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    shellPath: detectShellPath(source.shellPath, env),
    cwd: typeof source.cwd === 'string' && source.cwd.length > 0
      ? toWindowsPath(source.cwd)
      : undefined,
    timeoutMs,
    maxTimeoutMs,
    maxOutputBytes: positiveNumber(source, 'maxOutputBytes', 64000),
    maxSpillBytes: positiveNumber(source, 'maxSpillBytes', 64 * 1024 * 1024),
    graceMs,
    // Off by default: MSYS cannot be confined, so refusing every non-full-access
    // command only makes the preset unusable in default sessions. Opt in when a
    // deployment wants the old fail-closed behaviour.
    requireFullAccess: source.requireFullAccess === true,
  }
}

/** Identifiable timeout reason, so a fused signal can be classified. */
class TimeoutReason extends Error {
  code
  timeoutMs

  constructor(code, timeoutMs) {
    super(`timeout after ${timeoutMs}ms (${code})`)
    this.name = 'TimeoutReason'
    this.code = code
    this.timeoutMs = timeoutMs
  }
}

/** Validate the caller's optional timeout hint, apply the default, cap it. */
function clampTimeout(requested, fallback, max, label) {
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${label} must be a positive finite number`)
  }
  return Math.min(requested ?? fallback, max)
}

/** Fuse upstream cancellation with an identifiable timeout. */
function deadline(upstream, timeoutMs, code) {
  if (timeoutMs <= 0) {
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {} }
  }
  const timer = new AbortController()
  const id = setTimeout(() => {
    timer.abort(new TimeoutReason(code, timeoutMs))
  }, timeoutMs)
  return {
    signal: upstream === undefined ? timer.signal : AbortSignal.any([upstream, timer.signal]),
    [Symbol.dispose]() {
      clearTimeout(id)
    },
  }
}

/** The timeout reason carried by a fused signal, when it is this capability's. */
function timeoutOf(signal, code) {
  const reason = signal?.reason
  if (!(reason instanceof TimeoutReason)) return undefined
  return code === undefined || reason.code === code ? reason : undefined
}

/** Project a settled collect-mode reader into the final result shape. */
function finalOutput(reader) {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath === undefined ? {} : { spillPath: read.spillPath },
  }
}

/** A reader that yields nothing; stands in for a spawn that never happened. */
const emptyReader = { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) }

/** The refusal used only when `requireFullAccess` is on. */
function gateMessage(mode) {
  return `${name}: the Git-for-Windows bash runtime cannot start inside the "${mode ?? 'unknown'}" sandbox `
    + '(the MSYS runtime cannot create its signal pipes under the restricted token). '
    + 'Retry this exact command once with sandbox_permissions: "danger-full-access" plus a justification, '
    + 'or ask the user to switch the session sandbox mode to full access (or set requireFullAccess: false).'
}

/**
 * The `ctx.shell` implementation. Mirrors the seam semantics of the shipped
 * `@deepseek-ai/dsh-bash-local`: `execute` publishes the handle after
 * preparation, non-zero exits resolve instead of rejecting, and `onExpiry`
 * decides whether the executor arms the deadline or the caller does.
 */
class GitBashExecutor {
  constructor(deps) {
    this.subprocess = deps.subprocess
    this.sandboxPolicy = deps.sandboxPolicy
    this.cfg = deps.resolved
  }

  /** The sandbox mode this executor claims; `undefined` when it never confines. */
  get sandboxMode() {
    return this.sandboxPolicy === undefined ? undefined : this.sandboxPolicy.defaultMode
  }

  /** Resolve a request into a fully-specified spec. */
  resolve(request) {
    const cfg = this.cfg
    const timeoutMs = clampTimeout(request.timeoutMs, cfg.timeoutMs, cfg.maxTimeoutMs, `${name}: request.timeoutMs`)
    const stdoutMaxBytes = request.stdoutMaxBytes ?? cfg.maxOutputBytes
    if (!Number.isFinite(stdoutMaxBytes) || stdoutMaxBytes <= 0) {
      throw new Error(`${name}: request.stdoutMaxBytes must be a positive finite number`)
    }
    return {
      command: request.command,
      workdir: toWindowsPath(request.workdir ?? cfg.cwd ?? process.cwd()),
      timeoutMs,
      onExpiry: request.onExpiry ?? 'kill',
      stdoutMaxBytes,
      ...request.signal === undefined ? {} : { signal: request.signal },
      ...request.stdin === undefined ? {} : { stdin: request.stdin },
      ...request.env === undefined ? {} : { env: request.env },
      ...request.dshEnv === undefined ? {} : { dshEnv: request.dshEnv },
      sandboxPolicy: request.sandboxPolicy
        ?? (this.sandboxPolicy?.resolve === undefined ? undefined : this.sandboxPolicy.resolve()),
    }
  }

  /** Map one resolved spec and argv onto a subprocess spawn. */
  spawnSpec(spec, argv, stdoutMaxBytes, signal) {
    const cfg = this.cfg
    const collect = (maxBytes) => ({ maxBytes, spill: { maxBytes: cfg.maxSpillBytes } })
    return {
      argv,
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin === undefined ? 'ignore' : { data: spec.stdin },
        stdout: collect(stdoutMaxBytes),
        stderr: collect(cfg.maxOutputBytes),
      },
      graceMs: cfg.graceMs,
      signal,
      env: {
        ...ENV_OVERRIDES,
        ...spec.env,
        ...spec.dshEnv,
      },
    }
  }

  /**
   * Run one command. Refuses only when `requireFullAccess` is configured and
   * the session is confined; otherwise runs unconfined and reports that fact.
   */
  async execute(spec) {
    const mode = spec.sandboxPolicy?.mode
    if (this.cfg.requireFullAccess && mode !== undefined && mode !== 'danger-full-access') {
      throw new Error(gateMessage(mode))
    }

    let spawnSignal
    let classify
    let disarm
    if (spec.onExpiry === 'kill') {
      const d = deadline(spec.signal, spec.timeoutMs, 'BASH_TIMEOUT')
      spawnSignal = d.signal
      classify = () => {
        const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined
        return { timedOut, aborted: d.signal.aborted && !timedOut }
      }
      disarm = () => d[Symbol.dispose]()
    } else {
      spawnSignal = spec.signal
      classify = () => ({ timedOut: false, aborted: spec.signal?.aborted === true })
    }

    let running
    let syncError
    try {
      running = this.subprocess.spawn(this.spawnSpec(
        spec,
        [this.cfg.shellPath, '-c', spec.command],
        spec.stdoutMaxBytes,
        spawnSignal,
      ))
    } catch (error) {
      syncError = error
    }

    const collected = running === undefined ? { stdout: emptyReader, stderr: emptyReader } : running.collected
    if (collected.stdout === undefined || collected.stderr === undefined) {
      throw new Error(`${name}: subprocess implementation dropped a requested collect stream`)
    }

    let providerFailure
    /** Non-consuming stderr reader; a rejected spawn surfaces the provider note here. */
    const observedStderr = {
      readFrom: (fromByte) => {
        if (providerFailure === undefined) return collected.stderr.readFrom(fromByte)
        const note = Buffer.from(providerFailure.note, 'utf8')
        return {
          text: note.subarray(Math.min(fromByte, note.length)).toString('utf8'),
          nextOffset: note.length,
          lossy: false,
        }
      },
    }

    let stdoutOffset = 0
    let stderrOffset = 0
    let resultPromise

    const proc = {
      status: 'running',
      exitCode: null,
      signal: null,
      observed: { stdout: collected.stdout, stderr: observedStderr },
      done: undefined,
      /** Incremental read: consecutive reads never repeat, stdout first. */
      readOutput: () => {
        const out = collected.stdout.readFrom(stdoutOffset)
        const err = collected.stderr.readFrom(stderrOffset)
        stdoutOffset = out.nextOffset
        stderrOffset = err.nextOffset
        const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
        return {
          delta: out.text + (err.text.length > 0 ? `${separator}[stderr]\n${err.text}` : ''),
          lossy: out.lossy || err.lossy,
          ...out.spillPath === undefined ? {} : { stdoutSpillPath: out.spillPath },
          ...err.spillPath === undefined ? {} : { stderrSpillPath: err.spillPath },
        }
      },
      kill: () => {
        if (proc.status !== 'running') return false
        proc.status = 'killed'
        running?.terminate()
        return true
      },
      result: () => {
        resultPromise ??= proc.done.then(() => {
          if (providerFailure !== undefined) throw providerFailure.error
          return {
            exitCode: proc.exitCode,
            signal: proc.signal,
            ...classify(),
            timeoutMs: spec.timeoutMs,
            stdout: finalOutput(collected.stdout),
            stderr: finalOutput(collected.stderr),
            ...mode === undefined ? {} : {
              sandbox: { mode, denied: false, enforcement: UNCONFINED },
            },
          }
        })
        return resultPromise
      },
    }

    const settle = running === undefined ? Promise.reject(syncError) : running.done
    proc.done = settle.then(
      (outcome) => {
        if (proc.status === 'running') {
          proc.status = spawnSignal?.aborted === true || outcome.signal !== null ? 'killed' : 'completed'
        }
        proc.exitCode = outcome.exitCode
        proc.signal = outcome.signal
        disarm?.()
      },
      (error) => {
        if (running !== undefined && (proc.status === 'killed' || spawnSignal?.aborted === true)) {
          proc.status = 'killed'
          disarm?.()
          return
        }
        proc.status = 'killed'
        let detail = 'unprintable provider failure'
        try {
          detail = String(error)
        } catch {}
        providerFailure = { error, note: `subprocess failed before reporting an outcome: ${detail}` }
        disarm?.()
      },
    )

    return proc
  }
}

/** Register the git-bash executor as the entry-local `shell` provider. */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new Error(`${name}: ctx.subprocess is unavailable`)
  }
  const sandboxPolicy = ctx.get('sandboxPolicy')
  ctx.provide('shell', new GitBashExecutor({ subprocess, sandboxPolicy, resolved }))
}
