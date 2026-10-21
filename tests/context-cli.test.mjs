import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lines, makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-review/scripts/context.mjs', import.meta.url))
const run = ({ cwd, args = [] }) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })

describe('context.mjs', () => {
  let repo
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/order.ts': lines(5) })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/order.ts': lines(5).replace('line2\n', 'line2 changed\n') })
    repo.commit('feat: 바꿈')
  })
  after(() => repo.cleanup())

  it('요약을 출력하고 전체를 docs/gimi/reviews/에 JSON으로 쓴다', () => {
    const result = run({ cwd: repo.dir, args: ['--no-gh'] })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^범위 {4}main\.\.\.feat\/x/m)
    assert.match(result.stdout, /^건너뜀 {2}의도 — gh를 쓰지 않음/m)
    const dir = join(repo.dir, 'docs/gimi/reviews')
    const [file] = readdirSync(dir)
    assert.match(file, /^\d{4}-\d{2}-\d{2}-feat-x\.context\.json$/)
    assert.match(result.stdout, new RegExp(`^전체 {4}docs/gimi/reviews/${file.replaceAll('.', '\\.')}$`, 'm'))
    assert.equal(JSON.parse(readFileSync(join(dir, file), 'utf8')).version, 1)
  })

  it('맥락 묶음 파일이 .gitignore에 없으면 참고로 알린다', () => {
    const result = run({ cwd: repo.dir, args: ['--no-gh'] })
    assert.match(result.stdout, /^참고 {4}.*\.gitignore/m)
  })

  it('--json이면 JSON만 표준 출력으로 내고 파일을 쓰지 않는다', () => {
    rmSync(join(repo.dir, 'docs'), { recursive: true, force: true })
    const result = run({ cwd: repo.dir, args: ['--no-gh', '--json'] })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).scope.branch, 'feat/x')
    assert.equal(existsSync(join(repo.dir, 'docs')), false)
  })

  it('--base로 기준을 정하고, 없는 기준이면 종료 코드 2로 끝낸다', () => {
    assert.equal(run({ cwd: repo.dir, args: ['--no-gh', '--json', '--base', 'main'] }).status, 0)
    const missing = run({ cwd: repo.dir, args: ['--no-gh', '--base', 'nope'] })
    assert.equal(missing.status, 2)
    assert.match(missing.stderr, /nope/)
  })

  it('git 저장소가 아니면 종료 코드 2로 끝낸다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gimi-norepo-'))
    try {
      const result = run({ cwd: dir, args: ['--no-gh'] })
      assert.equal(result.status, 2)
      assert.match(result.stderr, /git 저장소/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('모르는 옵션이면 사용법을 보이고 종료 코드 2로 끝낸다', () => {
    const result = run({ cwd: repo.dir, args: ['--what'] })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /사용/)
  })
})
