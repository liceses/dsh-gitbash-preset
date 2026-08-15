/**
 * dsh-gitbash-preset host plugin: installs the `minimal-gitbash` agent preset
 * into the user preset root when the web profile boots.
 *
 * The preset is the Windows variant of the shipped `minimal` preset: same
 * fixed persona and str_replace_editor surface, but the bash tool runs every
 * command through Git for Windows bash (MSYS) instead of the persistent PTY
 * shell, which `subprocess-local` cannot spawn on win32 at all.
 *
 * Installation is idempotent: when the preset already exists at the target,
 * the row only logs a note and returns — unless `force: true` is configured,
 * in which case the packaged preset files overwrite the installed ones (any
 * extra local files are kept).
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-gitbash-preset'

const PRESET_ID = 'minimal-gitbash'

/** The packaged preset files that define the preset. */
const PRESET_FILES = ['agent.cordis.yml', 'gitbash-executor.mjs', 'preset.yml']

/** Package-local preset source directory. */
const SOURCE_DIR = fileURLToPath(new URL('../agent-presets/minimal-gitbash/', import.meta.url))

/** The user preset root: ${DSH_HOME:-~/.dsh}/.agent-presets. */
function userPresetRoot() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, '.agent-presets')
}

/** Byte-compare two files; false when either is unreadable. */
function filesEqual(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

/** Install the packaged preset (idempotent unless force). */
export function apply(ctx, config = {}) {
  const force = config.force === true
  const targetDir = join(userPresetRoot(), PRESET_ID)
  const alreadyInstalled = PRESET_FILES.every((file) => existsSync(join(targetDir, file)))

  if (alreadyInstalled && !force) {
    const outOfDate = PRESET_FILES.some((file) => !filesEqual(join(SOURCE_DIR, file), join(targetDir, file)))
    console.log(
      `[${name}] preset "${PRESET_ID}" already installed at ${targetDir}`
      + (outOfDate
        ? '; packaged files differ — set force: true in the plugin config to overwrite'
        : ''),
    )
    return
  }

  mkdirSync(targetDir, { recursive: true })
  for (const file of PRESET_FILES) {
    cpSync(join(SOURCE_DIR, file), join(targetDir, file), { force: true })
  }
  const testSource = join(SOURCE_DIR, 'test')
  if (existsSync(testSource)) {
    cpSync(testSource, join(targetDir, 'test'), { recursive: true, force: true })
  }
  console.log(`[${name}] installed preset "${PRESET_ID}" -> ${targetDir}`)
}
