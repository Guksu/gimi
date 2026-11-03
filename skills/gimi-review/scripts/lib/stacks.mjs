/**
 * 설정에 stacks가 없을 때 공통 금지선의 대상을 저장소를 보고 정한다(설계 결정 59).
 * 프론트는 화면 라이브러리 의존성이나 화면 파일, 백엔드는 서버·DB 의존성이나 서버 언어의 소스·빌드 파일로 본다.
 * 서버와 화면을 함께 가진 프레임워크(next 등)는 둘 다다.
 * 한쪽을 빼는 쪽으로 틀리면 금지선이 통째로 빠지므로, 애매하면 둘 다 보인다 — 신호가 하나도 없을 때,
 * package.json을 다 읽지 못했는데 한쪽만 찾았을 때. 에이전트는 diff에 닿는 규칙만 읽는다.
 */

const STACKS = ['frontend-ts', 'backend']
const FRONTEND_DEPS = new Set(['react', 'react-dom', 'react-native', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact', 'expo'])
const FULLSTACK_DEPS = new Set(['next', 'nuxt', '@sveltejs/kit', '@remix-run/node', '@remix-run/react', 'astro', '@solidjs/start'])
const BACKEND_DEPS = new Set([
  '@nestjs/core', '@nestjs/common', 'express', 'fastify', 'koa', 'hono', '@hapi/hapi', '@trpc/server', '@apollo/server', 'graphql-yoga',
  '@prisma/client', 'prisma', 'typeorm', 'sequelize', 'mongoose', 'mongodb', 'drizzle-orm', 'knex', 'pg', 'mysql2', 'redis', 'ioredis',
])
const FRONTEND_EXT = /\.(tsx|jsx|vue|svelte)$/
const BACKEND_EXT = /\.(py|java|kt|go|rb|php|rs|cs|scala|ex)$/
const BACKEND_MANIFESTS = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'go.mod', 'pyproject.toml', 'setup.py', 'manage.py', 'Pipfile', 'Gemfile', 'composer.json', 'Cargo.toml', 'mix.exs'])

const depth = (path) => path.split('/').length
const vendored = (path) => path.split('/').includes('node_modules')
const depNames = (json) => ['dependencies', 'devDependencies'].flatMap((key) => (json?.[key] && typeof json[key] === 'object' ? Object.keys(json[key]) : []))
const backendManifest = (name) => BACKEND_MANIFESTS.has(name) || name.endsWith('.csproj') || /^requirements.*\.txt$/.test(name)
// 얕은 경로가 앞, 깊이가 같으면 경로 순서
const before = (a, b) => depth(a.path) < depth(b.path) || (depth(a.path) === depth(b.path) && a.path < b.path)

/**
 * @param {{ files: string[], packages: Array<{ path: string, json: any }>, truncated?: boolean }} args
 *   files는 git이 추적하는 경로, packages는 그 가운데 package.json을 읽은 것, truncated는 package.json을 다 읽지 못했는지
 * @returns {{ stacks: string[], evidence: string[] }} evidence는 정한 대상마다 가장 얕은 신호 하나(프론트 먼저, 같은 것은 한 번)
 */
export const guessStacks = ({ files, packages, truncated = false }) => {
  // 대상마다 가장 얕은 신호 하나만 들고 간다 — 파일이 아주 많아도 정렬하지 않는다
  const best = new Map()
  const offer = (stack, path, text) => {
    const current = best.get(stack)
    if (!current || before({ path }, current)) best.set(stack, { path, text })
  }
  for (const { path, json } of packages) {
    if (vendored(path)) continue
    const names = depNames(json)
    const full = names.find((name) => FULLSTACK_DEPS.has(name))
    const front = names.find((name) => FRONTEND_DEPS.has(name))
    const back = names.find((name) => BACKEND_DEPS.has(name))
    if (full) for (const stack of STACKS) offer(stack, path, `${path}의 ${full}`)
    if (front) offer('frontend-ts', path, `${path}의 ${front}`)
    if (back) offer('backend', path, `${path}의 ${back}`)
  }
  for (const path of files) {
    if (vendored(path)) continue
    const front = path.match(FRONTEND_EXT)?.[0]
    if (front) offer('frontend-ts', path, `${path} 같은 ${front} 파일`)
    const name = path.split('/').at(-1)
    if (backendManifest(name)) offer('backend', path, path)
    else {
      const back = path.match(BACKEND_EXT)?.[0]
      if (back) offer('backend', path, `${path} 같은 ${back} 파일`)
    }
  }
  const found = STACKS.filter((stack) => best.has(stack))
  const evidence = [...new Set(found.map((stack) => best.get(stack).text))]
  if (found.length === 0) return { stacks: [...STACKS], evidence: [] }
  if (found.length === 1 && truncated) return { stacks: [...STACKS], evidence: [...evidence, 'package.json을 다 읽지 못함'] }
  return { stacks: found, evidence }
}
