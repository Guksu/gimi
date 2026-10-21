import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkAgentDocs, checkManifests, checkRoot, checkRules, checkSharedCopies, checkSkillDoc, checkSkillSet } from '../scripts/lib/skills.mjs'

describe('checkSharedCopies', () => {
  const header = '// @shared exec.mjs origin: gimi-review\n'
  const origin = { skill: 'gimi-review', path: 'scripts/lib/exec.mjs', text: `${header}export const a = 1\n` }

  it('원본과 내용이 같은 복사본은 통과한다', () => {
    const copy = { skill: 'gimi-test', path: 'scripts/lib/exec.mjs', text: origin.text }
    assert.deepEqual(checkSharedCopies({ files: [origin, copy] }), [])
  })

  it('복사본이 원본과 다르면 오류', () => {
    const copy = { skill: 'gimi-test', path: 'scripts/lib/exec.mjs', text: `${header}export const a = 2\n` }
    const errors = checkSharedCopies({ files: [origin, copy] })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /skills\/gimi-test\/scripts\/lib\/exec\.mjs.*원본.*다름/)
  })

  it('원본이 없으면 오류', () => {
    const copy = { skill: 'gimi-test', path: 'scripts/lib/exec.mjs', text: origin.text }
    assert.equal(checkSharedCopies({ files: [copy] }).length, 1)
  })

  it('머리의 파일 이름이 실제 파일 이름과 다르면 오류', () => {
    const wrong = { skill: 'gimi-review', path: 'scripts/lib/other.mjs', text: origin.text }
    assert.ok(checkSharedCopies({ files: [wrong] }).some((e) => /파일 이름/.test(e)))
  })

  it('머리가 없는 파일은 보지 않는다', () => {
    assert.deepEqual(checkSharedCopies({ files: [{ skill: 'gimi-test', path: 'scripts/lib/run.mjs', text: '/** 그냥 파일 */\n' }] }), [])
  })

  it('Markdown은 HTML 주석 머리(<!-- @shared … origin: … -->)로 같은 검사를 한다', () => {
    const md = '<!-- @shared test.md origin: gimi-test -->\n# 테스트 금지선\n'
    const mdOrigin = { skill: 'gimi-test', path: 'shared/rules/test.md', text: md }
    assert.deepEqual(checkSharedCopies({ files: [mdOrigin, { skill: 'gimi-review', path: 'shared/rules/test.md', text: md }] }), [])
    assert.equal(checkSharedCopies({ files: [mdOrigin, { skill: 'gimi-review', path: 'shared/rules/test.md', text: `${md}고침\n` }] }).length, 1)
  })
})

describe('checkRules — 규칙 파일과 check.mjs가 맞는지', () => {
  const rule = (id, check) => `## ${id} 한 줄\n- 대상: 둘 다\n- 왜: a\n- 대신: b\n- 확인: c\n- 검사: ${check}\n- 근거: 측정 전\n`
  const files = (text) => [{ path: 'skills/gimi-test/shared/rules/test.md', text, kind: 'slop', area: 'test' }]

  it('검사 error·warn인 규칙과 check.mjs가 내는 지적의 ID·등급이 같으면 통과한다 — 리뷰·기록 줄은 check.mjs에 없어도 된다', () => {
    const text = `${rule('test/only-left', 'error')}\n${rule('test/real-wait', 'warn')}\n${rule('test/sequential-only', '리뷰')}`
    assert.deepEqual(checkRules({ files: files(text), slopSeverity: { 'test/only-left': 'error', 'test/real-wait': 'warn' } }), [])
  })

  it('규칙 파일에만 있거나, check.mjs에만 있거나, 등급이 다르면 오류다', () => {
    const text = `${rule('test/only-left', 'warn')}\n${rule('test/tautology', 'warn')}`
    const errors = checkRules({ files: files(text), slopSeverity: { 'test/only-left': 'error', 'code/empty-catch': 'error' } })
    assert.ok(errors.some((e) => /test\/only-left.*error/.test(e)))
    assert.ok(errors.some((e) => /test\/tautology.*check\.mjs에 없다/.test(e)))
    assert.ok(errors.some((e) => /code\/empty-catch.*규칙 파일에 없다/.test(e)))
  })

  it('형식 오류도 함께 낸다', () => {
    assert.ok(checkRules({ files: files('## test/a 한 줄\n- 대상: 둘 다\n'), slopSeverity: {} }).some((e) => /필수 항목/.test(e)))
  })
})

const longDescription = '코드 리뷰를 diff 안에서 끝내지 않고 바뀐 코드를 쓰는 곳과 요구사항과 변경 이력까지 모아 근거가 있는 지적만 남기며 "PR 리뷰해줘" 요청과 code review 작업에 쓴다.'
const docOf = ({ name = 'gimi-review', description = longDescription, body = '\n# 본문\n' } = {}) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
const noFiles = () => false

