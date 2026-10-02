\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path TO public;
SELECT pg_advisory_xact_lock(7349012);
DO $operations$
DECLARE existing_checksum text;
BEGIN
 IF current_database() <> 'ccs_business' THEN RAISE EXCEPTION 'Wrong database: expected ccs_business'; END IF;
 IF NOT EXISTS (SELECT 1 FROM account_schema_migrations WHERE version='004_billing.sql' AND checksum='3428c332f4aa0165cc09480a4b04046f92337907a225f177eed327bc8c442a11') THEN
  RAISE EXCEPTION 'Apply and verify migration 004 before operations';
 END IF;
 SELECT checksum INTO existing_checksum FROM account_schema_migrations WHERE version='005_operations.sql';
 IF existing_checksum IS NOT NULL THEN
  IF existing_checksum <> '5820de6782b8e76e08390da423d772ee3f4042c3e1ed55e51ac38418f4a6f1b9' THEN RAISE EXCEPTION 'Applied operations migration checksum differs'; END IF;
 ELSE
ALTER TABLE billing_documents ADD COLUMN archived_at timestamptz,
 ADD COLUMN duplicated_from_id uuid REFERENCES billing_documents(id);
CREATE TABLE equipment_service_history (
 id uuid PRIMARY KEY, equipment_id uuid NOT NULL REFERENCES customer_equipment(id),
 account_id uuid NOT NULL REFERENCES customer_accounts(id), request_id uuid REFERENCES service_requests(id),
 document_id uuid REFERENCES billing_documents(id), serviced_on date NOT NULL, service varchar(150) NOT NULL,
 findings varchar(3000) NOT NULL DEFAULT '', work_performed varchar(3000) NOT NULL DEFAULT '', recommendations varchar(2000) NOT NULL DEFAULT '',
 internal_notes varchar(3000) NOT NULL DEFAULT '', technician varchar(100) NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1, creation_hash char(64) NOT NULL, archived_at timestamptz,
 created_by uuid NOT NULL REFERENCES customer_accounts(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_history_owner ON equipment_service_history(account_id,serviced_on DESC);
CREATE INDEX equipment_history_equipment ON equipment_service_history(equipment_id,serviced_on DESC);
CREATE TABLE maintenance_plans (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES customer_accounts(id), equipment_id uuid NOT NULL REFERENCES customer_equipment(id),
 name varchar(150) NOT NULL, annual_cents integer NOT NULL CHECK(annual_cents BETWEEN 0 AND 100000000),
 status text NOT NULL CHECK(status IN ('active','paused','cancelled')) DEFAULT 'active',
 next_service_on date, renew_on date, reminder_days integer NOT NULL DEFAULT 14 CHECK(reminder_days BETWEEN 0 AND 60),
 email_reminders boolean NOT NULL DEFAULT false, notes varchar(2000) NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1, creation_hash char(64) NOT NULL, created_by uuid NOT NULL REFERENCES customer_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX maintenance_plans_one_active ON maintenance_plans(equipment_id) WHERE status='active';
CREATE INDEX maintenance_plans_due ON maintenance_plans(status,next_service_on,renew_on);
CREATE TABLE operations_emails (
 id uuid PRIMARY KEY, document_id uuid REFERENCES billing_documents(id), plan_id uuid REFERENCES maintenance_plans(id),
 category text NOT NULL CHECK(category IN ('document','service','renewal')),
 dedupe_key text NOT NULL UNIQUE, recipient text NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sent','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_emails_pending ON operations_emails(next_attempt_at) WHERE state='queued';

  INSERT INTO account_schema_migrations(version,checksum) VALUES('005_operations.sql','5820de6782b8e76e08390da423d772ee3f4042c3e1ed55e51ac38418f4a6f1b9');
 END IF;
END $operations$;
GRANT SELECT, INSERT, UPDATE ON equipment_service_history,maintenance_plans,operations_emails TO ccs_app;
GRANT DELETE ON billing_documents TO ccs_app;
COMMIT;
