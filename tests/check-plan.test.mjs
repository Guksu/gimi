import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planChecks } from '../skills/gimi-test/scripts/lib/plan.mjs'

const projectOf = (files) => ({
  exists: (path) => path in files,
  readJson: (path) => JSON.parse(files[path]),
  readText: (path) => files[path],
})
const pkg = (json) => JSON.stringify(json)
const changedOf = (...paths) => paths.map((path) => (typeof path === 'string' ? { path, status: 'M' } : path))
const commands = (plan) => plan.checks.map((c) => [c.name, c.cwd, c.command])
const skips = (plan) => plan.skipped.map((s) => [s.name, s.cwd])

describe('planChecks — 프로젝트 파일 감지(JavaScript·TypeScript)', () => {
  it('Vitest면 바뀐 코드 파일과 관련된 테스트만 돌리고, tsconfig가 있으면 타입 검사, lint 스크립트가 있으면 린트를 넣는다 — 지운 파일과 코드가 아닌 파일은 넘기지 않는다', () => {
    const project = projectOf({ 'package.json': pkg({ scripts: { test: 'vitest', lint: 'eslint .' }, devDependencies: { vitest: '3', typescript: '6' } }), 'tsconfig.json': '{}' })
    const plan = planChecks({ changed: changedOf('src/a.ts', 'src/b.tsx', 'README.md', { path: 'src/gone.ts', status: 'D' }), config: {}, harness: null, project })
    assert.equal(plan.source, 'detected')
    assert.deepEqual(commands(plan), [
      ['test', '', 'npx vitest related --run src/a.ts src/b.tsx'],
      ['typecheck', '', 'npx tsc --noEmit -p tsconfig.json'],
      ['lint', '', 'npm run lint'],
    ])
    assert.equal(plan.checks[0].scope, 'related')
  })

  it('Jest면 --findRelatedTests를 쓴다', () => {
    const project = projectOf({ 'package.json': pkg({ scripts: { test: 'jest' } }) })
    const plan = planChecks({ changed: changedOf('src/a.ts'), config: {}, harness: null, project })
    assert.deepEqual(commands(plan)[0], ['test', '', 'npx jest --findRelatedTests src/a.ts --passWithNoTests'])
  })

  it('관련 테스트만 고를 수 없는 테스트 도구면 npm test로 전체를 돌리고 범위를 all로 적는다. typecheck 스크립트가 있으면 그것을 쓴다', () => {
    const project = projectOf({ 'package.json': pkg({ scripts: { test: 'node --test', typecheck: 'tsc -b' } }) })
    const plan = planChecks({ changed: changedOf('src/a.ts'), config: {}, harness: null, project })
    assert.deepEqual(commands(plan), [
      ['test', '', 'npm test'],
      ['typecheck', '', 'npm run typecheck'],
    ])
    assert.equal(plan.checks[0].scope, 'all')
    assert.deepEqual(skips(plan), [['lint', '']])
  })

  it('npm init 기본 test 스크립트("no test specified")는 테스트가 없는 것으로 본다', () => {
    const project = projectOf({ 'package.json': pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })
    const plan = planChecks({ changed: changedOf('src/a.js'), config: {}, harness: null, project })
    assert.ok(plan.skipped.some((s) => s.name === 'test' && /테스트 스크립트/.test(s.reason)))
  })

  it('코드가 아닌 파일만 바뀌었으면 테스트·타입 검사를 건너뛴다고 적는다', () => {
    const project = projectOf({ 'package.json': pkg({ scripts: { test: 'vitest' }, devDependencies: { vitest: '3' } }) })
    const plan = planChecks({ changed: changedOf('README.md'), config: {}, harness: null, project })
    assert.deepEqual(plan.checks, [])
    assert.ok(plan.skipped.every((s) => /바뀐 코드 파일이 없다/.test(s.reason)))
  })

  it('모노레포는 가장 가까운 package.json마다 따로 돌리고, 경로는 그 폴더 기준이다', () => {
    const project = projectOf({
      'package.json': pkg({ workspaces: ['packages/*'] }),
      'packages/web/package.json': pkg({ scripts: { test: 'vitest' }, devDependencies: { vitest: '3' } }),
      'packages/api/package.json': pkg({ scripts: { test: 'jest' } }),
    })
    const plan = planChecks({ changed: changedOf('packages/web/src/x.ts', 'packages/api/src/y.ts'), config: {}, harness: null, project })
    assert.deepEqual(
      commands(plan).filter(([name]) => name === 'test'),
      [
        ['test', 'packages/api', 'npx jest --findRelatedTests src/y.ts --passWithNoTests'],
        ['test', 'packages/web', 'npx vitest related --run src/x.ts'],
      ],
    )
  })

  it('타입 선언 파일(.d.ts)과 도구용 숨김 폴더(.agents/ 등)의 파일은 관련 테스트 찾기에 넘기지 않는다', () => {
    const project = projectOf({ 'package.json': pkg({ devDependencies: { vitest: '3' } }) })
    const plan = planChecks({ changed: changedOf('src/a.ts', 'src/types.d.ts', '.agents/skills/x/bundle.js'), config: {}, harness: null, project })
    assert.equal(plan.checks[0].command, 'npx vitest related --run src/a.ts')
  })

  it('바뀐 코드 파일이 100개를 넘으면 관련 테스트를 고르지 않고 전체를 돌린다고 밝힌다', () => {
    const many = Array.from({ length: 101 }, (_, i) => `src/f${i}.ts`)
    const vitest = planChecks({ changed: changedOf(...many), config: {}, harness: null, project: projectOf({ 'package.json': pkg({ devDependencies: { vitest: '3' } }) }) })
    assert.deepEqual([vitest.checks[0].command, vitest.checks[0].scope], ['npx vitest run', 'all'])
    const jest = planChecks({ changed: changedOf(...many), config: {}, harness: null, project: projectOf({ 'package.json': pkg({ scripts: { test: 'jest' } }) }) })
    assert.deepEqual([jest.checks[0].command, jest.checks[0].scope], ['npx jest --passWithNoTests', 'all'])
  })

  it('공백이 든 경로는 따옴표로 감싼다', () => {
    const project = projectOf({ 'package.json': pkg({ devDependencies: { vitest: '3' } }) })
    const plan = planChecks({ changed: changedOf('src/a b.ts'), config: {}, harness: null, project })
    assert.equal(plan.checks[0].command, "npx vitest related --run 'src/a b.ts'")
  })
})

