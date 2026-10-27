CREATE TABLE "notification_reads" (
	"notification_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_pkey" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_href_check" CHECK (href IS NULL OR href ~ '^/[^/]')
);
--> statement-breakpoint
CREATE TABLE "quote_acceptances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quote_id" bigint NOT NULL,
	"quote_version" integer NOT NULL,
	"option_id" text NOT NULL,
	"option_name" text NOT NULL,
	"add_on_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"total_cents" integer NOT NULL,
	"signer_name" text NOT NULL,
	"verified_by" text NOT NULL,
	"consent_version" text NOT NULL,
	"consent_text" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_acceptances_quote_id_key" UNIQUE("quote_id"),
	CONSTRAINT "quote_acceptances_verified_by_check" CHECK (verified_by = ANY (ARRAY['phone'::text, 'email'::text, 'none'::text])),
	CONSTRAINT "quote_acceptances_total_check" CHECK (total_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quote_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE "quote_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quote_number" integer NOT NULL,
	"customer_id" bigint NOT NULL,
	"property_id" bigint,
	"template_id" bigint,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" date NOT NULL,
	"public_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"invoice_id" bigint,
	"invoice_error" text,
	"appointment_id" bigint,
	"verify_failures" integer DEFAULT 0 NOT NULL,
	"verify_locked_until" timestamp with time zone,
	"internal_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "quotes_quote_number_key" UNIQUE("quote_number"),
	CONSTRAINT "quotes_public_token_key" UNIQUE("public_token"),
	CONSTRAINT "quotes_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text])),
	CONSTRAINT "quotes_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_acceptances" ADD CONSTRAINT "quote_acceptances_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_templates" ADD CONSTRAINT "quote_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_templates" ADD CONSTRAINT "quote_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."quote_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_created" ON "notifications" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "quote_events_quote" ON "quote_events" USING btree ("quote_id" int8_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "quote_templates_name_key" ON "quote_templates" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "quotes_customer" ON "quotes" USING btree ("customer_id" int8_ops);--> statement-breakpoint
CREATE INDEX "quotes_status" ON "quotes" USING btree ("status" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
-- Acceptances are a legal record: once written they can't be changed or
-- removed, even by the app.
CREATE FUNCTION "quote_acceptances_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'quote acceptances can''t be changed or deleted';
END
$$;--> statement-breakpoint
CREATE TRIGGER "quote_acceptances_no_change" BEFORE UPDATE OR DELETE ON "quote_acceptances"
  FOR EACH ROW EXECUTE FUNCTION quote_acceptances_immutable();--> statement-breakpoint
CREATE TRIGGER "quote_templates_stamp" BEFORE INSERT OR UPDATE ON "quote_templates"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "quote_templates_audit" AFTER INSERT OR UPDATE OR DELETE ON "quote_templates"
  FOR EACH ROW EXECUTE FUNCTION audit_row();
-- quotes keep their own history in quote_events (customer views update the
-- row often, which would flood the audit log), so they have no audit trigger
