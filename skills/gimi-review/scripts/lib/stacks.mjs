/**
 * 설정에 stacks가 없을 때 공통 금지선의 대상을 저장소를 보고 정한다(설계 결정 59).
 * 프론트는 화면 라이브러리 의존성이나 화면 파일, 백엔드는 서버·DB 의존성이나 JS가 아닌 서버 언어의 빌드 파일로 본다.
 * 신호를 하나도 못 찾으면 둘 다 보인다 — 줄이 빠지는 것보다 줄이 많은 편이 낫다(에이전트는 diff에 닿는 규칙만 읽는다).
 */

const STACKS = ['frontend-ts', 'backend']
const FRONTEND_DEPS = new Set(['react', 'react-dom', 'react-native', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', '@angular/core', 'solid-js', 'preact', 'expo'])
const BACKEND_DEPS = new Set(['@nestjs/core', 'express', 'fastify', 'koa', 'hono', '@hapi/hapi', '@prisma/client', 'prisma', 'typeorm', 'sequelize', 'mongoose', 'drizzle-orm', 'knex', 'pg', 'mysql2'])
const FRONTEND_EXT = /\.(tsx|jsx|vue|svelte)$/
const BACKEND_MANIFESTS = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'Gemfile', 'composer.json', 'Cargo.toml', 'mix.exs'])

const depth = (path) => path.split('/').length
const vendored = (path) => path.split('/').includes('node_modules')
const depNames = (json) => ['dependencies', 'devDependencies'].flatMap((key) => (json?.[key] && typeof json[key] === 'object' ? Object.keys(json[key]) : []))

/**
 * @param {{ files: string[], packages: Array<{ path: string, json: any }> }} args files는 git이 추적하는 경로, packages는 그 가운데 package.json을 읽은 것
 * @returns {{ stacks: string[], evidence: string[] }} evidence는 정한 대상마다 얕은 경로의 첫 신호 하나(프론트 먼저)
 */
export const guessStacks = ({ files, packages }) => {
  const signals = []
  for (const { path, json } of packages) {
    if (vendored(path)) continue
    const names = depNames(json)
    const front = names.find((name) => FRONTEND_DEPS.has(name))
    const back = names.find((name) => BACKEND_DEPS.has(name))
    if (front) signals.push({ stack: 'frontend-ts', path, text: `${path}의 ${front}` })
    if (back) signals.push({ stack: 'backend', path, text: `${path}의 ${back}` })
  }
  for (const path of files) {
    if (vendored(path)) continue
    const ext = path.match(FRONTEND_EXT)?.[0]
    if (ext) signals.push({ stack: 'frontend-ts', path, text: `${path} 같은 ${ext} 파일` })
    const name = path.split('/').at(-1)
    if (BACKEND_MANIFESTS.has(name) || name.endsWith('.csproj')) signals.push({ stack: 'backend', path, text: path })
  }
  signals.sort((a, b) => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const found = STACKS.map((stack) => signals.find((signal) => signal.stack === stack)).filter(Boolean)
  if (found.length === 0) return { stacks: [...STACKS], evidence: [] }
  return { stacks: found.map((signal) => signal.stack), evidence: found.map((signal) => signal.text) }
}
