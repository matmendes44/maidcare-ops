CREATE TABLE "appointment_vehicles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"appointment_id" bigint NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "appointment_vehicles_key" UNIQUE("appointment_id","vehicle_id")
);
--> statement-breakpoint
ALTER TABLE "appointment_vehicles" ADD CONSTRAINT "appointment_vehicles_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_vehicles" ADD CONSTRAINT "appointment_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_vehicles" ADD CONSTRAINT "appointment_vehicles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_vehicles" ADD CONSTRAINT "appointment_vehicles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_vehicles_vehicle" ON "appointment_vehicles" USING btree ("vehicle_id" int8_ops);--> statement-breakpoint
CREATE TRIGGER "appointment_vehicles_stamp" BEFORE INSERT OR UPDATE ON "appointment_vehicles"
  FOR EACH ROW EXECUTE FUNCTION stamp_appointment();--> statement-breakpoint
CREATE TRIGGER "appointment_vehicles_audit" AFTER INSERT OR UPDATE OR DELETE ON "appointment_vehicles"
  FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
-- every appointment's vehicle so far becomes its first (lead) vehicle
INSERT INTO "appointment_vehicles" ("appointment_id", "vehicle_id", "created_at", "created_by")
  SELECT "id", "vehicle_id", coalesce("created_at", now()), "created_by" FROM "appointments" WHERE "vehicle_id" IS NOT NULL
  ON CONFLICT DO NOTHING;