describe('planChecks — 프로젝트 파일 감지(다른 언어)', () => {
  it('Gradle은 바뀐 파일이 속한 모듈의 test 작업을 루트의 gradlew로 돌린다', () => {
    const project = projectOf({ 'settings.gradle.kts': '', gradlew: '', 'order/build.gradle.kts': '' })
    const plan = planChecks({ changed: changedOf('order/src/main/kotlin/Order.kt'), config: {}, harness: null, project })
    assert.deepEqual(commands(plan), [['test', '', './gradlew :order:test']])
  })

  it('Maven은 바뀐 모듈만 -pl로 돌린다', () => {
    const project = projectOf({ 'pom.xml': '', 'api/pom.xml': '' })
    const plan = planChecks({ changed: changedOf('api/src/main/java/Api.java'), config: {}, harness: null, project })
    assert.deepEqual(commands(plan), [['test', '', 'mvn -q -pl api test']])
  })

  it('pyproject는 바뀐 테스트 파일만 pytest로, mypy 설정이 있으면 바뀐 파일을 mypy로 본다', () => {
    const project = projectOf({ 'pyproject.toml': '[tool.mypy]\nstrict = true\n' })
    const plan = planChecks({ changed: changedOf('app/order.py', 'tests/test_order.py'), config: {}, harness: null, project })
    assert.deepEqual(commands(plan), [
      ['test', '', 'python -m pytest tests/test_order.py'],
      ['typecheck', '', 'python -m mypy app/order.py tests/test_order.py'],
    ])
  })

  it('Go는 바뀐 패키지만 go test·go vet으로 본다', () => {
    const project = projectOf({ 'go.mod': 'module x' })
    const plan = planChecks({ changed: changedOf('internal/order/order.go', 'cmd/main.go', 'internal/order/order_test.go'), config: {}, harness: null, project })
    assert.deepEqual(commands(plan), [
      ['test', '', 'go test ./cmd ./internal/order'],
      ['typecheck', '', 'go vet ./cmd ./internal/order'],
    ])
  })

  it('프로젝트 파일을 찾지 못하면 설정에 명령을 적으라고 안내하고 건너뛴다', () => {
    const plan = planChecks({ changed: changedOf('scripts/deploy.sh'), config: {}, harness: null, project: projectOf({}) })
    assert.deepEqual(plan.checks, [])
    assert.ok(plan.skipped.some((s) => /finishCheck\.commands/.test(s.reason)))
  })
})

describe('planChecks — 설정과 하네스가 먼저다', () => {
  const project = projectOf({ 'package.json': pkg({ scripts: { test: 'vitest' }, devDependencies: { vitest: '3' } }) })

  it('.agents/gimi.json의 finishCheck.commands가 있으면 그것만 돌린다', () => {
    const config = { finishCheck: { commands: [{ name: 'test', command: 'make test', timeoutMs: 60000 }] } }
    const plan = planChecks({ changed: changedOf('src/a.ts'), config, harness: null, project })
    assert.equal(plan.source, 'config')
    assert.deepEqual(commands(plan), [['test', '', 'make test']])
    assert.equal(plan.checks[0].timeoutMs, 60000)
  })

  it('guksu-harness verifier 설정이 있으면 그 명령을 쓰되, check.mjs 자신은 빼서 무한히 돌지 않게 한다', () => {
    const harness = { checks: [{ name: 'test', command: 'npm test' }, { name: 'gimi', command: 'node skills/gimi-test/scripts/check.mjs' }] }
    const plan = planChecks({ changed: changedOf('src/a.ts'), config: {}, harness, project })
    assert.equal(plan.source, 'harness')
    assert.deepEqual(commands(plan), [['test', '', 'npm test']])
  })

  it('하네스 설정에 check.mjs만 있으면 프로젝트 파일 감지로 내려간다', () => {
    const harness = { checks: [{ name: 'gimi', command: 'node check.mjs' }] }
    assert.equal(planChecks({ changed: changedOf('src/a.ts'), config: {}, harness, project }).source, 'detected')
  })
})
