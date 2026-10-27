import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo } from './helpers/repo.mjs'

const CLI = new URL('../scripts/defects.mjs', import.meta.url).pathname
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

// 예제 저장소를 흉내 낸 작은 저장소 — 워크스페이스 app 하나, 결함 PR 둘(하나는 패치가 붙지 않는다)
let repo
let out
before(() => {
  repo = makeRepo()
  out = mkdtempSync(join(tmpdir(), 'gimi-defects-out-'))
  repo.write({
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['app'] }),
    '.gitignore': 'node_modules/\n',
    'app/src/stock.ts': ['export const take = async (db, id, n) => {', "  await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [id, n])", '}', ''].join('\n'),
    'app/test/stock.test.ts': "import { it } from 'vitest'\nit('x', () => {})\n",
  })
  repo.commit('정상 버전')
  repo.write({ 'app/src/stock.ts': ['export const take = async (db, id, n) => {', "  const { rows } = await db.query('SELECT stock FROM products WHERE id = $1', [id])", "  if (rows[0].stock >= n) await db.query('UPDATE products SET stock = $2 WHERE id = $1', [id, rows[0].stock - n])", '}', ''].join('\n') })
  const patch = repo.git('diff')
  repo.git('checkout', '--', 'app/src/stock.ts')
  const defect = (id, extra = {}) => ({
    id,
    rules: [id],
    context: '도메인 규칙',
    layer: '백엔드',
    pr: { title: 'feat: 재고 부족을 알린다', body: '요구사항 — 남은 수량을 알린다' },
    findings: [{ level: '고쳐야 함', summary: '재고를 읽고 앱에서 비교해 저장한다', path: 'app/src/stock.ts', line: 3 }],
    catches: ['app/test/stock.test.ts'],
    ...extra,
  })
  repo.write({
    'defects/README.md': '결함 PR 형식\n',
    'defects/COM-007/change.patch': patch,
    'defects/COM-007/defect.json': JSON.stringify(defect('COM-007'), null, 2),
    'defects/COM-016/change.patch': patch.replace('AND stock >= $2', 'AND stock > $2'),
    'defects/COM-016/defect.json': JSON.stringify(defect('COM-016'), null, 2),
  })
  repo.commit('결함 PR')
})
after(() => {
  repo.cleanup()
  rmSync(out, { recursive: true, force: true })
})

