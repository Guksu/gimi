-- 시험·개발용 데이터. 테스트는 매번 표를 비우고 이것을 다시 넣는다
INSERT INTO users (id, name, points) VALUES
  (1, '국수 손님', 5000),
  (2, '다른 손님', 0);

INSERT INTO products (id, name, price, stock, returnable, max_per_order) VALUES
  (1, '잔치국수', 6000, 20, true, 10),
  (2, '비빔국수', 7000, 5, true, 10),
  (3, '칼국수', 8000, 0, true, 10),
  (4, '직접 담근 김치 1kg', 12000, 10, false, 3),
  (5, '멸치 육수 팩', 3000, 1, true, 10);

INSERT INTO coupons (code, kind, value, min_order, starts_at, ends_at, max_uses, used_count) VALUES
  ('WELCOME3000', 'fixed', 3000, 10000, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 1000, 0),
  ('NOODLE10', 'rate', 10, 0, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 1000, 0),
  ('LAST1', 'fixed', 1000, 0, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 1, 0),
  ('BIG50000', 'fixed', 50000, 0, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 1000, 0),
  -- 2026-10-31 자정(한국 시간)까지 — UTC로는 2026-10-31T15:00:00Z 전까지
  ('HALLOWEEN', 'fixed', 2000, 0, '2026-10-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00', 1000, 0);
