/**
 * Content binding for host-delegated runs: hash the checked-out tracked
 * tree (path + raw bytes of every git-tracked file). A checkout at the same
 * commit but with dirty content hashes differently, so the delegated sweep
 * verdict can be bound to the exact swept bytes rather than a label.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function trackedTreeHash(cwd = process.cwd()) {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 })
  if (ls.status !== 0) throw new Error(`git ls-files failed: ${(ls.stderr || '').toString().trim()}`)
  const hash = createHash('sha256')
  let offset = 0
  const names = ls.stdout.toString().split('\0').filter(Boolean)
  for (const rel of names) {
    hash.update(rel)
    hash.update('\0')
    hash.update(readFileSync(join(cwd, rel)))
    offset++
  }
  return { hash: hash.digest('hex'), files: offset }
}