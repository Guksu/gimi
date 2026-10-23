/**
 * 트리거 평가의 순수 로직 — 스킬 하나의 평가 파일(should·shouldNot)을 설명 집합(두 gimi 스킬 + 함께 깔릴 법한 스킬)에 대어 본다.
 *
 * 에이전트는 시작할 때 설치된 스킬의 description만 보고 어떤 스킬을 읽을지 고른다.
 * 그래서 should 요청에는 대상 스킬이 혼자 1위여야 하고, shouldNot 요청(다른 스킬의 일)에는 1위가 아니어야 한다.
 * 파일 읽기와 종료 코드는 scripts/evalSelection.mjs가 맡는다.
 */
import { TRIGGER_STOPWORDS, createRanker } from './selection.mjs'

const MIN_SHOULD = 8
const MIN_SHOULD_NOT = 6

/** @param {{ name: string, score: number }[]} ranked */
const tiedTopOf = (ranked) => ranked.filter((r) => r.score === ranked[0].score).map((r) => r.name)

/** @param {{ name: string, score: number }[]} ranked */
export const top3 = (ranked) => ranked.slice(0, 3).map((r) => `${r.name}:${r.score.toFixed(1)}`).join(', ')

/**
 * contested — 요청의 단어가 대상과 경쟁 스킬(예: 내장 /code-review)의 설명에 똑같이 들어 있어 단어 겹침으로는 동점을 깰 수 없는 질의.
 * 질의를 바꿔 동점을 숨기지 않고, 대상이 1위 동점 안에 있으면 통과·지면 실패로 보며 동점은 경고로 남긴다.
 * @param {{ target: string, docs: { name: string, description: string }[], should: string[], shouldNot: string[], contested?: string[], stopwords?: ReadonlySet<string> }} args
 */
export const evaluateTrigger = ({ target, docs, should, shouldNot, contested = [], stopwords = TRIGGER_STOPWORDS }) => {
  const rank = createRanker({ docs, stopwords })
  const failures = []
  const warnings = []
  const margins = []
  const lines = []
  let passed = 0

  for (const query of should) {
    const ranked = rank(query)
    const mine = ranked.find((r) => r.name === target)
    const tiedTop = tiedTopOf(ranked)
    lines.push(`should "${query}" → ${top3(ranked)}`)
    if (mine && mine.score > 0 && tiedTop.length === 1 && tiedTop[0] === target) {
      passed += 1
      const second = ranked.find((r) => r.name !== target)
      margins.push({ query, margin: mine.score - (second?.score ?? 0), second: second?.name })
    } else {
      failures.push({ kind: 'should', query, detail: `1위 ${tiedTop.join('/')} (${ranked[0].score.toFixed(1)}), ${target} ${(mine?.score ?? 0).toFixed(1)}` })
    }
  }

  // 다른 스킬의 요청 — 대상이 0점이거나 1위가 아니면 통과. 모두 0점인 동점은 아무 스킬도 걸리지 않은 것이라 통과다
  for (const query of shouldNot) {
    const ranked = rank(query)
    const mine = ranked.find((r) => r.name === target)
    lines.push(`shouldNot "${query}" → ${top3(ranked)}`)
    if (!mine || mine.score === 0 || !tiedTopOf(ranked).includes(target)) passed += 1
    else failures.push({ kind: 'shouldNot', query, detail: `${target}이(가) 1위 (${mine.score.toFixed(1)})` })
  }

  for (const query of contested) {
    const ranked = rank(query)
    const mine = ranked.find((r) => r.name === target)
    const tiedTop = tiedTopOf(ranked)
    lines.push(`contested "${query}" → ${top3(ranked)}`)
    if (mine && mine.score > 0 && tiedTop.includes(target)) {
      passed += 1
      const rivals = tiedTop.filter((name) => name !== target)
      if (rivals.length > 0) warnings.push(`${target} contested "${query}" → ${rivals.join('/')}와(과) 동점 (${mine.score.toFixed(1)})`)
    } else {
      failures.push({ kind: 'contested', query, detail: `1위 ${tiedTop.join('/')} (${ranked[0].score.toFixed(1)}), ${target} ${(mine?.score ?? 0).toFixed(1)}` })
    }
  }

  return { total: should.length + shouldNot.length + contested.length, passed, failures, warnings, margins, lines }
}

/**
 * 평가 파일의 모양을 검사한다 — 질의가 너무 적으면 통과해도 믿을 수 없고, 같은 질의가 양쪽에 있으면 모순이다.
 * 패턴 선택 평가도 같은 검사를 쓴다(이름은 spec.pattern, 질의 수 하한은 3개씩).
 * @param {{ spec: { skill?: string, pattern?: string, should?: string[], shouldNot?: string[] }, minShould?: number, minShouldNot?: number }} args
 * @returns {string[]}
 */
export const validateSpec = ({ spec, minShould = MIN_SHOULD, minShouldNot = MIN_SHOULD_NOT }) => {
  const errors = []
  const name = spec.skill ?? spec.pattern ?? '(skill 없음)'
  const should = Array.isArray(spec.should) ? spec.should : []
  const shouldNot = Array.isArray(spec.shouldNot) ? spec.shouldNot : []
  if (should.length < minShould) errors.push(`${name}: should 질의 ${minShould}개 이상 필요 — 지금 ${should.length}개`)
  if (shouldNot.length < minShouldNot) errors.push(`${name}: shouldNot 질의 ${minShouldNot}개 이상 필요 — 지금 ${shouldNot.length}개`)
  const contested = Array.isArray(spec.contested) ? spec.contested : []
  for (const query of should) if (shouldNot.includes(query)) errors.push(`${name}: "${query}"가 should와 shouldNot에 모두 있음`)
  for (const query of contested) if (should.includes(query) || shouldNot.includes(query)) errors.push(`${name}: contested "${query}"가 should·shouldNot에도 있음`)
  return errors
}
