CREATE TABLE "appointment_contractors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"appointment_id" bigint NOT NULL,
	"contractor_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "appointment_contractors_key" UNIQUE("appointment_id","contractor_id")
);
--> statement-breakpoint
CREATE TABLE "contractor_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contractor_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"tax_year" smallint,
	"reported_cents" integer,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" bigint,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_documents_kind_check" CHECK (kind = ANY (ARRAY['w9'::text, '1099_nec'::text, 'other'::text])),
	CONSTRAINT "contractor_documents_content_type_check" CHECK (content_type = ANY (ARRAY['image/webp'::text, 'application/pdf'::text])),
	CONSTRAINT "contractor_documents_1099_year_check" CHECK (kind <> '1099_nec' OR (tax_year BETWEEN 2000 AND 2100 AND reported_cents >= 0))
);
--> statement-breakpoint
CREATE TABLE "contractor_pay_rates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contractor_id" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"pay_type" text NOT NULL,
	"day_rate_cents" integer,
	"percent_bp" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "contractor_pay_rates_contractor_from_key" UNIQUE("contractor_id","effective_from"),
	CONSTRAINT "contractor_pay_rates_pay_type_check" CHECK (pay_type = ANY (ARRAY['day_rate'::text, 'percent'::text])),
	CONSTRAINT "contractor_pay_rates_amount_check" CHECK ((pay_type = 'day_rate' AND day_rate_cents > 0 AND day_rate_cents <= 1000000 AND percent_bp IS NULL) OR (pay_type = 'percent' AND percent_bp > 0 AND percent_bp <= 10000 AND day_rate_cents IS NULL))
);
--> statement-breakpoint
CREATE TABLE "contractor_tax_ids" (
	"contractor_id" bigint PRIMARY KEY NOT NULL,
	"tin_encrypted" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendor_id" bigint NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"business_name" text,
	"email" text,
	"phone" text,
	"street" text,
	"city" text,
	"state" text,
	"zip" text,
	"tax_classification" text,
	"tin_type" text,
	"tin_last4" text,
	"w9_received_on" date,
	"start_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "contractors_vendor_id_key" UNIQUE("vendor_id"),
	CONSTRAINT "contractors_name_check" CHECK (btrim(first_name) <> '' AND btrim(last_name) <> ''),
	CONSTRAINT "contractors_tax_classification_check" CHECK (tax_classification = ANY (ARRAY['individual','llc_single','partnership','c_corp','s_corp','llc_partnership','llc_c_corp','llc_s_corp','other']::text[])),
	CONSTRAINT "contractors_tin_type_check" CHECK (tin_type = ANY (ARRAY['ssn'::text, 'ein'::text])),
	CONSTRAINT "contractors_tin_last4_check" CHECK (tin_last4 ~ '^\d{4}$')
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_payment_method_check";--> statement-breakpoint
ALTER TABLE "recurring_expenses" DROP CONSTRAINT "recurring_expenses_payment_method_check";--> statement-breakpoint
ALTER TABLE "appointment_contractors" ADD CONSTRAINT "appointment_contractors_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_contractors" ADD CONSTRAINT "appointment_contractors_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_contractors" ADD CONSTRAINT "appointment_contractors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_contractors" ADD CONSTRAINT "appointment_contractors_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pay_rates" ADD CONSTRAINT "contractor_pay_rates_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pay_rates" ADD CONSTRAINT "contractor_pay_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pay_rates" ADD CONSTRAINT "contractor_pay_rates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_tax_ids" ADD CONSTRAINT "contractor_tax_ids_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_tax_ids" ADD CONSTRAINT "contractor_tax_ids_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_contractors_contractor" ON "appointment_contractors" USING btree ("contractor_id" int8_ops);--> statement-breakpoint
CREATE INDEX "contractor_documents_contractor" ON "contractor_documents" USING btree ("contractor_id" int8_ops);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'view'::text]));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_method_check" CHECK (payment_method = ANY (ARRAY['credit_card','debit_card','cash','check','bank_transfer','zelle','app','other']::text[]));--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_payment_method_check" CHECK (payment_method = ANY (ARRAY['credit_card','debit_card','cash','check','bank_transfer','zelle','app','other']::text[]));--> statement-breakpoint
-- Who created and last changed each row, and the change history. Tax IDs and
-- documents aren't audited by trigger (the number or file would be copied
-- into the log); the app logs who viewed, changed or exported them.
CREATE TRIGGER "contractors_stamp" BEFORE INSERT OR UPDATE ON "contractors"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "contractors_audit" AFTER INSERT OR UPDATE OR DELETE ON "contractors"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "contractor_pay_rates_stamp" BEFORE INSERT OR UPDATE ON "contractor_pay_rates"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "contractor_pay_rates_audit" AFTER INSERT OR UPDATE OR DELETE ON "contractor_pay_rates"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "appointment_contractors_stamp" BEFORE INSERT OR UPDATE ON "appointment_contractors"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "appointment_contractors_audit" AFTER INSERT OR UPDATE OR DELETE ON "appointment_contractors"
  FOR EACH ROW EXECUTE FUNCTION audit_row();
