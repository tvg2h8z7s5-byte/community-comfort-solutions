ALTER TABLE service_requests ADD COLUMN maintenance_plan_id uuid REFERENCES maintenance_plans(id);
CREATE UNIQUE INDEX service_requests_one_open_plan_visit ON service_requests(maintenance_plan_id)
 WHERE maintenance_plan_id IS NOT NULL AND status NOT IN ('completed','cancelled');
