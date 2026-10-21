import { CartProvider, useCart } from './cart/cart'
import { LegalFooter } from './components/LegalFooter'
import { Link, useLocation } from './navigation'
import { CartPage } from './pages/CartPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { MenuPage } from './pages/MenuPage'
import { OrderPage } from './pages/OrderPage'
import { PaymentFailPage, PaymentSuccessPage } from './pages/PaymentPages'

const Header = () => {
  const cart = useCart()
  const count = cart.items.reduce((sum, item) => sum + item.quantity, 0)
  return (
    <header>
      <nav>
        <Link to="/">메뉴</Link> <Link to="/cart">{`장바구니 ${count}`}</Link>
      </nav>
    </header>
  )
}

const Routes = () => {
  const { pathname, search } = useLocation()
  const order = pathname.match(/^\/orders\/(\d+)$/)
  if (pathname === '/cart') return <CartPage />
  if (pathname === '/checkout') return <CheckoutPage />
  if (pathname === '/payments/success') return <PaymentSuccessPage search={search} />
  if (pathname === '/payments/fail') return <PaymentFailPage search={search} />
  if (order) return <OrderPage key={order[1]} id={Number(order[1])} />
  return <MenuPage />
}

export const App = () => (
  <CartProvider>
    <Header />
    <main>
      <Routes />
    </main>
    <LegalFooter />
  </CartProvider>
)
