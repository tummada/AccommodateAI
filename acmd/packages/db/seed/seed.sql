-- AccommodateAI Seed Data
-- For development/testing only — do NOT run in production
-- Depends on: migrations 0007-0012

-- ─── ADA Compliance Rules (5) ─────────────────────────────────────────────────

INSERT INTO acmd_compliance_rules (id, law_type, state, title, description, requirements, deadlines, source_url) VALUES
(
  gen_random_uuid(),
  'ada',
  NULL,
  'ADA — Interactive Process Requirement',
  'Employers must engage in an interactive process with the employee to determine effective reasonable accommodations. Both parties must act in good faith.',
  '{"steps": ["Acknowledge request within 5 business days", "Request relevant medical documentation", "Engage in good-faith dialogue", "Document all steps taken"]}',
  '{"initial_response_days": 5, "process_completion_days": 30}',
  'https://www.eeoc.gov/laws/guidance/enforcement-guidance-reasonable-accommodation-and-undue-hardship-under-ada'
),
(
  gen_random_uuid(),
  'ada',
  NULL,
  'ADA — Reasonable Accommodation Definition',
  'Any modification or adjustment to a job, work environment, or the way things are usually done that enables a qualified person with a disability to enjoy equal employment opportunities.',
  '{"examples": ["Modified work schedule", "Remote work", "Ergonomic equipment", "Job restructuring", "Leave of absence"]}',
  NULL,
  'https://www.eeoc.gov/laws/statutes/ada.cfm'
),
(
  gen_random_uuid(),
  'ada',
  NULL,
  'ADA — Undue Hardship Standard',
  'Employers are not required to provide an accommodation that would cause significant difficulty or expense. Factors include cost, employer resources, and nature of the business.',
  '{"factors": ["Cost of accommodation", "Employer financial resources", "Business operations impact", "Type of facility"]}',
  NULL,
  'https://www.eeoc.gov/laws/guidance/enforcement-guidance-reasonable-accommodation-and-undue-hardship-under-ada#undue'
),
(
  gen_random_uuid(),
  'ada',
  NULL,
  'ADA — Medical Documentation Rights',
  'Employers may request reasonable medical documentation when a disability or need for accommodation is not obvious. Documentation must be job-related.',
  '{"allowed": ["Functional limitations", "Recommended accommodations", "Duration of limitations"], "prohibited": ["Complete medical history", "Diagnosis beyond functional limits"]}',
  '{"response_to_request_days": 15}',
  'https://www.eeoc.gov/laws/guidance/enforcement-guidance-disability-related-inquiries-and-medical-examinations'
),
(
  gen_random_uuid(),
  'ada',
  NULL,
  'ADA — Confidentiality of Medical Information',
  'Medical information obtained in connection with an accommodation request must be maintained separately from personnel files and kept confidential.',
  '{"storage": "Separate confidential file", "access": ["Supervisors with direct need", "Safety personnel if emergency", "Government officials investigating compliance"], "prohibited": "General HR file"}',
  NULL,
  'https://www.eeoc.gov/laws/guidance/enforcement-guidance-disability-related-inquiries-and-medical-examinations#q36'
);

-- ─── PWFA Compliance Rules (5) ────────────────────────────────────────────────

INSERT INTO acmd_compliance_rules (id, law_type, state, title, description, requirements, deadlines, source_url) VALUES
(
  gen_random_uuid(),
  'pwfa',
  NULL,
  'PWFA — Coverage and Scope',
  'The Pregnant Workers Fairness Act (effective June 27, 2023) requires employers with 15+ employees to provide reasonable accommodations for known limitations related to pregnancy, childbirth, or related medical conditions.',
  '{"covered_conditions": ["Pregnancy", "Childbirth", "Postpartum recovery", "Lactation", "Pregnancy-related medical conditions"], "employer_threshold": 15}',
  NULL,
  'https://www.eeoc.gov/wysk/what-you-should-know-about-pregnant-workers-fairness-act'
),
(
  gen_random_uuid(),
  'pwfa',
  NULL,
  'PWFA — Temporary Suspension of Essential Functions',
  'Unlike the ADA, the PWFA allows for temporary suspension of essential job functions as a reasonable accommodation if the limitation is temporary.',
  '{"conditions": ["Limitation is temporary", "Employer can reasonably suspend function", "Employee can perform essential functions in near future"]}',
  '{"temporary_suspension_max_months": 40}',
  'https://www.eeoc.gov/laws/regulations/pwfa-nprm'
),
(
  gen_random_uuid(),
  'pwfa',
  NULL,
  'PWFA — Predictable Assessments (Safe Harbor)',
  'Certain accommodations are presumed reasonable under PWFA: additional restroom breaks, sitting instead of standing, drinking water, closer parking, flexible hours for prenatal appointments.',
  '{"presumed_reasonable": ["Additional restroom breaks", "Sitting/standing changes", "Water access", "Closer parking", "Flexible scheduling for prenatal care"]}',
  NULL,
  'https://www.eeoc.gov/laws/regulations/pwfa-nprm'
),
(
  gen_random_uuid(),
  'pwfa',
  NULL,
  'PWFA — Interactive Process Requirement',
  'Employers must engage in the interactive process. Unlike ADA, PWFA has explicit provisions that workers cannot be denied accommodation pending completion of the interactive process if the need is obvious.',
  '{"key_difference": "PWFA prohibits forcing leave if reasonable alternative accommodation exists", "process": ["Good faith engagement", "Cannot require leave as only option"]}',
  '{"acknowledgment_days": 5}',
  'https://www.eeoc.gov/wysk/what-you-should-know-about-pregnant-workers-fairness-act'
),
(
  gen_random_uuid(),
  'pwfa',
  NULL,
  'PWFA — Retaliation Prohibition',
  'Employers cannot retaliate against employees who request accommodations under PWFA or oppose unlawful employment practices.',
  '{"prohibited_actions": ["Termination", "Demotion", "Denial of promotion", "Reduced hours", "Hostile work environment"]}',
  NULL,
  'https://www.eeoc.gov/wysk/what-you-should-know-about-pregnant-workers-fairness-act'
);

