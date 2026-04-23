-- Convert credit columns from integer to numeric for fractional credit support
ALTER TABLE credits ALTER COLUMN balance TYPE NUMERIC(12, 4) USING balance::NUMERIC(12, 4);
ALTER TABLE credits ALTER COLUMN plan_credits TYPE NUMERIC(12, 4) USING plan_credits::NUMERIC(12, 4);
ALTER TABLE credits ALTER COLUMN topup_credits TYPE NUMERIC(12, 4) USING topup_credits::NUMERIC(12, 4);
ALTER TABLE credits ALTER COLUMN total_credits_consumed TYPE NUMERIC(12, 4) USING total_credits_consumed::NUMERIC(12, 4);
ALTER TABLE credits ALTER COLUMN overage_limit TYPE NUMERIC(12, 4) USING overage_limit::NUMERIC(12, 4);

ALTER TABLE credit_ledger ALTER COLUMN amount TYPE NUMERIC(12, 4) USING amount::NUMERIC(12, 4);
ALTER TABLE credit_ledger ALTER COLUMN credits_after TYPE NUMERIC(12, 4) USING credits_after::NUMERIC(12, 4);

ALTER TABLE credit_logs ALTER COLUMN credits_deducted TYPE NUMERIC(12, 4) USING credits_deducted::NUMERIC(12, 4);

ALTER TABLE user_credit_limits ALTER COLUMN credit_limit TYPE NUMERIC(12, 4) USING credit_limit::NUMERIC(12, 4);
ALTER TABLE user_credit_limits ALTER COLUMN credits_used TYPE NUMERIC(12, 4) USING credits_used::NUMERIC(12, 4);
