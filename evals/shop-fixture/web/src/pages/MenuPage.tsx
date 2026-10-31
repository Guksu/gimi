import { useEffect, useState } from 'react'
import { api, type Product, type Shipping } from '../api/client'
import { useCart } from '../cart/cart'
import { formatPrice } from '../money/format'

export const MenuPage = () => {
  const cart = useCart()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [shipping, setShipping] = useState<Shipping | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .products()
      .then(({ data }) => {
        if (!alive) return
        setProducts(data.items)
        setShipping(data.shipping)
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  if (error) return <p role="alert">메뉴를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요</p>
  if (!products) return <p>메뉴를 불러오고 있어요</p>
  return (
    <section aria-label="메뉴">
      {/* 첫 화면 가격에 없는 기본 배송비를 알린다 — 주문 금액에 따라 붙어 상품 가격에 넣을 수 없다 */}
      {shipping && <p>{formatPrice(shipping.freeThreshold)} 미만 주문에는 배송비 {formatPrice(shipping.fee)}이 붙어요</p>}
      {products.map((product) => (
        <article key={product.id}>
          <h2>{product.name}</h2>
          <p>{formatPrice(product.price)}</p>
          {!product.returnable && <p>단순 변심으로 반품할 수 없는 상품이에요</p>}
          {/* 품절이면 담는 길을 모두 막는다 — 서버도 재고를 다시 검사한다 */}
          <button type="button" disabled={product.soldOut} onClick={() => cart.add(product.id)}>
            {product.soldOut ? '품절' : '담기'}
          </button>
        </article>
      ))}
    </section>
  )
}
