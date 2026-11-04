-- Travel settlement categories (HR / Finance can edit them). Meals are not claimable while a daily allowance rate is set.
INSERT INTO "ExpenseCategory" ("name", "scope", "coveredByPerDiem", "sortOrder") VALUES
  ('Fare (self-arranged ticket)', 'TRAVEL', false, 101),
  ('Local transport at destination', 'TRAVEL', false, 102),
  ('Meals while travelling', 'TRAVEL', true, 103),
  ('Other travel cost', 'TRAVEL', false, 104);
