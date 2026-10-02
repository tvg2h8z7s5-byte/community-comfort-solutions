CREATE TABLE billing_pricebook (
 id uuid PRIMARY KEY, name varchar(150) NOT NULL, category text NOT NULL CHECK(category IN ('Heating','Cooling','Maintenance','Diagnosis','Parts','Other')),
 description varchar(1000) NOT NULL DEFAULT '', unit varchar(30) NOT NULL DEFAULT 'each',
 unit_cents integer NOT NULL CHECK(unit_cents BETWEEN 0 AND 100000000), taxable boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_pricebook(id,name,category,description,unit,unit_cents)
 VALUES('10900000-0000-4000-8000-000000000001','Standard heating tune-up','Maintenance','Electrical checks, filter inspection, heating element cleaning, and an overall system health report.','system',10900);
CREATE TABLE billing_settings (
 id integer PRIMARY KEY CHECK(id=1), company varchar(150) NOT NULL, phone varchar(40) NOT NULL,
 email varchar(254) NOT NULL, address varchar(500) NOT NULL DEFAULT '', website varchar(200) NOT NULL,
 terms varchar(2000) NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_settings(id,company,phone,email,website)
 VALUES(1,'Community Comfort Solutions','917-608-3201','contact@communitycomfortsolutions.org','communitycomfortsolutions.org');
CREATE TABLE billing_counters(kind text PRIMARY KEY CHECK(kind IN ('estimate','invoice')), value integer NOT NULL CHECK(value>0));
CREATE TABLE billing_documents (
 id uuid PRIMARY KEY, number varchar(30) NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('estimate','invoice')),
 account_id uuid REFERENCES customer_accounts(id), request_id uuid REFERENCES service_requests(id),
 source_estimate_id uuid UNIQUE REFERENCES billing_documents(id),
 customer jsonb NOT NULL, business jsonb NOT NULL, items jsonb NOT NULL,
 subtotal_cents integer NOT NULL CHECK(subtotal_cents BETWEEN 0 AND 100000000), discount_cents integer NOT NULL CHECK(discount_cents BETWEEN 0 AND subtotal_cents),
 tax_bps integer NOT NULL CHECK(tax_bps BETWEEN 0 AND 2000), tax_cents integer NOT NULL CHECK(tax_cents>=0),
 total_cents integer NOT NULL CHECK(total_cents BETWEEN 0 AND 100000000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','accepted','declined','void')),
 due_on date, notes varchar(3000) NOT NULL DEFAULT '', technician varchar(100) NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1, creation_hash char(64) NOT NULL, created_by uuid NOT NULL REFERENCES customer_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), issued_at timestamptz,
 CHECK(kind='estimate' OR status NOT IN ('accepted','declined')),
 CHECK(total_cents=subtotal_cents-discount_cents+tax_cents)
);
CREATE INDEX billing_documents_owner ON billing_documents(account_id,created_at DESC);
CREATE INDEX billing_documents_kind ON billing_documents(kind,created_at DESC);
CREATE TABLE billing_payments (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES billing_documents(id),
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
 method text NOT NULL CHECK(method IN ('cash','check','card','bank','other')),
 paid_on date NOT NULL, reference varchar(200) NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES customer_accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz, void_reason varchar(500) NOT NULL DEFAULT '', voided_by uuid REFERENCES customer_accounts(id)
);
CREATE INDEX billing_payments_document ON billing_payments(document_id);
