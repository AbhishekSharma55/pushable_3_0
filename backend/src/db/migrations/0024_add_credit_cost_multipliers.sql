CREATE TABLE credit_cost_multipliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    above_dollar NUMERIC(10, 6) NOT NULL,
    multiplier NUMERIC(10, 4) NOT NULL,
    label TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT positive_threshold CHECK (above_dollar >= 0),
    CONSTRAINT positive_multiplier CHECK (multiplier > 0)
);