describe('defects.mjs check', () => {
  it('패치가 붙고 정답 위치가 결함 버전에 있으면 통과한다 — 고른 결함만 본다', () => {
    const result = run(['check', 'COM-007', '--fixture', repo.dir, '--no-tests'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.stdout.split('\n')[0], '결함 PR 1개 — 문제 없음')
    assert.match(result.stdout, /COM-007 {2}백엔드 · 도메인 규칙 · 정답 1/)
  })

  it('패치가 정상 버전에 붙지 않으면 실패한다(exit 1)', () => {
    const result = run(['check', '--fixture', repo.dir, '--no-tests'])
    assert.equal(result.status, 1)
    assert.match(result.stdout, /^결함 PR 2개 — 문제 1개/)
    assert.match(result.stdout, /COM-016 .*\n {4}✗ 패치가 정상 버전에 붙지 않는다 — /)
  })

  it('패턴 예시 설정이 틀리면 결함과 따로 알린다(exit 1)', () => {
    const patterns = join(out, 'patterns')
    const specs = join(out, 'pattern-specs')
    mkdirSync(join(patterns, 'concurrency/assets'), { recursive: true })
    writeFileSync(join(patterns, 'concurrency/PATTERN.md'), '---\nname: concurrency\n---\n')
    writeFileSync(join(patterns, 'concurrency/assets/a.test.ts'), '')
    writeFileSync(join(patterns, 'concurrency/assets/a.slop.test.ts'), '')
    mkdirSync(specs)
    const asset = (file, defect) => ({ file, at: `app/test/${file}`, defect })
    writeFileSync(join(specs, 'concurrency.json'), JSON.stringify({ pattern: 'concurrency', assets: [asset('a.test.ts', 'COM-007'), asset('a.slop.test.ts', 'COM-404')] }))
    const result = run(['check', 'COM-007', '--fixture', repo.dir, '--no-tests', '--patterns', patterns, '--pattern-specs', specs])
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /^결함 PR 1개 — 문제 1개/)
    assert.match(result.stdout, /패턴 예시 설정\n {4}✗ .*COM-404 — 없는 결함이다/)
  })

  it('모르는 결함 ID는 오류다', () => {
    const result = run(['check', 'COM-999', '--fixture', repo.dir, '--no-tests'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /COM-999/)
  })
})

describe('defects.mjs materialize·base', () => {
  it('임시 git 저장소에 main = 정상 버전, defect/{ID} = PR 제목·본문으로 커밋한 결함 버전을 만든다 — 정답(defects/)은 넣지 않는다', () => {
    const dir = join(out, 'pr')
    const result = run(['materialize', 'COM-007', dir, '--fixture', repo.dir])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(git(dir, 'branch', '--show-current'), 'defect/COM-007')
    assert.equal(git(dir, 'log', '--format=%s', 'main'), 'feat: 국수집 주문 앱')
    assert.equal(git(dir, 'log', '-1', '--format=%B'), 'feat: 재고 부족을 알린다\n\n요구사항 — 남은 수량을 알린다')
    assert.equal(git(dir, 'diff', '--name-only', 'main'), 'app/src/stock.ts')
    assert.equal(git(dir, 'status', '--porcelain'), '')
    assert.equal(existsSync(join(dir, 'defects')), false)
    assert.equal(existsSync(join(dir, 'app/test/stock.test.ts')), true)
  })

  it('같은 결함은 언제 만들어도 커밋 해시가 같다 — 작성자·시각을 고정한다', () => {
    run(['materialize', 'COM-007', join(out, 'again'), '--fixture', repo.dir])
    assert.equal(git(join(out, 'again'), 'rev-parse', 'HEAD'), git(join(out, 'pr'), 'rev-parse', 'HEAD'))
  })

  it('이력(history)이 있으면 main에 예전 커밋을 쌓는다 — 정상 버전에서 이력 패치를 거꾸로 풀어 처음 상태를 만들고 다시 올린다', () => {
    // 정상 버전의 app/src/stock.ts에 이르기까지의 예전 수정 하나 — 조건부 차감이 없던 상태에서 조건을 더했다
    const before = ['export const take = async (db, id, n) => {', "  await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [id, n])", '}', ''].join('\n')
    const fixed = execFileSync('git', ['show', 'HEAD:app/src/stock.ts'], { cwd: repo.dir, encoding: 'utf8' })
    repo.write({ 'app/src/stock.ts': before })
    const fix = repo.git('diff', '-R') // 처음 상태 → 정상 버전
    repo.git('checkout', '--', 'app/src/stock.ts')
    const defect = JSON.parse(readFileSync(join(repo.dir, 'defects/COM-007/defect.json'), 'utf8'))
    mkdirSync(join(repo.dir, 'defects/HIST-001/history'), { recursive: true })
    writeFileSync(join(repo.dir, 'defects/HIST-001/history/01-conditional.patch'), fix)
    writeFileSync(join(repo.dir, 'defects/HIST-001/change.patch'), readFileSync(join(repo.dir, 'defects/COM-007/change.patch')))
    writeFileSync(join(repo.dir, 'defects/HIST-001/defect.json'), JSON.stringify({ ...defect, id: 'HIST-001', context: '이력', history: [{ message: 'fix: 재고보다 많이 팔리던 문제', patch: 'history/01-conditional.patch' }] }))

    const dir = join(out, 'history')
    const result = run(['materialize', 'HIST-001', dir, '--fixture', repo.dir])

    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(git(dir, 'log', '--format=%s', 'main'), 'fix: 재고보다 많이 팔리던 문제\nfeat: 국수집 주문 앱')
    assert.equal(git(dir, 'show', 'main~1:app/src/stock.ts'), before.trimEnd())
    assert.equal(git(dir, 'show', 'main:app/src/stock.ts'), fixed.trimEnd())
    assert.equal(git(dir, 'log', '-1', '--format=%s'), 'feat: 재고 부족을 알린다')
    assert.equal(run(['check', 'HIST-001', '--fixture', repo.dir, '--no-tests']).status, 0)
  })

  it('이력 패치가 정상 버전에서 거꾸로 붙지 않으면 실패한다', () => {
    writeFileSync(join(repo.dir, 'defects/HIST-001/history/01-conditional.patch'), readFileSync(join(repo.dir, 'defects/COM-016/change.patch')))
    const result = run(['check', 'HIST-001', '--fixture', repo.dir, '--no-tests'])
    assert.equal(result.status, 1)
    assert.match(result.stdout, /이력 패치.*history 1/)
  })

  it('--branch로 결함 브랜치 이름을 정한다 — 평가용 저장소에 결함 ID가 드러나지 않게', () => {
    const dir = join(out, 'neutral')
    const result = run(['materialize', 'COM-007', dir, '--fixture', repo.dir, '--branch', 'feature/stock-message'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(git(dir, 'branch', '--show-current'), 'feature/stock-message')
    assert.equal(git(dir, 'branch', '--format=%(refname:short)'), 'feature/stock-message\nmain')
  })

  it('--link-deps면 예제 저장소의 node_modules를 링크한다 — 커밋에는 들어가지 않는다', () => {
    mkdirSync(join(repo.dir, 'node_modules/left-pad'), { recursive: true })
    writeFileSync(join(repo.dir, 'node_modules/left-pad/index.js'), 'module.exports = 1\n')
    const dir = join(out, 'deps')
    const result = run(['materialize', 'COM-007', dir, '--fixture', repo.dir, '--link-deps'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(dir, 'node_modules/left-pad/index.js')), true)
    assert.equal(git(dir, 'status', '--porcelain'), '')
  })

  it('base도 --link-deps를 받는다 — 슬롭 측정이 정상 버전에서 테스트를 돌린다', () => {
    mkdirSync(join(repo.dir, 'node_modules/left-pad'), { recursive: true })
    writeFileSync(join(repo.dir, 'node_modules/left-pad/index.js'), 'module.exports = 1\n')
    const dir = join(out, 'base-deps')
    const result = run(['base', dir, '--fixture', repo.dir, '--link-deps'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(dir, 'node_modules/left-pad/index.js')), true)
    assert.equal(git(dir, 'status', '--porcelain'), '')
  })

  it('비어 있지 않은 폴더에는 만들지 않는다', () => {
    mkdirSync(join(out, 'busy'))
    writeFileSync(join(out, 'busy/keep.txt'), 'x')
    const result = run(['materialize', 'COM-007', join(out, 'busy'), '--fixture', repo.dir])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /비어 있지 않다/)
  })

  it('base는 정상 버전만 커밋한다 — 새 결함 패치를 만들 때 쓴다', () => {
    const dir = join(out, 'base')
    const result = run(['base', dir, '--fixture', repo.dir])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(git(dir, 'branch', '--show-current'), 'main')
    assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '1')
    assert.equal(existsSync(join(dir, 'defects')), false)
  })
})
