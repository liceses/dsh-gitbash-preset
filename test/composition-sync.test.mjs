/**
 * Keeps the two copies of the `minimal-gitbash` composition in sync.
 *
 * DSH 0.2.x needs the composition as a declaration row inside
 * `cordis.patch.yml`; DSH 0.1.x needs it as `agent-presets/<id>/agent.cordis.yml`
 * on disk. Both files are hand-maintained and must describe the same plugin
 * tree, so this test compares them structurally after normalising indentation,
 * comments, blank lines, and the one intended difference — how the executor is
 * imported (a package subpath export in the patch, a preset-local relative
 * import in the directory copy).
 *
 * No YAML dependency: the plugin is zero-dep by design, so the comparison works
 * on normalised lines and fails on any real drift.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = join(ROOT, 'cordis.patch.yml')
const COMPOSITION = join(ROOT, 'agent-presets', 'minimal-gitbash', 'agent.cordis.yml')

/** The one line the two copies are allowed to spell differently. */
const EXECUTOR_PLACEHOLDER = 'name: <EXECUTOR>'

function normalize(lines) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => (line === 'name: ./gitbash-executor.mjs' || line === "name: '@icelily/dsh-gitbash-preset/executor'"
      ? EXECUTOR_PLACEHOLDER
      : line))
}

/** Extract the `plugins:` block of the preset row from the bundle patch. */
function inlinePlugins(source) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => /^\s+plugins:\s*$/.test(line))
  assert.notEqual(start, -1, 'cordis.patch.yml must contain the preset row\'s plugins block')
  const indent = /^(\s*)/.exec(lines[start])[1].length
  const block = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      block.push(line)
      continue
    }
    const leading = /^(\s*)/.exec(line)[1].length
    if (leading <= indent) break
    block.push(line)
  }
  return block
}

test('cordis.patch.yml and agent.cordis.yml describe the same composition', () => {
  const patch = readFileSync(PATCH, 'utf8')
  const composition = readFileSync(COMPOSITION, 'utf8')

  const fromPatch = normalize(inlinePlugins(patch))
  const fromComposition = normalize(composition.split('\n'))

  assert.ok(fromPatch.length > 0, 'the patch composition must not be empty')
  assert.deepEqual(fromPatch, fromComposition)
})

test('the preset row registers the id the directory copy is installed under', () => {
  const patch = readFileSync(PATCH, 'utf8')
  assert.match(patch, /id: preset-minimal-gitbash/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-agent-preset'/)
  assert.match(patch, /^\s+id: minimal-gitbash$/m)
})

test('the directory copy stays importable as a preset-local module', () => {
  const composition = readFileSync(COMPOSITION, 'utf8')
  assert.match(composition, /name: \.\/gitbash-executor\.mjs/)
})
