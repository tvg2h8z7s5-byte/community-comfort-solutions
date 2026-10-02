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
