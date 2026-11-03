ALTER TABLE "applications" ADD COLUMN "unlocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "unlock_source" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "paid_email" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "application_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "application_id" text;--> statement-breakpoint
CREATE INDEX "applications_paid_email_idx" ON "applications" USING btree ("paid_email");--> statement-breakpoint
CREATE INDEX "llm_calls_application_idx" ON "llm_calls" USING btree ("application_id","created_at");--> statement-breakpoint
-- Applications that reached "ready" (or went further) before the paywall existed stay open:
-- their people confirmed, submitted or were handed over under the old rules.
UPDATE "applications" SET "unlocked_at" = coalesce("submitted_at", "updated_at"), "unlock_source" = 'legacy'
WHERE "practice" = false AND "unlocked_at" IS NULL AND "status" NOT IN ('draft', 'needs_info', 'preparing');
