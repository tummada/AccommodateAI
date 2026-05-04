CREATE TYPE "acmd"."acmd_plan_tier" AS ENUM('starter', 'pro', 'business');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_user_role" AS ENUM('super_admin', 'hr', 'manager');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_case_status" AS ENUM('intake', 'interactive_process', 'awaiting_medical', 'awaiting_input', 'review', 'implementation', 'active', 'approved', 'denied', 'closed');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_case_type" AS ENUM('ada', 'pwfa', 'state_law', 'multiple');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_letter_status" AS ENUM('draft', 'sent');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_letter_type" AS ENUM('acknowledgment', 'medical_request', 'approval', 'denial', 'follow_up');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_audit_action" AS ENUM('case_created', 'case_updated', 'case_assigned', 'case_reassigned', 'case_status_changed', 'case_closed', 'interactive_process_started', 'medical_docs_requested', 'medical_docs_received', 'manager_input_requested', 'manager_input_received', 'employee_meeting_logged', 'accommodation_approved', 'accommodation_denied', 'accommodation_modified', 'legal_review_requested', 'implementation_started', 'implementation_completed', 'follow_up_scheduled', 'follow_up_completed', 'document_uploaded', 'document_deleted', 'ai_classification_completed', 'ai_suggestions_generated', 'ai_consent_given', 'ai_consent_declined', 'deadline_approaching', 'deadline_overdue', 'escalation_triggered', 'notification_sent', 'audit_exported', 'denial_gate_validated', 'legal_review_completed', 'pwfa_fast_track_approved', 'approval_settings_updated', 'pwfa_interim_recorded', 'pwfa_leave_forcing_blocked', 'pwfa_leave_forcing_approved', 'auto_status_transition', 'discussion_created', 'supervisor_approved', 'supervisor_rejected', 'supervisor_info_requested', 'case_classified', 'checklist_completed', 'letter_generated', 'letter_sent', 'case_reopened', 'deadline_missed', 'medical_info_accessed');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_notification_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_law_type" AS ENUM('ada', 'pwfa', 'state');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_cost_range" AS ENUM('no_cost', 'low', 'moderate', 'high');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_effectiveness" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_decision_type" AS ENUM('approved', 'denied');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_legal_review_policy" AS ENUM('yes', 'no', 'recommend');--> statement-breakpoint
CREATE TYPE "acmd"."acmd_discussion_method" AS ENUM('in_person', 'video', 'phone', 'email', 'written');--> statement-breakpoint
CREATE TABLE "acmd"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"hq_state" varchar(50),
	"size" varchar(50),
	"industry" varchar(100),
	"plan_tier" "acmd"."acmd_plan_tier" DEFAULT 'starter' NOT NULL,
	"subscription_status" "acmd"."acmd_subscription_status" DEFAULT 'trialing' NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"max_states" integer DEFAULT 1 NOT NULL,
	"settings" jsonb,
	"onboarding_completed_at" timestamp with time zone,
	"default_hr_contact_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "acmd"."acmd_user_role" DEFAULT 'hr' NOT NULL,
	"google_id" varchar(255),
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "acmd"."employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"position" varchar(255),
	"department" varchar(255),
	"state" varchar(50),
	"hris_id" varchar(255),
	"employment_status" varchar(20) DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"status" "acmd"."acmd_case_status" DEFAULT 'intake' NOT NULL,
	"ai_consent_given" boolean DEFAULT false NOT NULL,
	"ai_consent_timestamp" timestamp with time zone,
	"pwfa_per_se" boolean DEFAULT false NOT NULL,
	"type" "acmd"."acmd_case_type" NOT NULL,
	"request_description" text,
	"medical_info" text,
	"ai_classification" jsonb,
	"suggested_accommodations" jsonb,
	"approved_accommodation" text,
	"denial_reason" text,
	"interim_accommodation_offered" boolean DEFAULT false NOT NULL,
	"interim_accommodation_description" text,
	"interim_offered_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"step_order" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" "acmd"."acmd_letter_type" NOT NULL,
	"content" text NOT NULL,
	"status" "acmd"."acmd_letter_status" DEFAULT 'draft' NOT NULL,
	"sent_to_email" varchar(255),
	"pdf_url" varchar(1024),
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid,
	"action" "acmd"."acmd_audit_action" NOT NULL,
	"actor_id" uuid,
	"metadata" jsonb,
	"visibility" text[] DEFAULT '{"super_admin","hr"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"file_type" varchar(100),
	"storage_path" varchar(1024) NOT NULL,
	"encrypted" boolean DEFAULT true NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"case_id" uuid,
	"read_at" timestamp with time zone,
	"email_sent" boolean DEFAULT false NOT NULL,
	"priority" "acmd"."acmd_notification_priority" DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"law_type" "acmd"."acmd_law_type" NOT NULL,
	"state" varchar(50),
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"requirements" jsonb,
	"deadlines" jsonb,
	"source_url" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."jan_accommodations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition" varchar(255) NOT NULL,
	"job_category" varchar(255),
	"accommodation" varchar(255) NOT NULL,
	"cost_estimate" varchar(100),
	"cost_range" "acmd"."acmd_cost_range",
	"effectiveness" "acmd"."acmd_effectiveness",
	"description" text,
	"source_url" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"cost_estimate" varchar(100),
	"cost_range" "acmd"."acmd_cost_range",
	"effectiveness" "acmd"."acmd_effectiveness",
	"jan_reference_url" varchar(1024),
	"selected" boolean DEFAULT false NOT NULL,
	"selection_reason" text,
	"selected_by" uuid,
	"selected_at" timestamp with time zone,
	"source" varchar(50) DEFAULT 'ai' NOT NULL,
	"original_description" text,
	"customized_description" text,
	"implementation_status" varchar(50) DEFAULT 'pending',
	"implementation_cost" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "acmd"."approval_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"require_manager_input" boolean DEFAULT true NOT NULL,
	"require_legal_review_for_denial" "acmd"."acmd_legal_review_policy" DEFAULT 'recommend' NOT NULL,
	"allow_self_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acmd"."case_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"decision_type" "acmd"."acmd_decision_type" NOT NULL,
	"cost_analysis" text,
	"financial_resources" text,
	"size_and_type" text,
	"operational_impact" text,
	"alternatives_considered" jsonb,
	"legal_review_required" boolean DEFAULT true NOT NULL,
	"legal_reviewed" boolean DEFAULT false NOT NULL,
	"legal_reviewed_by" uuid,
	"legal_reviewed_at" timestamp with time zone,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supervisor_status" varchar,
	"supervisor_id" uuid,
	"supervisor_reviewed_at" timestamp with time zone,
	"supervisor_reject_reason" text,
	"supervisor_info_request" text
);
--> statement-breakpoint
CREATE TABLE "acmd"."discussions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"recorded_by" uuid,
	"discussion_date" date NOT NULL,
	"method" "acmd"."acmd_discussion_method" NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"employee_preference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acmd"."users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."cases" ADD CONSTRAINT "cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."cases" ADD CONSTRAINT "cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "acmd"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."cases" ADD CONSTRAINT "cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."checklist_items" ADD CONSTRAINT "checklist_items_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."checklist_items" ADD CONSTRAINT "checklist_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."letters" ADD CONSTRAINT "letters_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."letters" ADD CONSTRAINT "letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."audit_logs" ADD CONSTRAINT "audit_logs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "acmd"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."notifications" ADD CONSTRAINT "notifications_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."suggestions" ADD CONSTRAINT "suggestions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."suggestions" ADD CONSTRAINT "suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "acmd"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."approval_settings" ADD CONSTRAINT "approval_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."case_decisions" ADD CONSTRAINT "case_decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."case_decisions" ADD CONSTRAINT "case_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."case_decisions" ADD CONSTRAINT "case_decisions_legal_reviewed_by_users_id_fk" FOREIGN KEY ("legal_reviewed_by") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."case_decisions" ADD CONSTRAINT "case_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "acmd"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."case_decisions" ADD CONSTRAINT "case_decisions_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."discussions" ADD CONSTRAINT "discussions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "acmd"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."discussions" ADD CONSTRAINT "discussions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "acmd"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acmd"."discussions" ADD CONSTRAINT "discussions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "acmd"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acmd_cases_company_status_idx" ON "acmd"."cases" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "acmd_cases_company_type_idx" ON "acmd"."cases" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "acmd_cases_company_created_at_idx" ON "acmd"."cases" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "acmd_cases_employee_id_idx" ON "acmd"."cases" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "acmd_checklist_items_case_step_idx" ON "acmd"."checklist_items" USING btree ("case_id","step_order");--> statement-breakpoint
