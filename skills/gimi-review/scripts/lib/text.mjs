/**
 * 요약에 넣는 한 줄 글 — PR·커밋·CI처럼 리뷰하는 PR이 정할 수 있는 글이 요약 줄을 나누거나 글 방향을 바꾸지 못하게 한다.
 * 제어 문자(C0·C1), 줄·문단 구분, 폭 없는 문자, 글 방향을 바꾸는 문자를 빈칸으로 바꾸고, 길면 자른다.
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g

/** 위험한 문자만 빈칸으로 — 앞뒤 빈칸(들여쓰기)은 그대로 둔다. 요약의 모든 줄에 마지막으로 쓴다 @param {unknown} text @returns {string} */
export const safeLine = (text) => String(text ?? '').replace(UNSAFE, ' ')

/** 한 줄로 만들고 앞뒤 빈칸을 없앤 뒤 max 글자로 자른다 @param {unknown} text @param {number} [max] @returns {string} */
export const oneLine = (text, max = 120) => {
  const one = safeLine(text).trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}
