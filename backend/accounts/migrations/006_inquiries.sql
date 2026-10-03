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
