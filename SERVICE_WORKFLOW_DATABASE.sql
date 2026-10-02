-- Run as the database administrator / migration role, before the new backend starts.
BEGIN;
SELECT pg_advisory_xact_lock(7349012);
DO $workflow$
DECLARE existing_checksum text;
BEGIN
 IF current_database() <> 'ccs_business' THEN
  RAISE EXCEPTION 'Select ccs_business before applying this update';
 END IF;
 SELECT checksum INTO existing_checksum FROM account_schema_migrations WHERE version='003_service_workflow.sql';
 IF existing_checksum IS NOT NULL THEN
  IF existing_checksum <> '4e712784f61141e9dcebf71d0278cae51fdfa03838d36bae24ede6c51775a44c' THEN RAISE EXCEPTION 'Applied migration checksum differs'; END IF;
 ELSE
ALTER TABLE service_requests
 ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
 ADD COLUMN appointment_at timestamptz,
 ADD COLUMN follow_up_on date;
CREATE TABLE service_request_emails (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES service_requests(id),
 recipient text NOT NULL,
 payload jsonb NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_request_emails_pending ON service_request_emails(next_attempt_at) WHERE sent_at IS NULL;

  INSERT INTO account_schema_migrations(version,checksum) VALUES('003_service_workflow.sql','4e712784f61141e9dcebf71d0278cae51fdfa03838d36bae24ede6c51775a44c');
 END IF;
END;
$workflow$;
GRANT SELECT, INSERT, UPDATE ON service_request_emails TO ccs_app;
COMMIT;