CREATE INDEX "acmd_audit_logs_company_case_idx" ON "acmd"."audit_logs" USING btree ("company_id","case_id");--> statement-breakpoint
CREATE INDEX "acmd_audit_logs_company_created_at_idx" ON "acmd"."audit_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "acmd_notifications_company_user_read_idx" ON "acmd"."notifications" USING btree ("company_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "acmd_notifications_priority_idx" ON "acmd"."notifications" USING btree ("company_id","priority","read_at");--> statement-breakpoint
CREATE INDEX "acmd_compliance_rules_law_type_state_idx" ON "acmd"."compliance_rules" USING btree ("law_type","state");--> statement-breakpoint
CREATE INDEX "acmd_suggestions_case_id_idx" ON "acmd"."suggestions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "acmd_suggestions_company_id_idx" ON "acmd"."suggestions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "acmd_suggestions_impl_status_idx" ON "acmd"."suggestions" USING btree ("case_id","implementation_status");--> statement-breakpoint
CREATE UNIQUE INDEX "acmd_approval_settings_company_id_uniq" ON "acmd"."approval_settings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "acmd_case_decisions_case_id_idx" ON "acmd"."case_decisions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "acmd_case_decisions_company_id_idx" ON "acmd"."case_decisions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "acmd_discussions_case_company_idx" ON "acmd"."discussions" USING btree ("case_id","company_id");--> statement-breakpoint
CREATE INDEX "acmd_discussions_case_date_idx" ON "acmd"."discussions" USING btree ("case_id","discussion_date");