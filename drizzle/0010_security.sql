CREATE TABLE "login_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"pending_secret" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_challenges_purpose_check" CHECK (purpose = ANY (ARRAY['verify'::text, 'enroll'::text]))
);
--> statement-breakpoint
CREATE TABLE "user_recovery_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_by_user_id" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_challenges_user" ON "login_challenges" USING btree ("user_id" int8_ops);--> statement-breakpoint
CREATE INDEX "user_recovery_codes_user" ON "user_recovery_codes" USING btree ("user_id" int8_ops);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]));--> statement-breakpoint
-- The earliest active account is the owner; anyone else starts as staff.
UPDATE "users" SET "role" = 'owner' WHERE "id" = (SELECT "id" FROM "users" WHERE NOT "is_disabled" ORDER BY "created_at", "id" LIMIT 1);--> statement-breakpoint
-- Two-step login is now required: end every session so everyone signs in
-- again and sets it up.
DELETE FROM "sessions";
