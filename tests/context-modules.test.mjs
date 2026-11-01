import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectContext } from '../skills/gimi-review/scripts/lib/collect.mjs'
import { loadTypescript } from '../skills/gimi-review/scripts/lib/impact.mjs'
import { loadYaml } from '../skills/gimi-review/scripts/lib/yaml.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

/** 불러오면 표시 파일을 남기는 가짜 패키지 — 실행됐는지 본다 */
const fakePackage = ({ name, marker, exports }) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '9.9.9', main: 'index.js' }),
  [`node_modules/${name}/index.js`]: `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\nmodule.exports = ${exports}\n`,
})

describe('리뷰하는 저장소의 패키지 불러오기 — git에 커밋된 패키지는 실행하지 않는다', () => {
  it('git에 커밋된 node_modules/typescript는 불러오지 않고 이유를 알린다 — PR이 커밋한 코드가 리뷰하는 컴퓨터에서 실행되지 않게', () => {
    const repo = makeRepo()
    try {
      const marker = join(repo.dir, 'ran-typescript.txt')
      repo.write(fakePackage({ name: 'typescript', marker, exports: '{ createLanguageService() {} }' }))
      repo.commit('feat: typescript를 커밋함')
      const { ts, reason } = loadTypescript({ root: repo.dir })
      assert.equal(ts, null)
      assert.match(reason, /typescript을\(를\) 불러오지 않았다 — node_modules에 git이 추적하는 파일이 있다\(node_modules\/typescript\//)
      assert.equal(existsSync(marker), false)
    } finally {
      repo.cleanup()
    }
  })

  it('git이 추적하지 않는(설치한) typescript는 그대로 불러온다', () => {
    const repo = makeRepo()
    try {
      const marker = join(repo.dir, 'ran-typescript.txt')
      repo.write({ '.gitignore': 'node_modules/\nran-*.txt\n', 'src/a.ts': 'export const a = 1\n' })
      repo.commit('feat: 처음')
      repo.write(fakePackage({ name: 'typescript', marker, exports: '{ createLanguageService() {} }' }))
      const { ts, reason } = loadTypescript({ root: repo.dir })
      assert.equal(reason, null)
      assert.equal(typeof ts.createLanguageService, 'function')
    } finally {
      repo.cleanup()
    }
  })

  it('git에 커밋된 yaml·js-yaml은 불러오지 않고 내장 파서로 읽는다', () => {
    const repo = makeRepo()
    try {
      const marker = join(repo.dir, 'ran-yaml.txt')
      repo.write({ ...fakePackage({ name: 'yaml', marker, exports: '{ parse: () => ({}) }' }), ...fakePackage({ name: 'js-yaml', marker, exports: '{ load: () => ({}) }' }) })
      repo.commit('feat: yaml을 커밋함')
      const yaml = loadYaml({ root: repo.dir })
      assert.equal(yaml.name, '내장')
      assert.match(yaml.reason, /yaml을\(를\) 불러오지 않았다 — node_modules에 git이 추적하는 파일이 있다/)
      assert.equal(existsSync(marker), false)
    } finally {
      repo.cleanup()
    }
  })

  it('PR이 node_modules/typescript를 커밋해도 맥락 수집은 그 코드를 실행하지 않고 문자열 검색으로 찾는다', () => {
    const repo = makeRepo()
    try {
      const marker = join(repo.dir, 'ran-typescript.txt')
      repo.write({ 'src/a.ts': 'export const a = (n: number) => n\n', 'src/b.ts': "import { a } from './a'\nexport const b = a(1)\n" })
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ ...fakePackage({ name: 'typescript', marker, exports: '{ createLanguageService() {} }' }), 'src/a.ts': 'export const a = (n: number, m = 0) => n + m\n' })
      repo.commit('feat: 바꿈')
      const context = collectContext({ exec: execFor({ dir: repo.dir }), useGh: false })
      assert.equal(existsSync(marker), false)
      const a = context.impact.symbols.find((s) => s.name === 'a')
      assert.equal(a.method, 'text')
      assert.match(context.impact.reason, /typescript을\(를\) 불러오지 않았다 — node_modules에 git이 추적하는 파일이 있다/)
    } finally {
      repo.cleanup()
    }
  })
})