-- ─── California FEHA Rules (3) ────────────────────────────────────────────────

INSERT INTO acmd_compliance_rules (id, law_type, state, title, description, requirements, deadlines, source_url) VALUES
(
  gen_random_uuid(),
  'state',
  'CA',
  'CA FEHA — Broader Disability Definition',
  'California FEHA defines disability more broadly than the ADA — a condition limiting a major life activity need only be a limitation, not a substantial one. Applies to employers with 5+ employees.',
  '{"key_difference": "''Limits'' vs ''substantially limits'' in ADA", "employer_threshold": 5, "covered_conditions": "Any physical or mental condition that limits a major life activity"}',
  NULL,
  'https://calcivilrights.ca.gov/employment/disability/'
),
(
  gen_random_uuid(),
  'state',
  'CA',
  'CA FEHA — Interactive Process Mandate',
  'California requires a timely, good-faith interactive process. Failure to engage can itself constitute a violation of FEHA, independent of whether accommodation was ultimately provided.',
  '{"key_difference": "Failure to engage is independently actionable", "timeline": "Must begin within 10 business days of notice", "documentation": "Must document all steps taken"}',
  '{"initiation_days": 10, "completion_days": 30}',
  'https://calcivilrights.ca.gov/employment/disability/'
),
(
  gen_random_uuid(),
  'state',
  'CA',
  'CA FEHA — Pregnancy Disability Leave (PDL)',
  'California PDL provides up to 4 months of leave for pregnancy disability, separate from CFRA. Employers with 5+ employees must provide PDL. This is distinct from and in addition to PWFA protections.',
  '{"leave_duration_months": 4, "employer_threshold": 5, "key_difference": "Separate from CFRA; runs concurrently with FMLA if eligible", "benefits": "Employer must maintain health benefits during PDL"}',
  '{"leave_max_weeks": 17}',
  'https://calcivilrights.ca.gov/employment/pregnancy/'
);

-- ─── JAN Accommodations (10) ──────────────────────────────────────────────────

