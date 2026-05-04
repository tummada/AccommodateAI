-- Seed: JAN (Job Accommodation Network) accommodation data
-- ACMD-026: At least 20 records covering mobility, vision, hearing, cognitive, mental health, pregnancy
-- Source: https://askjan.org

INSERT INTO acmd_jan_accommodations (condition, job_category, accommodation, cost_estimate, cost_range, effectiveness, description, source_url)
VALUES
-- MOBILITY (4 records)
('mobility', 'office', 'Ergonomic Adjustable Desk', '$200-$600', 'low', 'high',
 'Height-adjustable sit-stand desk allowing position changes throughout the day. Reduces strain for employees with mobility impairments or chronic pain.',
 'https://askjan.org/solutions/Adjustable-Desks.cfm'),

('mobility', 'office', 'Motorized Wheelchair-Accessible Workstation', '$1500-$3000', 'high', 'high',
 'Workstation designed for wheelchair users with lowered desk height, accessible storage, and clear knee space.',
 'https://askjan.org/solutions/Workstation-Access.cfm'),

('mobility', 'warehouse', 'Electric Sit-Down Forklift', '$5000+', 'high', 'high',
 'Replace stand-up forklift with sit-down model for employees with lower-body mobility limitations.',
 'https://askjan.org/solutions/Material-Handling.cfm'),

('mobility', NULL, 'Flexible Schedule for Physical Therapy', '$0', 'no_cost', 'high',
 'Modify work schedule to allow attendance at regular physical therapy sessions without loss of pay or position.',
 'https://askjan.org/solutions/Flexible-Schedules.cfm'),

-- VISION (4 records)
('vision', 'office', 'Screen Magnification Software', '$0-$300', 'low', 'high',
 'Software like ZoomText or Windows Magnifier to enlarge on-screen content for employees with low vision.',
 'https://askjan.org/solutions/Screen-Magnification-Software.cfm'),

('vision', 'office', 'Screen Reader Software (JAWS/NVDA)', '$0-$1000', 'low', 'high',
 'Text-to-speech software that reads aloud screen content. NVDA is free; JAWS is commercial with more features.',
 'https://askjan.org/solutions/Screen-Reading-Software.cfm'),

('vision', 'customer_service', 'Large Print Materials', '$50-$200', 'low', 'medium',
 'Provide large-print versions of reference materials, manuals, and forms used in daily work.',
 'https://askjan.org/solutions/Large-Print.cfm'),

('vision', NULL, 'Task Lighting and Glare Reduction', '$20-$100', 'low', 'medium',
 'Adjustable desk lamp with anti-glare screen filter to optimize lighting conditions for visual impairments.',
 'https://askjan.org/solutions/Lighting.cfm'),

-- HEARING (3 records)
('hearing', 'office', 'Captioned Telephone (CapTel)', '$75-$200', 'low', 'high',
 'Phone that displays real-time captions of the conversation for employees who are hard of hearing.',
 'https://askjan.org/solutions/Captioned-Telephones.cfm'),

('hearing', NULL, 'Visual/Vibrating Alerts', '$20-$100', 'low', 'high',
 'Replace auditory alarms and notifications with visual flashing lights or vibrating pagers.',
 'https://askjan.org/solutions/Visual-Alerts.cfm'),

('hearing', 'office', 'Video Relay Service (VRS) for Meetings', '$0', 'no_cost', 'high',
 'Free federally-funded service providing sign language interpreters via video for phone calls and meetings.',
 'https://askjan.org/solutions/Video-Relay-Services.cfm'),

-- COGNITIVE (3 records)
('cognitive', 'office', 'Task Management Software', '$0-$50/month', 'low', 'medium',
 'Apps like Todoist, Trello, or built-in reminders to help organize tasks and reduce cognitive load.',
 'https://askjan.org/solutions/Memory-Aids.cfm'),

('cognitive', NULL, 'Written Job Instructions', '$0', 'no_cost', 'high',
 'Provide clear, step-by-step written instructions for job duties instead of relying on verbal-only communication.',
 'https://askjan.org/solutions/Written-Instructions.cfm'),

('cognitive', 'warehouse', 'Color-Coded Organization System', '$50-$200', 'low', 'medium',
 'Use color-coded labels, bins, and floor markings to simplify navigation and reduce decision fatigue.',
 'https://askjan.org/solutions/Color-Coding.cfm'),

-- MENTAL HEALTH (3 records)
('mental_health', NULL, 'Flexible Work Schedule', '$0', 'no_cost', 'high',
 'Allow flexible start/end times or compressed work weeks to accommodate therapy appointments and manage symptoms.',
 'https://askjan.org/solutions/Flexible-Schedules.cfm'),

('mental_health', 'office', 'Private Workspace or Quiet Room', '$0-$500', 'low', 'high',
 'Provide access to a private, quiet space for breaks during periods of anxiety or sensory overload.',
 'https://askjan.org/solutions/Quiet-Room.cfm'),

('mental_health', NULL, 'Modified Break Schedule', '$0', 'no_cost', 'medium',
 'Allow additional short breaks throughout the day to manage stress, take medication, or use coping techniques.',
 'https://askjan.org/solutions/Break-Schedules.cfm'),

-- PREGNANCY / PWFA (3 records)
('pregnancy', NULL, 'Modified Work Schedule', '$0', 'no_cost', 'high',
 'Adjust hours to accommodate prenatal appointments, morning sickness, or fatigue. Required under PWFA.',
 'https://askjan.org/solutions/Flexible-Schedules.cfm'),

('pregnancy', 'warehouse', 'Temporary Light Duty Assignment', '$0', 'no_cost', 'high',
 'Reassign to tasks that do not require heavy lifting (over 20 lbs) during pregnancy per PWFA.',
 'https://askjan.org/solutions/Light-Duty.cfm'),

('pregnancy', 'office', 'Ergonomic Support (Footrest + Lumbar)', '$30-$100', 'low', 'medium',
 'Provide footrest and lumbar support cushion for desk workers experiencing pregnancy-related discomfort.',
 'https://askjan.org/solutions/Ergonomic-Equipment.cfm')

ON CONFLICT DO NOTHING;