describe('리뷰하는 저장소의 패키지 불러오기 — 우회로(보안 리뷰가 재현한 것)', () => {
  const withRepo = (fn) => {
    const repo = makeRepo()
    try {
      return fn(repo)
    } finally {
      repo.cleanup()
    }
  }
  const mark = (repo, tag) => join(repo.dir, `ran-${tag}.txt`)
  const writer = (marker) => `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`

  it('package.json의 exports로 package.json을 JS 파일에 연결해도 실행하지 않는다', () =>
    withRepo((repo) => {
      const marker = mark(repo, 'exports')
      repo.write({
        'node_modules/typescript/package.json': JSON.stringify({ name: 'typescript', version: '9.9.9', exports: { '.': './index.js', './package.json': './evil.js' } }),
        'node_modules/typescript/index.js': 'module.exports = { createLanguageService() {} }\n',
        'node_modules/typescript/evil.js': `${writer(marker)}\nmodule.exports = { version: '9.9.9' }\n`,
      })
      repo.commit('feat: exports')
      const { ts } = loadTypescript({ root: repo.dir })
      assert.equal(ts, null)
      assert.equal(existsSync(marker), false)
    }))

  it('설치해 둔 패키지의 안쪽 파일만 커밋돼 있어도(체크아웃이 덮어씀) 불러오지 않는다 — node_modules에 git이 추적하는 것이 하나라도 있으면', () =>
    withRepo((repo) => {
      const marker = mark(repo, 'inner')
      repo.write({ '.gitignore': 'node_modules/\nran-*.txt\n' })
      repo.commit('feat: 처음')
      repo.write({
        'node_modules/yaml/package.json': JSON.stringify({ name: 'yaml', version: '2.0.0', main: 'index.js' }),
        'node_modules/yaml/index.js': "module.exports = require('./lib/inner.js')\n",
        'node_modules/yaml/lib/inner.js': `${writer(marker)}\nmodule.exports = { parse: () => ({}) }\n`,
      })
      repo.git('add', '-f', 'node_modules/yaml/lib/inner.js')
      repo.git('commit', '-q', '-m', 'feat: 안쪽 파일만 커밋')
      const yaml = loadYaml({ root: repo.dir })
      assert.equal(yaml.name, '내장')
      assert.match(yaml.reason, /node_modules에 git이 추적하는 파일이 있다/)
      assert.equal(existsSync(marker), false)
    }))

  it('main이 저장소 안의 node_modules 밖(..로 시작하는 이름, .git 안)을 가리키면 불러오지 않는다', () =>
    withRepo((repo) => {
      const marker = mark(repo, 'dotdot')
      repo.write({ '.gitignore': 'node_modules/\nran-*.txt\n', '..x.js': `${writer(marker)}\nmodule.exports = { parse: () => ({}) }\n` })
      repo.commit('feat: 처음')
      repo.write({ 'node_modules/yaml/package.json': JSON.stringify({ name: 'yaml', main: '../../..x.js' }) })
      assert.equal(loadYaml({ root: repo.dir }).name, '내장')
      assert.equal(existsSync(marker), false)
      repo.write({ 'node_modules/yaml/package.json': JSON.stringify({ name: 'yaml', main: '../../.git/HEAD' }) })
      const yaml = loadYaml({ root: repo.dir })
      assert.equal(yaml.name, '내장')
      assert.match(yaml.reason, /node_modules 밖/)
    }))

  it('저장소 루트 package.json의 자기 참조(name이 yaml)는 불러오지 않는다', () =>
    withRepo((repo) => {
      const marker = mark(repo, 'self')
      repo.write({ 'package.json': JSON.stringify({ name: 'yaml', exports: { '.': './e.js' } }), 'e.js': `${writer(marker)}\nmodule.exports = { parse: () => ({}) }\n` })
      repo.commit('feat: 자기 참조')
      assert.equal(loadYaml({ root: repo.dir }).name, '내장')
      assert.equal(existsSync(marker), false)
    }))

  it('함께 보는 저장소도 같은 검사를 받는다', () =>
    withRepo((repo) => {
      const marker = mark(repo, 'linked')
      repo.write(fakePackage({ name: 'typescript', marker, exports: '{ createLanguageService() {} }' }))
      repo.commit('feat: 커밋된 typescript')
      const { ts, reason } = loadTypescript({ root: repo.dir })
      assert.equal(ts, null)
      assert.doesNotMatch(reason, /PR이 커밋한/)
      assert.equal(existsSync(marker), false)
    }))
})