describe('checkSkillDoc', () => {
  it('올바른 문서는 오류가 없다', () => {
    assert.deepEqual(checkSkillDoc({ name: 'gimi-review', md: docOf(), exists: noFiles }), [])
  })

  it('frontmatter가 없으면 오류', () => {
    assert.equal(checkSkillDoc({ name: 'gimi-review', md: '# 제목\n', exists: noFiles }).length, 1)
  })

  it('name이 폴더명과 다르면 오류', () => {
    const errors = checkSkillDoc({ name: 'gimi-review', md: docOf({ name: 'gimi-reviews' }), exists: noFiles })
    assert.ok(errors.some((e) => /폴더명/.test(e)))
  })

  it('name 형식(소문자·숫자·하이픈)을 어기면 오류', () => {
    const errors = checkSkillDoc({ name: 'Gimi_Review', md: docOf({ name: 'Gimi_Review' }), exists: noFiles })
    assert.ok(errors.some((e) => /소문자/.test(e)))
  })

  it('description이 80자보다 짧거나 1,024바이트를 넘으면 오류', () => {
    assert.ok(checkSkillDoc({ name: 'gimi-review', md: docOf({ description: '짧다' }), exists: noFiles }).some((e) => /description/.test(e)))
    assert.ok(checkSkillDoc({ name: 'gimi-review', md: docOf({ description: '가'.repeat(400) }), exists: noFiles }).some((e) => /바이트/.test(e)))
  })

  it('description에 ": "가 있으면 오류', () => {
    const errors = checkSkillDoc({ name: 'gimi-review', md: docOf({ description: `${longDescription} 예시: 이것` }), exists: noFiles })
    assert.ok(errors.some((e) => /": "/.test(e)))
  })

  it('description에 에이전트 명령문이 있으면 오류', () => {
    const errors = checkSkillDoc({ name: 'gimi-review', md: docOf({ description: `${longDescription} 반드시 이 스킬을 사용할 것.` }), exists: noFiles })
    assert.ok(errors.some((e) => /명령문/.test(e)))
  })

  it('본문이 500줄을 넘으면 오류', () => {
    const errors = checkSkillDoc({ name: 'gimi-review', md: docOf({ body: '줄\n'.repeat(501) }), exists: noFiles })
    assert.ok(errors.some((e) => /500줄/.test(e)))
  })

  it('본문이 가리키는 스킬 안의 경로가 없으면 오류, 있으면 통과', () => {
    const md = docOf({ body: '\n`references/context.md`와 [검사](scripts/check.mjs)를 본다. `docs/gimi/rules.md`는 회사 저장소 경로다.\n' })
    const missing = checkSkillDoc({ name: 'gimi-review', md, exists: noFiles })
    assert.equal(missing.filter((e) => /참조 경로/.test(e)).length, 2)
    const present = checkSkillDoc({ name: 'gimi-review', md, exists: () => true })
    assert.deepEqual(present, [])
  })
})

describe('checkSkillSet', () => {
  it('skills/ 아래 SKILL.md는 두 스킬의 것뿐이어야 한다', () => {
    assert.deepEqual(checkSkillSet({ skillDocs: ['skills/gimi-review/SKILL.md', 'skills/gimi-test/SKILL.md'] }), [])
    assert.equal(checkSkillSet({ skillDocs: ['skills/gimi-review/SKILL.md'] }).length, 1)
    assert.equal(checkSkillSet({ skillDocs: ['skills/gimi-review/SKILL.md', 'skills/gimi-test/SKILL.md', 'skills/gimi-test/patterns/x/SKILL.md'] }).length, 1)
  })
})

const manifests = () => ({
  claudePlugin: { name: 'gimi', version: '0.0.1' },
  claudeMarketplace: { name: 'gimi', metadata: { version: '0.0.1' }, plugins: [{ name: 'gimi', source: './', version: '0.0.1' }] },
  codexPlugin: { name: 'gimi', version: '0.0.1', skills: './skills/' },
  agentsMarketplace: { name: 'gimi', plugins: [{ name: 'gimi', source: { source: 'local', path: './' } }] },
})

describe('checkManifests', () => {
  it('이름·버전·경로가 맞으면 오류가 없다', () => {
    assert.deepEqual(checkManifests(manifests()), [])
  })

  it('버전이 하나라도 다르면 오류', () => {
    const m = manifests()
    m.codexPlugin.version = '0.0.2'
    assert.ok(checkManifests(m).some((e) => /버전/.test(e)))
  })

  it('이름이 gimi가 아니면 오류', () => {
    const m = manifests()
    m.claudeMarketplace.plugins[0].name = 'other'
    assert.ok(checkManifests(m).some((e) => /이름/.test(e)))
  })

  it('source·skills 경로가 저장소 루트가 아니면 오류', () => {
    const m = manifests()
    m.claudeMarketplace.plugins[0].source = './plugin'
    m.agentsMarketplace.plugins[0].source.path = './plugin'
    m.codexPlugin.skills = './other/'
    assert.equal(checkManifests(m).length, 3)
  })

  it('매니페스트에 훅이 있으면 오류 — 끝내기 전 검사는 프로젝트별 옵트인이다', () => {
    const m = manifests()
    m.claudePlugin.hooks = { Stop: [] }
    m.codexPlugin.hooks = { Stop: [] }
    assert.equal(checkManifests(m).filter((e) => /훅/.test(e)).length, 2)
  })
})

describe('checkRoot', () => {
  it('루트에 플러그인 구성 폴더가 있으면 오류', () => {
    assert.deepEqual(checkRoot({ entries: ['skills', 'scripts', 'docs'] }), [])
    assert.equal(checkRoot({ entries: ['hooks', 'commands', '.mcp.json'] }).length, 3)
  })
})

describe('checkAgentDocs', () => {
  it('AGENTS.md가 있고 CLAUDE.md가 @AGENTS.md를 가져와야 한다', () => {
    assert.deepEqual(checkAgentDocs({ agentsMd: '# 지침', claudeMd: '@AGENTS.md\n\n# 보충' }), [])
    assert.equal(checkAgentDocs({ agentsMd: null, claudeMd: '@AGENTS.md' }).length, 1)
    assert.equal(checkAgentDocs({ agentsMd: '# 지침', claudeMd: '# 보충만' }).length, 1)
  })
})
