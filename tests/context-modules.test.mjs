import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
