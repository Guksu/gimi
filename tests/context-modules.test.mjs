import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
      assert.match(reason, /typescript.*git에 커밋되어 있어.*node_modules\/typescript\/index\.js.*불러오지 않았다/)
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
      assert.match(yaml.reason, /yaml.*git에 커밋되어 있어/)
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
      assert.match(context.impact.reason, /typescript이\(가\) git에 커밋되어 있어/)
    } finally {
      repo.cleanup()
    }
  })
})
