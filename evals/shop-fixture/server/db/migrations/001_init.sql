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

-- 가입으로 만든 사용자 번호 — 시드(1·2)와 겹치지 않게 1000부터
CREATE SEQUENCE users_id_seq START 1000;

-- 회원 가입 정보. 선택 동의는 동의한 때를 남긴다(광고 발송이 2년마다 다시 확인한다). 주민등록번호는 받지 않는다
CREATE TABLE members (
  user_id bigint PRIMARY KEY REFERENCES users (id),
  birth_date date NOT NULL,
  joined_at timestamptz NOT NULL,
  -- 만 14세 미만이면 법정대리인이 동의한 때
  guardian_consented_at timestamptz,
  -- 광고 수신 동의(선택)
  marketing_at timestamptz,
  -- 야간(21시~다음 날 8시) 광고 수신 별도 동의(선택)
  night_marketing_at timestamptz
);

-- 탈퇴 — 회원 정보는 바로 지우고, 거래기록(계약·결제·공급)은 retain_until까지 보존한 뒤 파기한다
CREATE TABLE withdrawals (
  user_id bigint PRIMARY KEY REFERENCES users (id),
  withdrawn_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  purged_at timestamptz
);

-- 고객에게 보낸 알림(문자·푸시)
CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  order_id bigint REFERENCES orders (id),
  kind text NOT NULL,
  message text NOT NULL,
  sent_at timestamptz NOT NULL
);

-- 가상계좌 결제를 입금 뒤 환불할 계좌. 계좌번호는 암호화해 저장한다
CREATE TABLE refund_accounts (
  order_id bigint PRIMARY KEY REFERENCES orders (id),
  bank text NOT NULL,
  account_number_enc text NOT NULL,
  holder text NOT NULL,
  created_at timestamptz NOT NULL
);

-- 멤버십 요금 — 한 줄뿐이다
CREATE TABLE membership_plan (
  id integer PRIMARY KEY CHECK (id = 1),
  price integer NOT NULL CHECK (price > 0)
);

-- 예제라 PG 정기결제(빌링키) 대신 청구 기록(membership_charges)만 남긴다
CREATE TABLE memberships (
  user_id bigint PRIMARY KEY REFERENCES users (id),
  -- 지금 청구하는 금액 — 요금이 올라도 회원이 새 금액에 동의하기 전까지는 그대로다
  price integer NOT NULL CHECK (price > 0),
  next_billing_at timestamptz NOT NULL,
  joined_at timestamptz NOT NULL
);

-- 오른 요금에 대한 별도 동의 — 청구일 전 30일 안에 받은 것만 쓴다
CREATE TABLE membership_price_consents (
  user_id bigint NOT NULL REFERENCES users (id),
  price integer NOT NULL,
  -- 동의할 때 내던 금액
  from_price integer NOT NULL,
  consented_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, price)
);

CREATE TABLE membership_charges (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  amount integer NOT NULL CHECK (amount > 0),
  charged_at timestamptz NOT NULL
);
