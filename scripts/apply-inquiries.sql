\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path TO public;
SELECT pg_advisory_xact_lock(7349012);
DO $inquiries$
DECLARE existing_checksum text;
BEGIN
 IF current_database() <> 'ccs_business' THEN RAISE EXCEPTION 'Wrong database: expected ccs_business'; END IF;
 IF NOT EXISTS (SELECT 1 FROM account_schema_migrations WHERE version='005_operations.sql' AND checksum='5820de6782b8e76e08390da423d772ee3f4042c3e1ed55e51ac38418f4a6f1b9') THEN RAISE EXCEPTION 'Apply and verify migration 005 before inquiries'; END IF;
 SELECT checksum INTO existing_checksum FROM account_schema_migrations WHERE version='006_inquiries.sql';
 IF existing_checksum IS NOT NULL THEN
  IF existing_checksum <> '497908805d6bc9d0d7364b0cd6f20f78e8c6db2e227acd8af17a0a89d6066bdd' THEN RAISE EXCEPTION 'Applied inquiries migration checksum differs'; END IF;
 ELSE
ALTER TABLE customer_accounts ALTER COLUMN email DROP NOT NULL;
CREATE TABLE website_inquiries (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('service','contact','manual')),
 data jsonb NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','archived','converted')),
 internal_notes varchar(3000) NOT NULL DEFAULT '',
 request_id uuid UNIQUE REFERENCES service_requests(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='converted') = (request_id IS NOT NULL))
);
CREATE INDEX website_inquiries_queue ON website_inquiries(status,created_at,id);

  INSERT INTO account_schema_migrations(version,checksum) VALUES('006_inquiries.sql','497908805d6bc9d0d7364b0cd6f20f78e8c6db2e227acd8af17a0a89d6066bdd');
 END IF;
END
$inquiries$;
GRANT SELECT, INSERT, UPDATE ON website_inquiries TO ccs_app;
COMMIT;
