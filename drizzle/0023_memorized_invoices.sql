CREATE TABLE "memorized_invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"property_id" bigint,
	"interval_days" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"paused_until" date,
	"source" text NOT NULL,
	"source_quote_id" bigint,
	"source_invoice_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "memorized_invoices_interval_check" CHECK (interval_days in (7, 14, 21, 28))
);
--> statement-breakpoint
CREATE TABLE "memorized_skips" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"memorized_invoice_id" bigint NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "memorized_skips_key" UNIQUE("memorized_invoice_id","day")
);
--> statement-breakpoint
ALTER TABLE "memorized_invoices" ADD CONSTRAINT "memorized_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorized_invoices" ADD CONSTRAINT "memorized_invoices_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorized_invoices" ADD CONSTRAINT "memorized_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorized_invoices" ADD CONSTRAINT "memorized_invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorized_skips" ADD CONSTRAINT "memorized_skips_memorized_invoice_id_fkey" FOREIGN KEY ("memorized_invoice_id") REFERENCES "public"."memorized_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorized_skips" ADD CONSTRAINT "memorized_skips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memorized_invoices_one_active" ON "memorized_invoices" USING btree ("customer_id",coalesce("property_id", 0)) WHERE is_active;--> statement-breakpoint
CREATE TRIGGER "memorized_invoices_stamp" BEFORE INSERT OR UPDATE ON "memorized_invoices"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "memorized_invoices_audit" AFTER INSERT OR UPDATE OR DELETE ON "memorized_invoices"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "memorized_skips_audit" AFTER INSERT OR UPDATE OR DELETE ON "memorized_skips"
  FOR EACH ROW EXECUTE FUNCTION audit_row();
