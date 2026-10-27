CREATE TABLE "expense_receipts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"expense_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" bigint,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_receipts_content_type_check" CHECK (content_type = ANY (ARRAY['image/webp'::text, 'application/pdf'::text]))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"expense_date" date NOT NULL,
	"vendor_id" bigint NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_method" text NOT NULL,
	"card_brand" text,
	"card_last4" text,
	"reference" text,
	"description" text,
	"recurring_expense_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "expenses_category_check" CHECK (category = ANY (ARRAY['supplies','equipment','fuel','vehicle','insurance','wages','contractors','marketing','software','phone','rent','utilities','office','fees','taxes','professional','meals','travel','uniforms','training','other']::text[])),
	CONSTRAINT "expenses_amount_check" CHECK (amount_cents > 0 AND amount_cents <= 100000000),
	CONSTRAINT "expenses_payment_method_check" CHECK (payment_method = ANY (ARRAY['credit_card','debit_card','cash','check','bank_transfer','app','other']::text[])),
	CONSTRAINT "expenses_card_brand_check" CHECK (card_brand = ANY (ARRAY['amex','visa','mastercard','discover','other']::text[])),
	CONSTRAINT "expenses_card_last4_check" CHECK (card_last4 ~ '^\d{4}$')
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendor_id" bigint NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"amount_varies" boolean DEFAULT false NOT NULL,
	"frequency" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"payment_method" text NOT NULL,
	"card_brand" text,
	"card_last4" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "recurring_expenses_category_check" CHECK (category = ANY (ARRAY['supplies','equipment','fuel','vehicle','insurance','wages','contractors','marketing','software','phone','rent','utilities','office','fees','taxes','professional','meals','travel','uniforms','training','other']::text[])),
	CONSTRAINT "recurring_expenses_amount_check" CHECK (amount_cents > 0 AND amount_cents <= 100000000),
	CONSTRAINT "recurring_expenses_frequency_check" CHECK (frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text])),
	CONSTRAINT "recurring_expenses_end_after_start_check" CHECK (end_date IS NULL OR end_date >= start_date),
	CONSTRAINT "recurring_expenses_payment_method_check" CHECK (payment_method = ANY (ARRAY['credit_card','debit_card','cash','check','bank_transfer','app','other']::text[])),
	CONSTRAINT "recurring_expenses_card_brand_check" CHECK (card_brand = ANY (ARRAY['amex','visa','mastercard','discover','other']::text[])),
	CONSTRAINT "recurring_expenses_card_last4_check" CHECK (card_last4 ~ '^\d{4}$')
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendor_code" text NOT NULL,
	"name" text NOT NULL,
	"default_category" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"website" text,
	"address" text,
	"account_number" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "vendors_vendor_code_key" UNIQUE("vendor_code"),
	CONSTRAINT "vendors_vendor_code_check" CHECK (vendor_code ~ '^\S+$'),
	CONSTRAINT "vendors_name_check" CHECK (btrim(name) <> ''),
	CONSTRAINT "vendors_default_category_check" CHECK (default_category = ANY (ARRAY['supplies','equipment','fuel','vehicle','insurance','wages','contractors','marketing','software','phone','rent','utilities','office','fees','taxes','professional','meals','travel','uniforms','training','other']::text[]))
);
--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_receipts_expense" ON "expense_receipts" USING btree ("expense_id" int8_ops);--> statement-breakpoint
CREATE INDEX "expenses_date" ON "expenses" USING btree ("expense_date" date_ops);--> statement-breakpoint
CREATE INDEX "expenses_vendor_date" ON "expenses" USING btree ("vendor_id" int8_ops,"expense_date" date_ops);--> statement-breakpoint
CREATE INDEX "expenses_recurring" ON "expenses" USING btree ("recurring_expense_id" int8_ops);--> statement-breakpoint
CREATE INDEX "recurring_expenses_vendor" ON "recurring_expenses" USING btree ("vendor_id" int8_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors" USING btree (lower("name"));--> statement-breakpoint
-- Who created and last changed each row, from the signed-in user (same
-- trigger function as appointments), and the change history in audit_log.
-- Receipts aren't audited: their file contents would be copied into the log.
CREATE TRIGGER "vendors_stamp" BEFORE INSERT OR UPDATE ON "vendors"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "vendors_audit" AFTER INSERT OR UPDATE OR DELETE ON "vendors"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "recurring_expenses_stamp" BEFORE INSERT OR UPDATE ON "recurring_expenses"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "recurring_expenses_audit" AFTER INSERT OR UPDATE OR DELETE ON "recurring_expenses"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
CREATE TRIGGER "expenses_stamp" BEFORE INSERT OR UPDATE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "expenses_audit" AFTER INSERT OR UPDATE OR DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION audit_row();
