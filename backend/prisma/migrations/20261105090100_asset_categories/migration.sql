-- Default asset categories (Admin can edit them). Accessories need not be returned on exit;
-- "Access & accounts" items (email, software, system access) are revoked instead of returned.
INSERT INTO "AssetCategory" ("name", "kind", "mustReturnOnExit", "sortOrder") VALUES
  ('Laptop', 'PHYSICAL', true, 1),
  ('Desktop', 'PHYSICAL', true, 2),
  ('Monitor', 'PHYSICAL', true, 3),
  ('Mobile phone', 'PHYSICAL', true, 4),
  ('SIM', 'PHYSICAL', true, 5),
  ('Access card', 'PHYSICAL', true, 6),
  ('Accessories', 'PHYSICAL', false, 7),
  ('Vehicle', 'PHYSICAL', true, 8),
  ('Furniture', 'PHYSICAL', true, 9),
  ('Other', 'PHYSICAL', true, 10),
  ('Access & accounts', 'ACCESS', true, 11);
