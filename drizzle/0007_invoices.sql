CREATE TABLE "invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"number" text,
	"status" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"customer_id" bigint,
	"property_id" bigint,
	"customer_name" text,
	"customer_email" text,
	"customer_address" jsonb,
	"description" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"total_cents" integer NOT NULL,
	"amount_due_cents" integer NOT NULL,
	"amount_paid_cents" integer NOT NULL,
	"amount_remaining_cents" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"paid_via" text,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_stripe_invoice_id_key" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "invoices_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text, 'uncollectible'::text])),
	CONSTRAINT "invoices_paid_via_check" CHECK (paid_via = ANY (ARRAY['stripe'::text, 'outside_stripe'::text, 'cash'::text, 'check'::text, 'other'::text]))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_customer_created" ON "invoices" USING btree ("customer_id" int8_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "invoices_status_created" ON "invoices" USING btree ("status" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "invoices_stripe_customer" ON "invoices" USING btree ("stripe_customer_id" text_ops);