import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

export interface CartItem {
  productId: number
  quantity: number
}

interface CartState {
  items: CartItem[]
  couponCode: string | null
  points: number
  add: (productId: number) => void
  setQuantity: (productId: number, quantity: number) => void
  remove: (productId: number) => void
  setCoupon: (code: string | null) => void
  setPoints: (points: number) => void
  clear: () => void
}

const KEY = 'shop:cart'
const CartContext = createContext<CartState | null>(null)

// 브라우저 저장소는 막혀 있을 수 있다 — 그러면 빈 장바구니로 시작한다
const load = (): CartItem[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as CartItem[]) : []
  } catch {
    return []
  }
}

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>(load)
  const [couponCode, setCoupon] = useState<string | null>(null)
  const [points, setPoints] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items))
    } catch {
      // 저장하지 못해도 이번 화면에서는 장바구니를 쓴다
    }
  }, [items])

  const value: CartState = {
    items,
    couponCode,
    points,
    add: (productId) =>
      setItems((prev) => (prev.some((i) => i.productId === productId) ? prev.map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i)) : [...prev, { productId, quantity: 1 }])),
    setQuantity: (productId, quantity) => setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, quantity } : i))),
    remove: (productId) => setItems((prev) => prev.filter((i) => i.productId !== productId)),
    setCoupon,
    setPoints,
    clear: () => {
      setItems([])
      setCoupon(null)
      setPoints(0)
    },
  }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export const useCart = () => {
  const cart = useContext(CartContext)
  if (!cart) throw new Error('CartProvider 안에서 쓴다')
  return cart
}
