CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"locale" text,
	"user_id" text,
	"ip_hash" text,
	"user_agent" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"message" text NOT NULL,
	"route" text,
	"source" text NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"first_frame" text,
	"stack" text,
	"context" jsonb,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gsc_daily" (
	"day" date NOT NULL,
	"page" text NOT NULL,
	"query" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" double precision DEFAULT 0 NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "gsc_daily_day_page_query_pk" PRIMARY KEY("day","page","query")
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'test' NOT NULL,
	"user_id" text,
	"to_addr" text NOT NULL,
	"from_addr" text NOT NULL,
	"subject" text,
	"text_body" text,
	"html_body" text,
	"spf" text,
	"dkim" text,
	"dmarc" text,
	"auth_results" text,
	"headers" jsonb,
	"raw_size" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"inbound_token" text,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"n" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"screenshot_key" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" text,
	"opportunity_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"needs_you_reason" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"external_ref" text,
	"evidence" jsonb,
	"outcome" jsonb,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"credit_lot_id" text,
	"practice" boolean DEFAULT false NOT NULL,
	"follow_up_at" timestamp with time zone,
	"follow_ups_sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"email" text,
	"org" text,
	"role" text,
	"url" text,
	"source" text,
	"notes" text,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"application_id" text,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"total" integer NOT NULL,
	"remaining" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_key" text NOT NULL,
	"order_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"object_key" text,
	"filename" text,
	"content_type" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	"extracted_text" text,
	"extraction" jsonb,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"application_id" text,
	"opportunity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"path" text NOT NULL,
	"claim" text NOT NULL,
	"value" jsonb,
	"source_doc_id" text,
	"quote" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"confirmed_by_user" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"content" jsonb NOT NULL,
	"object_key" text,
	"mime" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"family" text NOT NULL,
	"sub" text,
	"label" text NOT NULL,
	"success_definition" text,
	"horizon_months" integer DEFAULT 6 NOT NULL,
	"constraints" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"refresh_token_enc" text,
	"account_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"dedupe_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" real DEFAULT 0 NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" text,
	"opportunity_id" text NOT NULL,
	"fit" integer NOT NULL,
	"win_probability" real,
	"effort" integer,
	"value" integer,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank" integer,
	"feedback" text,
	"feedback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text,
	"contact_id" text,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body_text" text,
	"to_addr" text,
	"from_addr" text,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"classification" text,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"metric" text NOT NULL,
	"target" integer NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"org_name" text,
	"org_slug" text,
	"url" text,
	"summary" text,
	"description" text,
	"benefits" jsonb,
	"cost" jsonb,
	"geo" jsonb DEFAULT '{"countries":[],"cities":[],"remote":null,"worldwide":false}'::jsonb NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"functions" text[] DEFAULT '{}'::text[] NOT NULL,
	"eligibility" jsonb,
	"deadline" timestamp with time zone,
	"rolling" boolean DEFAULT false NOT NULL,
	"cycle" text,
	"apply" jsonb NOT NULL,
	"required_materials" text[] DEFAULT '{}'::text[] NOT NULL,
	"est_acceptance_rate" real,
	"est_effort_minutes" integer,
	"quality_score" integer,
	"source_id" text,
	"source_ref" text,
	"verified_at" timestamp with time zone,
	"status" text DEFAULT 'unverified' NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(name, '')), 'A') || setweight(to_tsvector('simple', coalesce(org_name, '')), 'B') || setweight(to_tsvector('simple', coalesce(summary, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"sku" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"stripe_subscription_id" text,
	"stripe_payment_intent" text,
	"stripe_invoice_id" text,
	"amount_total" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"promo_code" text,
	"email" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"identity" jsonb NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"functions" text[] DEFAULT '{}'::text[] NOT NULL,
	"occupations" text[] DEFAULT '{}'::text[] NOT NULL,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"achievements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"packs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"completeness" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'empty' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text DEFAULT 'daily' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_count" integer,
	"last_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"sku" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contact_messages_status_idx" ON "contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "error_groups_fingerprint_uq" ON "error_groups" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_groups_open_idx" ON "error_groups" USING btree ("resolved_at","severity","last_seen");--> statement-breakpoint
CREATE INDEX "inbox_messages_to_idx" ON "inbox_messages" USING btree ("to_addr","received_at");--> statement-breakpoint
CREATE INDEX "inbox_messages_user_idx" ON "inbox_messages" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "inbox_messages_kind_idx" ON "inbox_messages" USING btree ("kind","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_submissions_ref_uq" ON "sandbox_submissions" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "sandbox_submissions_created_idx" ON "sandbox_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stripe_events_received_idx" ON "stripe_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_inbound_token_uq" ON "users" USING btree ("inbound_token");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_stripe_customer_idx" ON "users" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_steps_app_n_uq" ON "application_steps" USING btree ("application_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_opportunity_uq" ON "applications" USING btree ("user_id","opportunity_id") WHERE practice = false;--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "applications_user_goal_idx" ON "applications" USING btree ("user_id","goal_id");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "applications_followup_idx" ON "applications" USING btree ("status","follow_up_at");--> statement-breakpoint
CREATE INDEX "applications_opportunity_idx" ON "applications" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "authorizations_user_idx" ON "authorizations" USING btree ("user_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "authorizations_active_uq" ON "authorizations" USING btree ("user_id","scope") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_email_uq" ON "contacts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "contacts_user_kind_idx" ON "contacts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_events_app_lot_kind_uq" ON "credit_events" USING btree ("application_id","lot_id","kind") WHERE application_id is not null;--> statement-breakpoint
CREATE INDEX "credit_events_user_idx" ON "credit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_events_lot_idx" ON "credit_events" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_lots_source_uq" ON "credit_lots" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "credit_lots_user_idx" ON "credit_lots" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_object_key_uq" ON "documents" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "events_app_idx" ON "events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "events_kind_idx" ON "events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "facts_user_profile_path_idx" ON "facts" USING btree ("user_id","profile_id","path");--> statement-breakpoint
CREATE INDEX "facts_source_doc_idx" ON "facts" USING btree ("source_doc_id");--> statement-breakpoint
CREATE INDEX "generated_documents_user_idx" ON "generated_documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generated_documents_app_idx" ON "generated_documents" USING btree ("application_id","kind","version");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_provider_uq" ON "integrations" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_status_locked_idx" ON "jobs" USING btree ("status","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_kind_idx" ON "jobs" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "llm_calls_user_idx" ON "llm_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_purpose_idx" ON "llm_calls" USING btree ("purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_user_opportunity_uq" ON "matches" USING btree ("user_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "matches_user_rank_idx" ON "matches" USING btree ("user_id","rank");--> statement-breakpoint
CREATE INDEX "matches_user_goal_idx" ON "matches" USING btree ("user_id","goal_id","rank");--> statement-breakpoint
CREATE INDEX "matches_opportunity_idx" ON "matches" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "messages_user_app_idx" ON "messages" USING btree ("user_id","application_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_contact_idx" ON "messages" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("gmail_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_gmail_message_uq" ON "messages" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "milestones_goal_idx" ON "milestones" USING btree ("goal_id","position");--> statement-breakpoint
CREATE INDEX "milestones_user_idx" ON "milestones" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_emailed_idx" ON "notifications" USING btree ("emailed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_slug_uq" ON "opportunities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_source_ref_uq" ON "opportunities" USING btree ("source_id","source_ref");--> statement-breakpoint
CREATE INDEX "opportunities_status_type_deadline_idx" ON "opportunities" USING btree ("status","type","deadline");--> statement-breakpoint
CREATE INDEX "opportunities_status_deadline_idx" ON "opportunities" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "opportunities_status_public_idx" ON "opportunities" USING btree ("status","public","updated_at");--> statement-breakpoint
CREATE INDEX "opportunities_org_idx" ON "opportunities" USING btree ("org_slug");--> statement-breakpoint
CREATE INDEX "opportunities_tags_gin" ON "opportunities" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "opportunities_industries_gin" ON "opportunities" USING gin ("industries");--> statement-breakpoint
CREATE INDEX "opportunities_functions_gin" ON "opportunities" USING gin ("functions");--> statement-breakpoint
CREATE INDEX "opportunities_search_gin" ON "opportunities" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_snapshots_hash_uq" ON "opportunity_snapshots" USING btree ("opportunity_id","hash");--> statement-breakpoint
CREATE INDEX "opportunity_snapshots_opp_idx" ON "opportunity_snapshots" USING btree ("opportunity_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_session_uq" ON "orders" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_pi_idx" ON "orders" USING btree ("stripe_payment_intent");--> statement-breakpoint
CREATE INDEX "orders_subscription_idx" ON "orders" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_versions_profile_version_uq" ON "profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_uq" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profiles_status_idx" ON "profiles" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_kind_url_uq" ON "sources" USING btree ("kind","url");--> statement-breakpoint
CREATE INDEX "sources_enabled_idx" ON "sources" USING btree ("enabled","last_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_uq" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","status");