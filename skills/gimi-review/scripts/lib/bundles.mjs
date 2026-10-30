/**
 * 맥락 묶음 정리(설계 결정 54) — 같은 PR·브랜치를 다시 모으면 예전 묶음을 지운다.
 * 묶음 이름은 `{날짜}-{PR·브랜치}.context.json`이다. 이름이 정확히 같은 것만 고른다(pr-4와 pr-42, pr과 feature-pr을 섞지 않는다).
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {{ files: string[], name: string, keep: string }} args 묶음 폴더의 파일 이름들, PR·브랜치 이름, 새로 쓴 파일 이름
 * @returns {string[]} 지울 파일 이름
 */
export const staleBundles = ({ files, name, keep }) => {
  const same = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escape(name)}\\.context\\.json$`)
  return files.filter((file) => file !== keep && same.test(file)).sort()
}
