/**
 * 선택 평가의 순수 로직 — 설명문(description)과 요청 문장의 단어 겹침(IDF 가중)으로 순위를 매긴다.
 *
 * LLM을 부르지 않는 대리 지표다. 실제 모델의 선택과 같지는 않지만, "트리거 표현이 설명에 없다"와
 * "두 설명이 구별되지 않는다"는 두 가지 흔한 결함은 확실히 드러낸다.
 * suta(Guksu/suta, MIT)의 scripts/lib/selection.ts를 .mjs로 옮겼다. Node 22.18 미만에서도 돌게 하려고 타입 표기를 JSDoc으로 바꿨다.
 */

// 흔한 조사·어미 — 끝에 붙은 것만 한 번 뗀다(어간이 2글자 이상 남을 때만)
const PARTICLE = /(으로|에서|처럼|까지|부터|이랑|하고|들|을|를|이|가|은|는|로|에|의|도|만|과|와|요)$/

// 요청 문장에 늘 나오는 범용 표현 — 어떤 스킬을 고를지에 정보가 없으므로 점수에서 뺀다.
// (이게 없으면 description에 "만들어줘"를 넣은 스킬이 모든 "…만들어줘" 요청에서 공짜 점수를 얻는다)
/** @type {ReadonlySet<string>} */
export const DEFAULT_STOPWORDS = new Set([
  '만들어줘', '만들어', '만들기', '만들고', '넣어줘', '넣어', '해줘', '해주세요', '주세요', '해', '추가해줘', '구현', '구현해줘',
  '적용', '적용해줘', '싶어', '싶어요', '싶은데', '좀', '요청', '사용', '기능', '컴포넌트', '해서', '하게', '되게', '있게', '수', '것',
  'ui', 'component', 'add', 'make', 'create', 'implement', 'please', 'the', 'a', 'an', 'to', 'for', 'with',
])

// 트리거 평가용 — 스킬끼리 가르는 데 정보가 없는 말을 더 뺀다. "UI·컴포넌트"는 UI 스킬(suta 등)과 가르는 핵심 단어라 남긴다
const TRIGGER_KEEP = ['ui', 'component', '컴포넌트']
const TRIGGER_EXTRA = ['이거', '이', '그거', '부탁해', '부탁', 'this', 'my', 'me', 'it', 'is', 'of', 'in', 'on', 'and', 'i']
/** @type {ReadonlySet<string>} */
export const TRIGGER_STOPWORDS = new Set([...[...DEFAULT_STOPWORDS].filter((word) => !TRIGGER_KEEP.includes(word)), ...TRIGGER_EXTRA])

/**
 * 특징 추출 — 공백 단위 토큰(가중 3) + 한글 음절 2-gram(가중 1).
 * 한글은 조사가 붙어 "웹훅을"과 "웹훅"이 다른 토큰이 되므로 2-gram으로 부분 일치를 잡는다.
 * 영어는 소문자 + 끝의 s 제거로 단·복수를 합친다.
 * @param {{ text: string, stopwords?: ReadonlySet<string> }} args
 * @returns {Map<string, number>}
 */
export const features = ({ text, stopwords = DEFAULT_STOPWORDS }) => {
  const out = new Map()
  const add = (key, weight) => out.set(key, Math.max(out.get(key) ?? 0, weight))
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((token) => !stopwords.has(token) && !stopwords.has(token.replace(PARTICLE, '')))
  for (const token of tokens) {
    const norm = /^[a-z]+s$/.test(token) && token.length > 3 ? token.slice(0, -1) : token
    add(`w:${norm}`, 3)
    if (/[ㄱ-힝]/.test(token) && token.length >= 2) {
      // 조사를 뗀 어간도 정확 토큰으로 넣는다 — "웹훅을"이 "웹훅"과 같은 단어로 잡히게
      const stem = token.replace(PARTICLE, '')
      if (stem !== token && stem.length >= 2) add(`w:${stem}`, 3)
      for (let i = 0; i < token.length - 1; i += 1) add(`b:${token.slice(i, i + 2)}`, 1)
    }
  }
  return out
}

/**
 * 설명 집합마다 랭커를 만든다 — IDF는 비교하는 설명 집합마다 다르다(모든 설명에 나오는 특징은 가중 0).
 * @param {{ docs: { name: string, description: string }[], stopwords?: ReadonlySet<string> }} args
 * @returns {(query: string) => { name: string, score: number }[]}
 */
export const createRanker = ({ docs, stopwords = DEFAULT_STOPWORDS }) => {
  const docFeatures = docs.map((doc) => features({ text: doc.description, stopwords }))
  const df = new Map()
  for (const extracted of docFeatures) for (const key of extracted.keys()) df.set(key, (df.get(key) ?? 0) + 1)
  const idf = (key) => Math.log((docs.length + 1) / ((df.get(key) ?? 0) + 1))

  return (query) => {
    const queryFeatures = features({ text: query, stopwords })
    return docs
      .map((doc, index) => {
        let score = 0
        for (const [key, weight] of queryFeatures) if (docFeatures[index].has(key)) score += weight * idf(key)
        return { name: doc.name, score }
      })
      .sort((a, b) => b.score - a.score)
  }
}