describe('리뷰하는 저장소의 내용으로 다른 것을 실행하거나 밖에 쓰지 않는다', () => {
  it('PR의 .gitattributes가 diff 변환 프로그램(textconv)을 골라도 git diff·blame이 돌리지 않는다', () => {
    const repo = makeRepo()
    try {
      const marker = join(repo.dir, 'ran-textconv.txt')
      const script = join(repo.dir, 'conv.sh')
      writeFileSync(script, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\ncat "$1"\n`, { mode: 0o755 })
      repo.git('config', 'diff.evil.textconv', script)
      repo.write({ '.gitignore': 'conv.sh\nran-*.txt\n', 'src/a.ts': 'export const a = 1\n' })
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ '.gitattributes': '*.ts diff=evil\n', 'src/a.ts': 'export const a = 2\n' })
      repo.commit('feat: 바꿈')
      collectContext({ exec: execFor({ dir: repo.dir }), useGh: false })
      assert.equal(existsSync(marker), false)
    } finally {
      repo.cleanup()
    }
  })

  it('저장소 밖을 가리키는 심볼릭 링크 파일은 사용처 문맥으로 읽지 않는다', () => {
    const repo = makeRepo()
    const outside = mkdtempSync(join(tmpdir(), 'gimi-outside-'))
    try {
      writeFileSync(join(outside, 'secret.ts'), "export const used = a('비밀')\n")
      repo.write({ 'src/a.ts': 'export const a = (s: string) => s\n' })
      symlinkSync(join(outside, 'secret.ts'), join(repo.dir, 'src/link.ts'))
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ 'src/a.ts': 'export const a = (s: string, n = 0) => s + n\n' })
      repo.commit('feat: 바꿈')
      const context = collectContext({ exec: execFor({ dir: repo.dir }), useGh: false })
      assert.equal(JSON.stringify(context).includes('비밀'), false)
    } finally {
      repo.cleanup()
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('docs/gimi/reviews가 저장소 밖을 가리키는 심볼릭 링크면 맥락 묶음을 쓰지도 지우지도 않는다', () => {
    const repo = makeRepo()
    const outside = mkdtempSync(join(tmpdir(), 'gimi-outside-'))
    try {
      writeFileSync(join(outside, '2020-01-01-feat-x.context.json'), '{}')
      repo.write({ 'src/a.ts': 'export const a = 1\n' })
      mkdirSync(join(repo.dir, 'docs/gimi'), { recursive: true })
      symlinkSync(outside, join(repo.dir, 'docs/gimi/reviews'))
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ 'src/a.ts': 'export const a = 2\n' })
      repo.commit('feat: 바꿈')
      const cli = fileURLToPath(new URL('../skills/gimi-review/scripts/context.mjs', import.meta.url))
      const result = spawnSync(process.execPath, [cli, '--no-gh'], { cwd: repo.dir, encoding: 'utf8' })
      assert.deepEqual(readdirSync(outside), ['2020-01-01-feat-x.context.json'])
      assert.match(result.stdout + result.stderr, /저장소 밖/)
    } finally {
      repo.cleanup()
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('리뷰하는 저장소의 패키지 불러오기 — 다시 리뷰에서 재현한 것', () => {
  const writer = (marker) => `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`

  it('유니코드로 접히는 이름(node_moduleſ)으로 커밋해 설치한 안쪽 파일을 덮어써도 불러오지 않는다 — 글자가 아니라 같은 폴더인지 본다', () => {
    const repo = makeRepo()
    try {
      const marker = join(repo.dir, 'ran-fold.txt')
      repo.write({ '.gitignore': 'node_modules/\nran-*.txt\n' })
      repo.commit('feat: 처음')
      repo.write({
        'node_modules/yaml/package.json': JSON.stringify({ name: 'yaml', main: 'index.js' }),
        'node_modules/yaml/index.js': "module.exports = require('./lib/inner.js')\n",
        'node_modules/yaml/lib/inner.js': 'module.exports = { parse: () => ({}) }\n',
      })
      // 대소문자를 유니코드로 접는 디스크(macOS)에서는 같은 폴더라 설치한 파일을 덮어쓴다
      repo.write({ 'node_moduleſ/yaml/lib/inner.js': `${writer(marker)}\nmodule.exports = { parse: () => ({}) }\n` })
      repo.git('add', '-f', 'node_moduleſ/yaml/lib/inner.js')
      repo.git('commit', '-q', '-m', 'feat: 접히는 이름')
      const sameFolder = statSync(join(repo.dir, 'node_moduleſ')).ino === statSync(join(repo.dir, 'node_modules')).ino
      const yaml = loadYaml({ root: repo.dir })
      assert.equal(existsSync(marker), false)
      if (sameFolder) assert.match(yaml.reason, /node_modules와 같은 폴더/)
    } finally {
      repo.cleanup()
    }
  })

  it('저장소 밖으로 이어져도 경로에 node_modules가 없으면 불러오지 않는다', () => {
    const repo = makeRepo()
    const outside = mkdtempSync(join(tmpdir(), 'gimi-outside-'))
    try {
      const marker = join(repo.dir, 'ran-outside.txt')
      writeFileSync(join(outside, 'evil.js'), `${writer(marker)}\nmodule.exports = { parse: () => ({}) }\n`)
      repo.write({ 'package.json': JSON.stringify({ name: 'yaml', exports: { '.': './gl/evil.js' } }) })
      symlinkSync(outside, join(repo.dir, 'gl'))
      repo.commit('feat: 밖으로 잇는 링크')
      const yaml = loadYaml({ root: repo.dir })
      assert.equal(yaml.name, '내장')
      assert.match(yaml.reason, /node_modules가 없는 곳/)
      assert.equal(existsSync(marker), false)
    } finally {
      repo.cleanup()
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('함께 보는 저장소의 커밋된 typescript도 맥락 수집 흐름에서 실행하지 않는다', () => {
    const front = makeRepo()
    const repo = makeRepo()
    try {
      const marker = join(front.dir, 'ran-linked.txt')
      front.write(fakePackage({ name: 'typescript', marker, exports: '{ createLanguageService() {} }' }))
      front.write({ 'src/api.js': "export const get = () => fetch('/orders/' + 1)\n" })
      front.commit('feat: 화면')
      const api = (extra) => `openapi: 3.0.0\npaths:\n  /orders/{id}:\n    get:\n      responses:\n        '200':\n          description: ok\n${extra}`
      repo.write({ 'api/openapi.yaml': api('  /health:\n    get:\n      responses:\n        \'200\':\n          description: ok\n') })
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ 'api/openapi.yaml': 'openapi: 3.0.0\npaths:\n  /health:\n    get:\n      responses:\n        \'200\':\n          description: ok\n' })
      repo.commit('feat: 주문 조회를 지움')
      const context = collectContext({ exec: execFor({ dir: repo.dir }), useGh: false, linkedRepos: [front.dir] })
      assert.equal(existsSync(marker), false)
      assert.ok(context.impact.notes.some((n) => n.includes(front.dir) && /node_modules에 git이 추적하는 파일이 있다/.test(n)), context.impact.notes.join('\n'))
    } finally {
      repo.cleanup()
      front.cleanup()
    }
  })

  it('git으로 확인할 수 없으면(저장소가 아님) 불러오지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gimi-plain-'))
    try {
      mkdirSync(join(dir, 'node_modules/yaml'), { recursive: true })
      writeFileSync(join(dir, 'node_modules/yaml/package.json'), JSON.stringify({ name: 'yaml', main: 'index.js' }))
      writeFileSync(join(dir, 'node_modules/yaml/index.js'), 'module.exports = { parse: () => ({}) }\n')
      const yaml = loadYaml({ root: dir })
      assert.equal(yaml.name, '내장')
      assert.match(yaml.reason, /git으로 node_modules를 확인하지 못했다/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('설치됐지만 불러오다 실패한 typescript는 "없다"와 구분해 알린다', () => {
    const repo = makeRepo()
    try {
      repo.write({ '.gitignore': 'node_modules/\n', 'src/a.ts': 'export const a = 1\n' })
      repo.commit('feat: 처음')
      repo.write({ 'node_modules/typescript/package.json': JSON.stringify({ name: 'typescript', main: 'index.js' }), 'node_modules/typescript/index.js': "throw new Error('깨짐')\n" })
      const { ts, reason } = loadTypescript({ root: repo.dir })
      assert.equal(ts, null)
      assert.match(reason, /typescript을\(를\) 불러오지 못했다/)
    } finally {
      repo.cleanup()
    }
  })

  it('docs/gimi/reviews가 없는 곳을 가리키는 심볼릭 링크여도 죽지 않고, 쓰지 않았다고 요약 끝에 적는다', () => {
    const repo = makeRepo()
    try {
      repo.write({ 'src/a.ts': 'export const a = 1\n' })
      mkdirSync(join(repo.dir, 'docs/gimi'), { recursive: true })
      symlinkSync(join(tmpdir(), 'gimi-없는-폴더-0000'), join(repo.dir, 'docs/gimi/reviews'))
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ 'src/a.ts': 'export const a = 2\n' })
      repo.commit('feat: 바꿈')
      const cli = fileURLToPath(new URL('../skills/gimi-review/scripts/context.mjs', import.meta.url))
      const result = spawnSync(process.execPath, [cli, '--no-gh'], { cwd: repo.dir, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /^전체 {4}쓰지 않았다 — --out <경로>나 --json으로 다시 돌린다$/m)
      assert.equal(existsSync(join(tmpdir(), 'gimi-없는-폴더-0000')), false)
    } finally {
      repo.cleanup()
    }
  })
})