INSERT INTO acmd_jan_accommodations (id, condition, job_category, accommodation, cost_estimate, cost_range, effectiveness, description, source_url) VALUES
(
  gen_random_uuid(),
  'Chronic Back Pain',
  'Office / Sedentary',
  'Ergonomic Chair and Standing Desk',
  '$300-$800',
  'low',
  'high',
  'Adjustable ergonomic chair with lumbar support combined with a sit-stand desk allows employee to alternate positions and reduce spinal strain throughout the day.',
  'https://askjan.org/disabilities/Back-Impairment.cfm'
),
(
  gen_random_uuid(),
  'Anxiety Disorder',
  'General',
  'Modified Work Schedule / Flexible Hours',
  '$0',
  'no_cost',
  'high',
  'Allow employee to shift start/end times or work compressed schedule to reduce commute stress and allow medical appointments. Eliminates need for frequent leave requests.',
  'https://askjan.org/disabilities/Anxiety-Disorder.cfm'
),
(
  gen_random_uuid(),
  'Pregnancy',
  'Physical / Active',
  'Temporary Duty Modification (Light Duty)',
  '$0',
  'no_cost',
  'high',
  'Temporarily reassign employee to lighter tasks that do not require heavy lifting, prolonged standing, or exposure to hazardous materials during pregnancy.',
  'https://askjan.org/disabilities/Pregnancy.cfm'
),
(
  gen_random_uuid(),
  'Vision Impairment',
  'Office / Computer',
  'Screen Magnification Software',
  '$0-$600',
  'low',
  'high',
  'Software such as ZoomText or Windows Magnifier enlarges screen content. Built-in OS accessibility tools are free; enterprise solutions average $500-$600.',
  'https://askjan.org/disabilities/Vision-Impairment.cfm'
),
(
  gen_random_uuid(),
  'Hearing Loss',
  'General',
  'Visual Alerting System',
  '$150-$500',
  'low',
  'high',
  'Replace audio alerts (phone rings, alarms, intercom) with visual flashing lights or vibrating devices. Required for employees with significant hearing loss working in alert-dependent environments.',
  'https://askjan.org/disabilities/Hearing-Impairment.cfm'
),
(
  gen_random_uuid(),
  'ADHD / Attention Deficit Disorder',
  'General',
  'Private Workspace / Reduced Distractions',
  '$0-$200',
  'no_cost',
  'high',
  'Provide private office, cubicle with higher partitions, or allow remote work on focus-intensive tasks. Noise-canceling headphones ($50-$200) can supplement physical space changes.',
  'https://askjan.org/disabilities/Attention-Deficit-Hyperactivity-Disorder-ADHD.cfm'
),
(
  gen_random_uuid(),
  'Depression / Major Depressive Disorder',
  'General',
  'Modified Attendance Policy',
  '$0',
  'no_cost',
  'medium',
  'Allow flexible start times, periodic leave for mental health days, or intermittent FMLA to attend therapy appointments. Document policy change formally to avoid inconsistent enforcement.',
  'https://askjan.org/disabilities/Depression.cfm'
),
(
  gen_random_uuid(),
  'Mobility Impairment / Wheelchair User',
  'Office',
  'Accessible Parking and Workspace Modification',
  '$200-$2000',
  'moderate',
  'high',
  'Reserve accessible parking near entrance, adjust desk height (or provide adjustable desk), ensure clear pathways of at least 36 inches. May require minor construction for larger modifications.',
  'https://askjan.org/disabilities/Mobility-Impairment.cfm'
),
(
  gen_random_uuid(),
  'Diabetes',
  'General',
  'Scheduled Break Policy',
  '$0',
  'no_cost',
  'high',
  'Allow employee to take scheduled breaks to check blood sugar, eat, or take medication. Provide access to a private space (not a restroom) for insulin injections if needed.',
  'https://askjan.org/disabilities/Diabetes.cfm'
),
(
  gen_random_uuid(),
  'Post-Traumatic Stress Disorder (PTSD)',
  'General',
  'Telework / Remote Work Arrangement',
  '$0-$500',
  'no_cost',
  'high',
  'Allowing full or partial remote work removes triggering environmental factors (crowded spaces, certain sounds, supervision proximity). Home office stipend may apply ($0-$500 one-time).',
  'https://askjan.org/disabilities/Post-Traumatic-Stress-Disorder-PTSD.cfm'
);

-- ─── Demo Company ─────────────────────────────────────────────────────────────

INSERT INTO acmd_companies (
  id, name, hq_state, size, industry,
  plan_tier, subscription_status, max_states,
  settings, onboarding_completed_at, created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Acme HR Solutions (Demo)',
  'CA',
  '50-200',
  'Technology',
  'pro',
  'active',
  3,
  '{"notifications_enabled": true, "default_deadline_days": 30}',
  NOW(),
  NOW(),
  NOW()
);

-- ─── Demo Admin User ──────────────────────────────────────────────────────────

INSERT INTO acmd_users (
  id, company_id, name, email, role, created_at, updated_at
) VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Demo Admin',
  'admin@acme-demo.example.com',
  'admin',
  NOW(),
  NOW()
);

-- ─── Demo Employee ────────────────────────────────────────────────────────────

INSERT INTO acmd_employees (
  id, company_id, name, position, department, state, created_at, updated_at
) VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Jane Smith',
  'Software Engineer',
  'Engineering',
  'CA',
  NOW(),
  NOW()
);

-- ─── Sample Case 1: ADA Back Pain ─────────────────────────────────────────────

INSERT INTO acmd_cases (
  id, company_id, employee_id, assigned_to,
  status, type, request_description,
  created_at, updated_at
) VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'in_progress',
  'ada',
  'Employee requests ergonomic equipment (standing desk + ergonomic chair) due to chronic lower back pain that limits ability to sit for extended periods.',
  NOW(),
  NOW()
);

-- ─── Sample Case 2: PWFA Pregnancy Accommodation ──────────────────────────────

INSERT INTO acmd_cases (
  id, company_id, employee_id, assigned_to,
  status, type, request_description,
  created_at, updated_at
) VALUES (
  'd0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'open',
  'pwfa',
  'Employee requests flexible schedule to attend prenatal appointments and additional restroom breaks as needed during pregnancy.',
  NOW(),
  NOW()
);
