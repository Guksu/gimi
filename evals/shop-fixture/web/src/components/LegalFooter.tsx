/**
 * 법정 표시 사항 — 모든 화면 아래에 같은 컴포넌트로 보인다. 예제 가게라 값은 모두 지어낸 것이다
 */
const BUSINESS = {
  name: 'gimi 국수집(예제 가게)',
  owner: '김예제',
  registrationNumber: '000-00-00000',
  mailOrderNumber: '제2026-예제-0000호',
  address: '서울특별시 예제구 예제로 1',
  phone: '0000-0000',
  email: 'help@example.com',
  hosting: '예제 호스팅',
}
// 공정거래위원회 사업자정보 공개 페이지 — 사업자등록번호로 연다
const DISCLOSURE_URL = `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${BUSINESS.registrationNumber.replace(/-/g, '')}`

export const LegalFooter = () => (
  <footer>
    <p>
      상호 {BUSINESS.name} · 대표 {BUSINESS.owner} · 사업자등록번호 {BUSINESS.registrationNumber} · <a href={DISCLOSURE_URL}>사업자정보 확인</a>
    </p>
    <p>
      통신판매업 신고번호 {BUSINESS.mailOrderNumber} · 주소 {BUSINESS.address} · 고객센터 {BUSINESS.phone} · {BUSINESS.email}
    </p>
    <p>호스팅 서비스 제공자 {BUSINESS.hosting}</p>
    <p>미성년자가 법정대리인의 동의 없이 한 주문은 본인이나 법정대리인이 취소할 수 있어요.</p>
  </footer>
)
