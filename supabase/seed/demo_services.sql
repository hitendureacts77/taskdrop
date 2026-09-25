-- Demo gig listings from the project's test accounts, so a poster's
-- "Services near you" has something to browse. Logged in private.demo_seed,
-- so demo_account_remove.sql takes them out with the rest.

begin;
with ins as (
  insert into public.tasks (poster_id, pillar, title, description, benchmark_minor, time_limit_minutes,
    loc_label, loc_lat, loc_lng, category, skills, difficulty, kind, created_at)
  values
    ('0204f528-4053-4838-80af-3b82f1b21701', 'services', 'I will fix leaking taps, pipes and flush tanks',
     'Plumbing repairs at home: taps, cartridges, flush tanks, small pipe leaks. Common parts carried.',
     30000, 1440, 'Kondapur, Hyderabad', 17.4700, 78.3600, 'Repairs & Maintenance', '{Repairs}', 'easy', 'service', now() - interval '3 days'),
    ('0204f528-4053-4838-80af-3b82f1b21701', 'services', 'I will assemble your IKEA or flat-pack furniture',
     'Wardrobes, beds, desks and shelves - assembled, levelled and wall-anchored.',
     60000, 1440, 'Kondapur, Hyderabad', 17.4700, 78.3600, 'Home Services', '{Carpentry}', 'medium', 'service', now() - interval '5 days'),
    ('3c96c4a3-6e40-4aa9-84dc-058be9e52e3c', 'services', 'I will deep clean your kitchen and bathrooms',
     'Two-person team, machine scrubbing, eco products. Degreasing, tiles, fittings.',
     150000, 1440, 'Madhapur, Hyderabad', 17.4480, 78.3915, 'Home Services', '{Cleaning}', 'medium', 'service', now() - interval '2 days'),
    ('3c96c4a3-6e40-4aa9-84dc-058be9e52e3c', 'services', 'I will run errands and pick up documents for you',
     'Courier collections, bank and office drop-offs, queue standing. Same-day within 10 km.',
     25000, 1440, 'Madhapur, Hyderabad', 17.4480, 78.3915, 'Errands & Delivery', '{Errands}', 'easy', 'service', now() - interval '1 day'),
    ('a96569f1-ea83-4924-b6d6-0d46574d07da', 'services', 'I will design eye-catching YouTube thumbnails',
     'Three thumbnail options per video, bold text, face cut-outs, delivered as 1280x720 PNG.',
     40000, 2880, 'Remote', null, null, 'Design & Creative', '{Design}', 'easy', 'service', now() - interval '4 days'),
    ('a96569f1-ea83-4924-b6d6-0d46574d07da', 'services', 'I will edit your reels with captions and music',
     'Up to 60 seconds, trending audio, captions and colour correction. Two rounds of changes.',
     70000, 2880, 'Remote', null, null, 'Photo & Video', '{Video editing}', 'medium', 'service', now() - interval '6 days'),
    ('311a2dd7-d530-41f1-980f-4e8f7bc1994c', 'services', 'I will tutor maths and science for classes 6-10',
     'One-hour sessions at your home or online. CBSE and State board. First session free.',
     50000, 1440, 'Gachibowli, Hyderabad', 17.4401, 78.3489, 'Tutoring & Education', '{Tutoring}', 'medium', 'service', now() - interval '8 days'),
    ('ec7ca544-48d7-403d-9f54-bcd7312abbd9', 'services', 'I will build a simple website for your business',
     'One to five pages, mobile-friendly, contact form and WhatsApp button. Hosting set-up included.',
     500000, 10080, 'Remote', null, null, 'Tech & Websites', '{Web development}', 'hard', 'service', now() - interval '10 days')
  returning id
)
insert into private.demo_seed (tbl, row_id) select 'tasks', id from ins;
commit;
