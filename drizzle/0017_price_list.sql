CREATE TABLE "price_lists" (
	"id" smallint PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "price_lists_single_row" CHECK (id = 1)
);
--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- every change to prices is kept in the audit log
CREATE TRIGGER "price_lists_stamp" BEFORE INSERT OR UPDATE ON "price_lists"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "price_lists_audit" AFTER INSERT OR UPDATE OR DELETE ON "price_lists"
  FOR EACH ROW EXECUTE FUNCTION audit_row();
