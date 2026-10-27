-- Hand-edited: drizzle-kit added the foreign key before the unique key it
-- references, and can't limit ON DELETE SET NULL to one column.
--
-- 1. Indexes for looking up a customer's properties and contacts.
CREATE INDEX "properties_customer_id" ON "properties" USING btree ("customer_id" int8_ops);--> statement-breakpoint
CREATE INDEX "contacts_customer_id" ON "contacts" USING btree ("customer_id" int8_ops);--> statement-breakpoint
-- 2. Billing address: one of the customer's own properties. The composite key
-- makes pointing at another customer's property impossible; deleting the
-- property clears only billing_property_id (Postgres 15+).
ALTER TABLE "properties" ADD CONSTRAINT "properties_id_customer_id_key" UNIQUE("id","customer_id");--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "billing_property_id" bigint;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_billing_property_fkey" FOREIGN KEY ("billing_property_id","id") REFERENCES "public"."properties"("id","customer_id") ON DELETE SET NULL ("billing_property_id") ON UPDATE no action;--> statement-breakpoint
-- 3. Existing customers bill to their property; with several, the first
-- active one.
UPDATE "customers" c SET "billing_property_id" = (
  SELECT p.id FROM properties p
   WHERE p.customer_id = c.id
   ORDER BY p.is_active DESC, p.id
   LIMIT 1
);
