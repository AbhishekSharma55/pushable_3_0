CREATE TABLE credit_cost_ranges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    min_dollar NUMERIC(10, 6) NOT NULL,
    max_dollar NUMERIC(10, 6) NOT NULL,
    credit_amount NUMERIC(8, 4) NOT NULL,
    label TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_range CHECK (max_dollar > min_dollar),
    CONSTRAINT positive_credits CHECK (credit_amount >= 0)
);
