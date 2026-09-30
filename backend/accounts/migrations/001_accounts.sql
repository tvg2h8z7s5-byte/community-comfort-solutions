CREATE TABLE customer_accounts (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  verified_at timestamptz,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended')),
  name varchar(100) NOT NULL DEFAULT '',
  phone varchar(40) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_tokens (
  issued_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  token_hash char(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES customer_accounts(id),
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_owner ON account_tokens(account_id, purpose);
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
CREATE TABLE account_sessions (
  session_hash char(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES customer_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_sessions_owner ON account_sessions(account_id);
CREATE INDEX account_sessions_expiry ON account_sessions(expires_at);
CREATE TABLE customer_addresses (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES customer_accounts(id),
  label varchar(60) NOT NULL DEFAULT '',
  line1 varchar(200) NOT NULL,
  line2 varchar(200) NOT NULL DEFAULT '',
  city varchar(100) NOT NULL,
  region varchar(100) NOT NULL,
  postal_code varchar(20) NOT NULL,
  country char(2) NOT NULL DEFAULT 'US' CHECK (country ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_owner ON customer_addresses(account_id);
CREATE TABLE account_rate_limits (
  key_hash char(64) PRIMARY KEY,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_rate_limits_expiry ON account_rate_limits(expires_at);
