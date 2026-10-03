\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path TO public;
SELECT pg_advisory_xact_lock(7349012);
DO $maintenance$
DECLARE existing_checksum text;
BEGIN
 IF current_database() <> 'ccs_business' THEN RAISE EXCEPTION 'Wrong database: expected ccs_business'; END IF;
 IF NOT EXISTS (SELECT 1 FROM account_schema_migrations WHERE version='006_inquiries.sql' AND checksum='497908805d6bc9d0d7364b0cd6f20f78e8c6db2e227acd8af17a0a89d6066bdd') THEN RAISE EXCEPTION 'Apply inquiries migration 006 first'; END IF;
 SELECT checksum INTO existing_checksum FROM account_schema_migrations WHERE version='007_maintenance_workflow.sql';
 IF existing_checksum IS NOT NULL THEN
  IF existing_checksum <> '1099999f031a190404cf3966bca84203b38f4e460f7727087da93b96b0f8adfa' THEN RAISE EXCEPTION 'Applied maintenance migration checksum differs'; END IF;
 ELSE
ALTER TABLE service_requests ADD COLUMN maintenance_plan_id uuid REFERENCES maintenance_plans(id);
CREATE UNIQUE INDEX service_requests_one_open_plan_visit ON service_requests(maintenance_plan_id)
 WHERE maintenance_plan_id IS NOT NULL AND status NOT IN ('completed','cancelled');

  INSERT INTO account_schema_migrations(version,checksum) VALUES('007_maintenance_workflow.sql','1099999f031a190404cf3966bca84203b38f4e460f7727087da93b96b0f8adfa');
 END IF;
END
$maintenance$;
COMMIT;
