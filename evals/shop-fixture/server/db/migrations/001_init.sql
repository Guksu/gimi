-- 국수집 주문 앱 스키마. 금액은 모두 원 단위 정수다
CREATE TABLE users (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0)
);

CREATE TABLE products (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  stock integer NOT NULL CHECK (stock >= 0),
  -- false면 상품 화면에 "단순 변심으로는 반품할 수 없다"를 표시한 상품이다
  returnable boolean NOT NULL DEFAULT true,
  max_per_order integer NOT NULL DEFAULT 10 CHECK (max_per_order > 0)
);

CREATE TABLE coupons (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('fixed', 'rate')),
  value integer NOT NULL CHECK (value > 0),
  min_order integer NOT NULL DEFAULT 0,
  -- 쓸 수 있는 기간 [starts_at, ends_at)
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  CHECK (used_count <= max_uses)
);

CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  idempotency_key text NOT NULL,
  status text NOT NULL,
  method text NOT NULL CHECK (method IN ('card', 'transfer', 'virtual_account')),
  subtotal integer NOT NULL CHECK (subtotal >= 0),
  coupon_code text REFERENCES coupons (code),
  coupon_discount integer NOT NULL DEFAULT 0 CHECK (coupon_discount >= 0),
  points_used integer NOT NULL DEFAULT 0 CHECK (points_used >= 0),
  shipping_fee integer NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  total integer NOT NULL CHECK (total >= 0),
  points_earned integer NOT NULL DEFAULT 0 CHECK (points_earned >= 0),
  refunded_amount integer NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  delivered_at timestamptz,
  CHECK (refunded_amount <= total),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE order_items (
  order_id bigint NOT NULL REFERENCES orders (id),
  product_id bigint NOT NULL REFERENCES products (id),
  name text NOT NULL,
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  returnable boolean NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- 쿠폰은 사람마다 한 번
CREATE TABLE coupon_uses (
  coupon_code text NOT NULL REFERENCES coupons (code),
  user_id bigint NOT NULL REFERENCES users (id),
  order_id bigint NOT NULL REFERENCES orders (id),
  PRIMARY KEY (coupon_code, user_id)
);

CREATE TABLE payments (
  payment_key text PRIMARY KEY,
  order_id bigint NOT NULL UNIQUE REFERENCES orders (id),
  method text NOT NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  pg_status text NOT NULL,
  approved_at timestamptz
);

CREATE TABLE webhook_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  handled text NOT NULL
);

CREATE TABLE returns (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders (id),
  reason text NOT NULL CHECK (reason IN ('change_of_mind', 'defective')),
  requested_at timestamptz NOT NULL
);
