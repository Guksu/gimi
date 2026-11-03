import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guessStacks } from '../skills/gimi-review/scripts/lib/stacks.mjs'

const pkg = (path, dependencies = {}, devDependencies = {}) => ({ path, json: { dependencies, devDependencies } })

describe('guessStacks — 설정에 stacks가 없을 때 저장소를 보고 대상을 정한다', () => {
  it('프론트 의존성만 있으면 frontend-ts, 근거는 package.json과 의존성 이름', () => {
    const result = guessStacks({ files: ['package.json', 'src/main.ts'], packages: [pkg('package.json', { react: '^19.0.0' })] })
    assert.deepEqual(result, { stacks: ['frontend-ts'], evidence: ['package.json의 react'] })
  })

  it('백엔드 의존성만 있으면 backend — 개발 의존성도 본다', () => {
    const result = guessStacks({ files: ['package.json'], packages: [pkg('package.json', {}, { '@nestjs/core': '^11.0.0' })] })
    assert.deepEqual(result, { stacks: ['backend'], evidence: ['package.json의 @nestjs/core'] })
  })

  it('모노레포에서 둘 다 보이면 둘 다 — 근거는 대상마다 얕은 경로의 첫 신호 하나', () => {
    const packages = [pkg('server/package.json', { '@nestjs/core': '1', pg: '1' }), pkg('web/package.json', { react: '1', 'react-dom': '1' }), pkg('package.json')]
    const result = guessStacks({ files: ['package.json', 'server/package.json', 'web/package.json'], packages })
    assert.deepEqual(result, { stacks: ['frontend-ts', 'backend'], evidence: ['web/package.json의 react', 'server/package.json의 @nestjs/core'] })
  })

  it('JS가 아닌 서버는 빌드 파일로 본다 — go.mod·pom.xml·pyproject.toml·*.csproj 등', () => {
    assert.deepEqual(guessStacks({ files: ['go.mod', 'main.go'], packages: [] }), { stacks: ['backend'], evidence: ['go.mod'] })
    assert.deepEqual(guessStacks({ files: ['api/Api.csproj'], packages: [] }), { stacks: ['backend'], evidence: ['api/Api.csproj'] })
    assert.deepEqual(guessStacks({ files: ['backend/build.gradle.kts', 'web/src/App.tsx'], packages: [] }), {
      stacks: ['frontend-ts', 'backend'],
      evidence: ['web/src/App.tsx 같은 .tsx 파일', 'backend/build.gradle.kts'],
    })
  })

  it('화면 파일(.tsx·.jsx·.vue·.svelte)만 있어도 프론트로 본다', () => {
    assert.deepEqual(guessStacks({ files: ['src/Page.vue'], packages: [] }), { stacks: ['frontend-ts'], evidence: ['src/Page.vue 같은 .vue 파일'] })
  })

  it('신호가 하나도 없으면 둘 다 — 빠지는 줄이 생기는 것보다 줄이 많은 편이 낫다', () => {
    assert.deepEqual(guessStacks({ files: ['README.md', 'scripts/build.mjs'], packages: [pkg('package.json', { lodash: '1' })] }), { stacks: ['frontend-ts', 'backend'], evidence: [] })
  })

  it('node_modules 아래 경로와 형식이 이상한 package.json은 보지 않는다', () => {
    const packages = [pkg('node_modules/express/package.json', { express: '1' }), { path: 'web/package.json', json: null }, { path: 'a/package.json', json: { dependencies: 'react' } }]
    assert.deepEqual(guessStacks({ files: ['node_modules/x/go.mod', 'node_modules/x/A.tsx'], packages }), { stacks: ['frontend-ts', 'backend'], evidence: [] })
  })
})
