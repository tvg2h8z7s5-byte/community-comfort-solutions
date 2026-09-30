ALTER TABLE customer_accounts ADD COLUMN role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin','contractor'));
CREATE INDEX customer_accounts_role ON customer_accounts(role);
CREATE TABLE customer_equipment (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES customer_accounts(id),
 address_id uuid NOT NULL REFERENCES customer_addresses(id),
 name varchar(100) NOT NULL,
 type text NOT NULL CHECK (type IN ('Air conditioner','Furnace','Heat pump','Boiler','Other')),
 manufacturer varchar(100) NOT NULL DEFAULT '',
 model varchar(100) NOT NULL DEFAULT '',
 serial_number varchar(100) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_equipment_owner ON customer_equipment(account_id);
CREATE TABLE service_requests (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES customer_accounts(id),
 address_id uuid NOT NULL REFERENCES customer_addresses(id),
 service text NOT NULL CHECK (service IN ('Heating repair','Cooling repair','Diagnosis','Seasonal tune-up')),
 description varchar(3000) NOT NULL,
 preferred_day date,
 status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','reviewing','scheduled','completed','cancelled')),
 customer_update varchar(1500) NOT NULL DEFAULT '',
 internal_notes varchar(3000) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_requests_owner ON service_requests(account_id,created_at DESC);
CREATE INDEX service_requests_status ON service_requests(status,created_at DESC);
