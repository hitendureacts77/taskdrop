#!/usr/bin/env node
/**
 * Builds supabase/seed/fake_world.sql: a "busy city" of fake people and tasks for testing the
 * maps, lists, quotes, ratings, nearby pulse and people map on the STAGING project only.
 *
 *   node scripts/fake-world.mjs          writes supabase/seed/fake_world.sql (same output every run)
 *
 * Then run the SQL file on staging (Supabase SQL editor or the MCP). Undo with
 * supabase/seed/fake_world_remove.sql: every fake account has an id starting `fa4e0001-`, and
 * deleting the accounts takes everything they own with them (all tables cascade from auth.users).
 *
 * The plan (10 Nov 2026):
 *   People   120: 72 in Hyderabad (36 within ~4 km of Kondapur / Hitec City), 28 in other Indian
 *            cities, 20 abroad. Half workers, a quarter posters, a quarter both. Phones 98880 00001-120
 *            (p98880000NN@phone.taskdrop.app), so with dev_otp_for_all on you can sign in as any of them.
 *   Tasks    open requests (local + remote, some urgent / topped-up / photo-wanted / City Hunt),
 *            service listings from workers, in-progress jobs with chats, and finished jobs with
 *            two-way reviews (some finished today, for the nearby pulse).
 *   Quotes   0-5 per open request, from workers in the same city (anyone for remote tasks).
 *   Map      60 people share a live spot with "Everyone nearby" for 30 days (People map layer).
 *   Online   about 40% were "seen" in the last 25 minutes at seed time (goes stale after that;
 *            run the small "freshen" block at the end of the SQL again to wake them).
 *
 * Every write runs with triggers off (session_replication_role = replica): no sign-up alerts,
 * no pushes, no Inngest events. So the file itself creates the profile, wallet, roles and age
 * check the sign-up trigger normally would, and stores public locations rounded to 2 decimals
 * with the exact spot in *_private, like migration 074 does.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ randomness (fixed seed) ----
let s = 20261110;
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const hex = (n, w = 12) => n.toString(16).padStart(w, "0");
const id = (kind, n) => `fa4e000${kind}-0000-4000-8000-${hex(n)}`;
const q = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => (a && a.length ? `'{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}'` : "'{}'");
const ago = (minutes) => `now() - interval '${Math.round(minutes)} minutes'`;
const ahead = (minutes) => `now() + interval '${Math.round(minutes)} minutes'`;
const r2 = (x) => Math.round(x * 100) / 100;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// ----------------------------------------------------------------------------------- places ----
// [label, lat, lng]. The first block is "around me": Kondapur / Hitec City / Gachibowli.
const NEAR_ME = [
  ["Kondapur, Hyderabad", 17.469, 78.364], ["Hitec City, Hyderabad", 17.4435, 78.3772],
  ["Gachibowli, Hyderabad", 17.4401, 78.3489], ["Madhapur, Hyderabad", 17.4486, 78.3908],
  ["Kothaguda, Hyderabad", 17.463, 78.372], ["Botanical Garden Rd, Hyderabad", 17.458, 78.356],
  ["Whitefields, Kondapur", 17.455, 78.367], ["Masjid Banda, Hyderabad", 17.475, 78.351],
];
const HYDERABAD = [
  ["Miyapur, Hyderabad", 17.4968, 78.3614], ["Kukatpally, Hyderabad", 17.4948, 78.3996],
  ["Jubilee Hills, Hyderabad", 17.4326, 78.4071], ["Banjara Hills, Hyderabad", 17.4156, 78.4347],
  ["Ameerpet, Hyderabad", 17.4375, 78.4482], ["Begumpet, Hyderabad", 17.4447, 78.4664],
  ["Secunderabad, Hyderabad", 17.4399, 78.4983], ["Manikonda, Hyderabad", 17.405, 78.386],
  ["Tolichowki, Hyderabad", 17.399, 78.415], ["Mehdipatnam, Hyderabad", 17.395, 78.439],
  ["Charminar, Hyderabad", 17.3616, 78.4747], ["Dilsukhnagar, Hyderabad", 17.3687, 78.5247],
  ["LB Nagar, Hyderabad", 17.3457, 78.5522], ["Uppal, Hyderabad", 17.4058, 78.5591],
  ["Kompally, Hyderabad", 17.536, 78.483], ["Nanakramguda, Hyderabad", 17.418, 78.342],
  ["Narsingi, Hyderabad", 17.388, 78.356], ["Financial District, Hyderabad", 17.414, 78.339],
  ["Chandanagar, Hyderabad", 17.495, 78.329], ["Serilingampally, Hyderabad", 17.488, 78.317],
  ["Shamshabad, Hyderabad", 17.25, 78.43], ["Bachupally, Hyderabad", 17.545, 78.385],
];
const INDIA = [
  ["Koramangala, Bengaluru", 12.9352, 77.6245], ["Indiranagar, Bengaluru", 12.9784, 77.6408],
  ["Whitefield, Bengaluru", 12.9698, 77.75], ["Andheri, Mumbai", 19.1136, 72.8697],
  ["Bandra, Mumbai", 19.0596, 72.8295], ["Saket, New Delhi", 28.5245, 77.2066],
  ["Cyber City, Gurugram", 28.495, 77.089], ["T Nagar, Chennai", 13.0418, 80.2341],
  ["Kothrud, Pune", 18.5074, 73.8077], ["Salt Lake, Kolkata", 22.5867, 88.4171],
  ["Navrangpura, Ahmedabad", 23.0365, 72.5611], ["C Scheme, Jaipur", 26.9124, 75.7873],
  ["Kakkanad, Kochi", 10.0159, 76.3419], ["MVP Colony, Visakhapatnam", 17.7417, 83.3328],
  ["Benz Circle, Vijayawada", 16.4994, 80.6567], ["Hanamkonda, Warangal", 18.0072, 79.5584],
];
const ABROAD = [
  ["Al Barsha, Dubai", 25.1124, 55.1981], ["Tampines, Singapore", 1.3496, 103.9568],
  ["Wembley, London", 51.5588, -0.2817], ["Jersey City, New Jersey", 40.7178, -74.0431],
  ["Brampton, Toronto", 43.7315, -79.7624], ["Parramatta, Sydney", -33.815, 151.0011],
  ["Mitte, Berlin", 52.52, 13.405], ["Westlands, Nairobi", -1.2676, 36.8108],
  ["Shibuya, Tokyo", 35.6595, 139.7005], ["Fremont, California", 37.5485, -121.9886],
  ["Bangsar, Kuala Lumpur", 3.1291, 101.6788], ["West Bay, Doha", 25.3283, 51.5298],
];
const jitter = ([label, lat, lng], d) => [label, lat + (rnd() - 0.5) * 2 * d, lng + (rnd() - 0.5) * 2 * d];

// ------------------------------------------------------------------------------------ names ----
const IN_FIRST = ["Aarav", "Vihaan", "Sai", "Arjun", "Karthik", "Rahul", "Srinivas", "Venkat", "Rohit", "Imran", "Faizan", "Naveen",
  "Pranav", "Harsha", "Kiran", "Suresh", "Mahesh", "Ramesh", "Anil", "Vikram", "Aditya", "Nikhil", "Sandeep", "Rakesh", "Yusuf",
  "Ananya", "Priya", "Divya", "Sneha", "Lakshmi", "Swathi", "Keerthi", "Pooja", "Bhavana", "Sana", "Ayesha", "Haritha", "Deepika",
  "Meghana", "Sravani", "Nandini", "Kavya", "Ritika", "Farah", "Shalini", "Tejaswi", "Mounika", "Anjali", "Zoya", "Revathi"];
const IN_LAST = ["Reddy", "Rao", "Sharma", "Naidu", "Goud", "Varma", "Khan", "Patel", "Iyer", "Nair", "Chowdary", "Kumar", "Shaikh",
  "Gupta", "Mehta", "Das", "Pillai", "Yadav", "Joshi", "Siddiqui", "Bose", "Menon", "Kapoor", "Singh", "Ali"];
const WORLD = ["Omar Haddad", "Mei Lin Tan", "James Carter", "Sofia Rossi", "Liam O'Brien", "Hana Sato", "Lukas Becker", "Amara Okafor",
  "Daniel Kim", "Fatima Al Mansoori", "Grace Wanjiru", "Ethan Brooks", "Nur Aisyah", "Chloe Martin"];

// ------------------------------------------------------------------------- skills by category ----
const SKILLS = {
  "Home Services": ["Cleaning", "Cooking", "Moving help", "Pet care", "Gardening"],
  "Repairs & Maintenance": ["Plumbing", "Electrical", "Carpentry", "Painting", "AC repair", "Mobile repair"],
  "Errands & Delivery": ["Errands", "Delivery", "Driving"],
  "Shopping & Sourcing": ["Shopping", "Errands"],
  "Local Checks & Info": ["Errands", "Photography"],
  "Tech & Websites": ["Web development", "WordPress", "App testing"],
  "Design & Creative": ["Design", "Logo design", "Canva"],
  "Writing & Content": ["Writing", "Translation", "Proofreading"],
  "Photo & Video": ["Photography", "Video editing"],
  "Tutoring & Education": ["Tutoring", "Maths", "Spoken English"],
  "Career & Resume": ["Resume writing", "Interview prep"],
  "Business & Consulting": ["Excel", "GST filing", "Bookkeeping"],
  "Events & Planning": ["Event planning", "Decoration"],
  "Admin & Data Entry": ["Data entry", "Excel"],
};
const pillarFor = (c) => (c === "Shopping & Sourcing" ? "procurement" : c === "Local Checks & Info" ? "local_intel" : "services");

// [category, title, price range in rupees, remote?, difficulty]
const LOCAL_REQUESTS = [
  ["Repairs & Maintenance", "Fix a leaking bathroom tap", [300, 700]], ["Repairs & Maintenance", "Replace two ceiling fan regulators", [400, 900]],
  ["Repairs & Maintenance", "AC service before summer (split, 1.5 ton)", [600, 1200]], ["Repairs & Maintenance", "Fix a jammed bedroom door lock", [300, 600]],
  ["Repairs & Maintenance", "Paint one accent wall in the living room", [2500, 5000]], ["Repairs & Maintenance", "Mount a 55-inch TV on the wall", [500, 1000]],
  ["Repairs & Maintenance", "Install 4 curtain rods", [400, 800]], ["Repairs & Maintenance", "Repair a cracked phone screen (pick up and drop)", [1500, 3500]],
  ["Repairs & Maintenance", "Fix the geyser that trips the switch", [500, 1200]], ["Repairs & Maintenance", "Assemble a study table and chair", [600, 1200]],
  ["Home Services", "Deep clean a 2BHK before Diwali", [2500, 4500]], ["Home Services", "Clean the kitchen chimney and stove", [800, 1500]],
  ["Home Services", "Help pack a 1BHK for moving", [1500, 3000]], ["Home Services", "Walk my dog twice a day this week", [1200, 2500]],
  ["Home Services", "Cook lunch for a small house party (8 people)", [2000, 4000]], ["Home Services", "Water plants while I travel (5 days)", [500, 1000]],
  ["Home Services", "Balcony garden set-up with 10 pots", [1500, 3000]], ["Home Services", "Sofa shampoo cleaning (3+2 seater)", [1000, 1800]],
  ["Errands & Delivery", "Pick up documents from Ameerpet and drop at Hitec City", [250, 500]], ["Errands & Delivery", "Collect a parcel from the courier office", [200, 400]],
  ["Errands & Delivery", "Stand in queue at the RTO for a slot", [500, 900]], ["Errands & Delivery", "Drop a birthday cake before 7 pm", [250, 450]],
  ["Errands & Delivery", "Drive my car to the service centre and back", [600, 1000]], ["Errands & Delivery", "Get medicines from Apollo pharmacy", [150, 300]],
  ["Shopping & Sourcing", "Buy fresh vegetables from Rythu Bazar", [200, 400]], ["Shopping & Sourcing", "Find a second-hand cycle under Rs 5,000", [300, 600]],
  ["Shopping & Sourcing", "Pick 20 sarees from Begum Bazaar for a function", [800, 1500]], ["Shopping & Sourcing", "Compare prices for a fridge at 3 local shops", [400, 800]],
  ["Local Checks & Info", "Check if a PG near Gachibowli is as shown in photos", [300, 600]], ["Local Checks & Info", "Visit a plot in Shamshabad and send photos", [800, 1500]],
  ["Local Checks & Info", "Is the new cafe at Jubilee Hills open on Monday?", [100, 200]], ["Local Checks & Info", "Check the queue at the passport office now", [150, 300]],
  ["Photo & Video", "Shoot photos at a small birthday party (2 hours)", [2000, 4000]], ["Photo & Video", "Product photos for 15 handmade candles", [1500, 3000]],
  ["Tutoring & Education", "Maths tuition for class 8 (3 days a week)", [3000, 6000]], ["Tutoring & Education", "Spoken English practice for my mother", [2000, 4000]],
  ["Events & Planning", "Decorate a room for a baby shower", [2500, 5000]], ["Events & Planning", "Arrange a small Satyanarayana pooja set-up", [1500, 3000]],
];
const REMOTE_REQUESTS = [
  ["Design & Creative", "Design a logo for a cloud kitchen", [1500, 4000]], ["Design & Creative", "Make 10 Instagram post templates", [1200, 3000]],
  ["Design & Creative", "Wedding invitation card design (Telugu + English)", [1000, 2500]], ["Writing & Content", "Write 5 blog posts about home loans", [2500, 5000]],
  ["Writing & Content", "Translate a 4-page brochure to Telugu", [1000, 2000]], ["Writing & Content", "Proofread my college project report", [500, 1200]],
  ["Tech & Websites", "Fix my WordPress site that shows a white screen", [1500, 3500]], ["Tech & Websites", "Build a one-page website for a yoga studio", [4000, 9000]],
  ["Tech & Websites", "Test my Android app and list the bugs", [1500, 3000]], ["Photo & Video", "Edit a 3-minute travel vlog", [1200, 2500]],
  ["Photo & Video", "Remove background from 50 product photos", [500, 1200]], ["Career & Resume", "Rewrite my resume for a data analyst job", [800, 1800]],
  ["Career & Resume", "Mock interview for a Java developer role", [1000, 2000]], ["Business & Consulting", "Set up a GST invoice template in Excel", [800, 1500]],
  ["Business & Consulting", "Make a simple monthly budget sheet", [500, 1000]], ["Admin & Data Entry", "Type 40 handwritten pages into Word", [1200, 2500]],
  ["Admin & Data Entry", "Clean up a 2,000-row customer list in Excel", [800, 1500]], ["Tutoring & Education", "Online Python classes for a beginner", [3000, 6000]],
];
const SERVICES = [
  ["Repairs & Maintenance", "I will fix taps, pipes and flush tanks", [300, 600], false], ["Repairs & Maintenance", "I will service your split or window AC", [500, 900], false],
  ["Repairs & Maintenance", "I will do electrical work: fans, lights, switches", [300, 700], false], ["Repairs & Maintenance", "I will assemble flat-pack furniture", [500, 1200], false],
  ["Repairs & Maintenance", "I will paint rooms and touch up walls", [2000, 6000], false], ["Repairs & Maintenance", "I will repair mobile screens at your door", [1200, 3000], false],
  ["Home Services", "I will deep clean kitchens and bathrooms", [1200, 2500], false], ["Home Services", "I will cook home-style meals for parties", [1500, 4000], false],
  ["Home Services", "I will walk and feed your pets", [300, 600], false], ["Home Services", "I will set up and care for balcony gardens", [800, 2000], false],
  ["Errands & Delivery", "I will run errands and same-day drops in the city", [200, 500], false], ["Errands & Delivery", "I will drive your car (hourly driver)", [300, 600], false],
  ["Photo & Video", "I will shoot events and portraits", [2500, 6000], false], ["Tutoring & Education", "I will tutor maths and science (class 6-10)", [400, 800], false],
  ["Events & Planning", "I will decorate for birthdays and baby showers", [2500, 6000], false],
  ["Design & Creative", "I will design a logo with 3 options", [1500, 4000], true], ["Design & Creative", "I will make social media posts for your brand", [1000, 3000], true],
  ["Writing & Content", "I will write SEO blog posts", [600, 1500], true], ["Writing & Content", "I will translate English to Telugu or Hindi", [500, 1500], true],
  ["Tech & Websites", "I will build a small business website", [5000, 15000], true], ["Photo & Video", "I will edit reels with captions and music", [600, 1500], true],
  ["Career & Resume", "I will rewrite your resume and LinkedIn", [800, 2000], true], ["Business & Consulting", "I will do your bookkeeping in Excel or Tally", [1500, 4000], true],
  ["Admin & Data Entry", "I will do fast, accurate data entry", [500, 1500], true],
];
const QUOTE_LINES = ["I can come today evening.", "Done this many times, tools with me.", "Can start tomorrow morning.", "Near you, 10 minutes away.",
  "Happy to chat first and agree the details.", "I have 5-star reviews for this work.", "Slightly lower price if I can come after 6 pm.",
  "Will send photos when done.", "Available this weekend.", "I can finish it within the day."];
const REVIEW_WORKER = ["Quick and careful. Would hire again.", "On time and polite.", "Did a neat job, cleaned up after.", "Good work, small delay but kept me updated.",
  "Excellent, went beyond what I asked.", "Fair price and honest.", "Okay job, needed one more round."];
const REVIEW_POSTER = ["Clear brief and paid fast.", "Friendly, easy to work with.", "Good communication.", "Instructions were clear.", "Would work for them again."];
const CHAT = [["Hi! Details are in the task. Call me when you reach.", "Sure, on my way."], ["Can you bring your own tools?", "Yes, I have everything."],
  ["Is 5 pm okay?", "5 pm works, see you then."], ["Please send a photo once done.", "Will do."]];

// ------------------------------------------------------------------------------------ people ----
const people = [];
let phone = 0;
function person(place, region, opts = {}) {
  phone += 1;
  const n = phone;
  const isWorld = region === "abroad" && chance(0.5);
  const name = opts.name ?? (isWorld ? WORLD[n % WORLD.length] : `${pick(IN_FIRST)} ${pick(IN_LAST)}`);
  const role = opts.role ?? (chance(0.5) ? "earn" : chance(0.5) ? "post" : "both");
  const cats = shuffle(Object.keys(SKILLS)).slice(0, int(1, 3));
  const skills = role === "post" ? [] : [...new Set(cats.flatMap((c) => SKILLS[c]).slice(0, int(2, 5)))];
  const [label, lat, lng] = place;
  const online = chance(region === "abroad" ? 0.2 : 0.45);
  people.push({
    n, id: id(1, n), phone: `98880${String(n).padStart(5, "0")}`, name, region, role, skills, cats, label, lat: r6(lat), lng: r6(lng),
    seenMin: online ? int(0, 25) : int(60, 60 * 24 * 12),
    createdMin: int(60 * 24 * 3, 60 * 24 * 120),
    username: `${name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}_${n}`.slice(0, 20),
  });
}
for (let i = 0; i < 36; i++) person(jitter(pick(NEAR_ME), 0.006), "near");
for (let i = 0; i < 36; i++) person(jitter(pick(HYDERABAD), 0.008), "hyd");
for (let i = 0; i < 28; i++) person(jitter(pick(INDIA), 0.01), "india");
for (let i = 0; i < 20; i++) person(jitter(pick(ABROAD), 0.01), "abroad");

const workers = people.filter((p) => p.role !== "post");
const posters = people.filter((p) => p.role !== "earn");
const cityOf = (p) => (p.region === "near" || p.region === "hyd" ? "Hyderabad" : p.label.split(", ").pop());
const sameCity = (a, b) => cityOf(a) === cityOf(b);
const km = (a, b) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const workersFor = (t, poster) => workers.filter((w) => w.id !== poster.id && (t.remote ? true : sameCity(w, poster) && km(w, t) < 25));

// ------------------------------------------------------------------------------------- tasks ----
const tasks = [], bids = [], payments = [], assignments = [], reviews = [], messages = [];
let tn = 0, bn = 0, pn = 0, an = 0;
const price = ([lo, hi]) => Math.round(int(lo, hi) / 50) * 50 * 100;

function makeTask(poster, tpl, opts) {
  tn += 1;
  const [category, title, range, remoteSvc] = tpl;
  const remote = opts.remote ?? remoteSvc ?? false;
  const spot = remote ? null : jitter([poster.label, poster.lat, poster.lng], 0.004);
  const t = {
    id: id(2, tn), poster, category, title, remote, kind: opts.kind ?? "request", status: opts.status ?? "OPEN",
    price: price(range), label: remote ? "Remote" : spot[0], lat: remote ? null : r6(spot[1]), lng: remote ? null : r6(spot[2]),
    createdMin: opts.createdMin ?? int(10, 60 * 24 * 6), flag: "none", dueMin: null, topup: null, photos: false, hunt: null,
    skills: (SKILLS[category] ?? []).slice(0, 2), difficulty: pick(["easy", "easy", "medium", "hard"]),
  };
  tasks.push(t);
  return t;
}

// Open requests: Hyderabad-heavy, then other cities, abroad, and remote.
const posterIn = (regions) => posters.filter((p) => regions.includes(p.region));
const plan = [[["near"], 60], [["hyd"], 45], [["india"], 35], [["abroad"], 16]];
for (const [regions, count] of plan) {
  const pool = posterIn(regions);
  for (let i = 0; i < count; i++) {
    const t = makeTask(pick(pool), pick(LOCAL_REQUESTS), { remote: false });
    if (chance(0.12)) t.flag = "urgent";
    if (chance(0.5)) t.dueMin = t.flag === "urgent" ? int(120, 600) : int(60 * 24, 60 * 24 * 10);
    if (chance(0.1)) t.topup = pick([5, 10, 15]);
    if (chance(0.15)) t.photos = true;
  }
}
for (let i = 0; i < 30; i++) {
  const t = makeTask(pick(posters), pick(REMOTE_REQUESTS), { remote: true });
  if (chance(0.4)) t.dueMin = int(60 * 24 * 2, 60 * 24 * 14);
}
// City Hunts in Hyderabad (migration 158): "find it, snap it, price it".
const HUNTS = [["Shopping & Sourcing", "Find a shop selling Irani chai cups in bulk", [300, 600]], ["Local Checks & Info", "Find the cheapest cylinder refill near Kondapur", [150, 300]],
  ["Shopping & Sourcing", "Where can I buy a cricket kit under Rs 3,000?", [200, 400]], ["Local Checks & Info", "Find a tailor who can stitch a blazer in 3 days", [200, 500]]];
for (const h of HUNTS) {
  const t = makeTask(pick(posterIn(["near", "hyd"])), h, { remote: false, createdMin: int(10, 120) });
  t.hunt = { window: "today", untilMin: int(240, 600), needs: ["photo", "place", "price"] };
}
// Quotes on open requests.
for (const t of tasks.filter((x) => x.status === "OPEN" && x.kind === "request" && !x.hunt)) {
  const pool = shuffle(workersFor(t, t.poster)).slice(0, int(0, 5));
  for (const w of pool) {
    bn += 1;
    bids.push({ id: id(3, bn), task: t, worker: w, price: Math.max(5000, Math.round((t.price * (0.8 + rnd() * 0.4)) / 5000) * 5000),
      minutes: pick([240, 720, 1440, 2880]), message: pick(QUOTE_LINES), locked: false, createdMin: Math.max(1, t.createdMin - int(1, Math.max(2, t.createdMin))) });
  }
}
// Service listings from workers.
for (const w of workers) {
  const n = w.region === "abroad" ? int(0, 1) : int(0, 2);
  const mine = SERVICES.filter((sv) => w.cats.includes(sv[0]));
  for (const sv of shuffle(mine.length ? mine : SERVICES).slice(0, n)) {
    const t = makeTask(w, sv, { kind: "service", createdMin: int(60, 60 * 24 * 30) });
    t.dueMin = null;
  }
}

// Jobs that were hired: in progress and finished.
function hire(t, w, status) {
  bn += 1; pn += 1; an += 1;
  const b = { id: id(3, bn), task: t, worker: w, price: t.price, minutes: 1440, message: pick(QUOTE_LINES), locked: true, createdMin: t.createdMin - 5 };
  bids.push(b);
  t.status = status; t.worker = w; t.bid = b; t.payment = id(4, pn);
  const escrow = Math.round(t.price * 1.03);
  payments.push({ id: t.payment, user: t.poster, task: t, amount: escrow, paidMin: t.createdMin - 10 });
  assignments.push({ id: id(5, an), task: t, bid: b, worker: w, escrow,
    status: status === "LOCKED" ? "assigned" : ["COMPLETED", "AUTO_COMPLETED"].includes(status) ? "released" : "started" });
  t.escrow = escrow;
}
const IN_PROGRESS = ["LOCKED", "TASK_STARTED", "TASK_STARTED", "WORK_DONE", "REVISION_REQUESTED", "OVERDUE"];
for (let i = 0; i < 24; i++) {
  const poster = pick(posters.filter((p) => p.region !== "abroad"));
  const t = makeTask(poster, pick(LOCAL_REQUESTS.concat(REMOTE_REQUESTS)), { createdMin: int(60 * 24, 60 * 24 * 4) });
  t.remote = t.lat === null;
  const ws = workersFor(t, poster);
  if (!ws.length) { tasks.pop(); continue; }
  hire(t, pick(ws), IN_PROGRESS[i % IN_PROGRESS.length]);
  const c = pick(CHAT);
  messages.push({ task: t, from: poster, body: c[0], min: t.createdMin - 30 }, { task: t, from: t.worker, body: c[1], min: t.createdMin - 40 });
}
// Finished jobs: 160 over the last 60 days, 14 of them today (nearby pulse), with reviews both ways.
for (let i = 0; i < 160; i++) {
  const poster = pick(posters);
  const today = i < 14;
  const doneMin = today ? int(20, 600) : int(60 * 24, 60 * 24 * 60);
  const t = makeTask(poster, pick(poster.region === "abroad" ? REMOTE_REQUESTS : LOCAL_REQUESTS.concat(REMOTE_REQUESTS)), { createdMin: doneMin + int(60 * 6, 60 * 24 * 3) });
  if (today && poster.region !== "abroad" && t.remote) { /* keep remote too */ }
  const ws = workersFor(t, poster);
  if (!ws.length) { tasks.pop(); continue; }
  hire(t, pick(ws), chance(0.85) ? "COMPLETED" : "AUTO_COMPLETED");
  t.doneMin = doneMin;
  if (t.status === "COMPLETED" || chance(0.5)) {
    reviews.push({ task: t, author: poster, subject: t.worker, role: "worker", rating: pick([5, 5, 5, 4, 4, 3]), comment: pick(REVIEW_WORKER), min: doneMin - 30 });
  }
  if (chance(0.6)) reviews.push({ task: t, author: t.worker, subject: poster, role: "poster", rating: pick([5, 5, 4, 4, 3]), comment: pick(REVIEW_POSTER), min: doneMin - 60 });
}
// A few cancelled ones for history views.
for (let i = 0; i < 8; i++) makeTask(pick(posters), pick(LOCAL_REQUESTS), { status: "CANCELLED", createdMin: int(60 * 24 * 2, 60 * 24 * 20) });

// --------------------------------------------------------------------------------------- SQL ----
const out = [];
const w = (x) => out.push(x);
const values = (rowsSql) => rowsSql.join(",\n");

w(`-- GENERATED by scripts/fake-world.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand: change the script and run it again.
-- Fake people and tasks for the STAGING project (wjxvingpfbfvkfqhrguj). NEVER run on production.
-- ${people.length} people, ${tasks.length} tasks, ${bids.length} quotes, ${reviews.length} reviews. Undo: supabase/seed/fake_world_remove.sql
-- Every fake account id starts with fa4e0001-; phones 9888000001..${people[people.length - 1].phone}.

begin;
set local session_replication_role = replica;  -- no triggers: no sign-up alerts, pushes or events

delete from auth.users where id::text like 'fa4e0001-%';
`);

const ppl = people.map((p) => `(${q(p.id)}, ${q(`p${p.phone}@phone.taskdrop.app`)}, ${q(p.name)}, ${q(p.phone)}, ${p.createdMin})`);
w(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, now(),
  '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', v.name, 'phone', v.phone),
  now() - make_interval(mins => v.m), now(), '', '', '', ''
from (values
${values(ppl)}
) as v(id, email, name, phone, m);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.email, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u where u.id::text like 'fa4e0001-%';
`);

const prof = people.map((p) => {
  const bio = p.role === "post" ? "Fake test account. Posts tasks now and then." : `Fake test account. ${p.skills.slice(0, 3).join(", ")} - happy to help nearby.`;
  return `(${q(p.id)}, ${q(p.name)}, ${q(p.username)}, ${q(bio)}, ${q(p.role)}, ${arr(p.skills)}, ${q(p.label)}, ${r2(p.lat)}, ${r2(p.lng)}, ${p.seenMin}, ${p.createdMin}, ${p.role !== "post"})`;
});
w(`insert into public.profiles (id, display_name, username, bio, intent, skills, languages, loc_label, loc_lat, loc_lng,
  last_seen_at, created_at, updated_at, onboarded_at, worker_onboarded_at, worker_bio)
select v.id::uuid, v.name, v.username, v.bio, v.intent, v.skills::text[], '{English,Hindi,Telugu}', v.label, v.lat, v.lng,
  now() - make_interval(mins => v.seen), now() - make_interval(mins => v.m), now(), now() - make_interval(mins => v.m),
  case when v.w then now() - make_interval(mins => v.m) end, case when v.w then v.bio end
from (values
${values(prof)}
) as v(id, name, username, bio, intent, skills, label, lat, lng, seen, m, w);

insert into public.profile_private (user_id, loc_lat, loc_lng) values
${values(people.map((p) => `(${q(p.id)}, ${p.lat}, ${p.lng})`))};

insert into public.wallets (user_id, balance_minor, clearing_minor, credits_minor)
select id, case when intent = 'earn' then 0 else 200000 end, 0, 0 from public.profiles where id::text like 'fa4e0001-%';
insert into public.user_roles (user_id, role)
select id, r::public.app_role from public.profiles, unnest(array['poster','worker']) r where id::text like 'fa4e0001-%' on conflict do nothing;
insert into public.age_checks (user_id, birth_date, passed, min_age)
select id, date '1994-03-21' + ((hashtext(id::text) % 3000 + 3000) % 3000), true, 18 from public.profiles where id::text like 'fa4e0001-%'
on conflict (user_id) do nothing;
`);

const taskRows = tasks.map((t) => {
  const due = t.dueMin === null ? "null" : ahead(t.dueMin);
  const st = t.status;
  const hired = Boolean(t.worker);
  const started = ["TASK_STARTED", "OVERDUE", "WORK_DONE", "REVISION_REQUESTED", "COMPLETED", "AUTO_COMPLETED"].includes(st);
  const done = ["WORK_DONE", "REVISION_REQUESTED", "COMPLETED", "AUTO_COMPLETED"].includes(st);
  const finished = ["COMPLETED", "AUTO_COMPLETED"].includes(st);
  const descr = t.kind === "service"
    ? `${t.title}. Fake listing for testing. Message me with what you need and when.`
    : `${t.title}. ${t.remote ? "Can be done from anywhere." : `Location: ${t.label}.`} Fake task for testing - nothing will be paid.`;
  return `(${q(t.id)}, ${q(t.poster.id)}, ${q(pillarFor(t.category))}, ${q(t.title)}, ${q(descr)}, ${t.price}, ${q(st)}, ${q(t.flag)}, ` +
    `${q(t.label)}, ${t.lat === null ? "null" : r2(t.lat)}, ${t.lng === null ? "null" : r2(t.lng)}, ${q(t.kind)}, ${q(t.category)}, ${arr(t.skills)}, ${q(t.difficulty)}, ` +
    `${st === "OVERDUE" ? ago(60 * 10) : due}, ${ago(t.createdMin)}, ${hired ? q(t.bid.id) : "null"}, ${hired ? t.price : "null"}, ` +
    `${hired ? ago(t.createdMin - 10) : "null"}, ${hired ? q(t.payment) : "null"}, ${hired ? "'payment'" : "null"}, ${hired ? t.escrow : "null"}, ` +
    `${started ? ago(Math.max(5, (t.doneMin ?? 60) + 120)) : "null"}, ${done ? ago(Math.max(1, (t.doneMin ?? 30) + 30)) : "null"}, ` +
    `${["WORK_DONE", "REVISION_REQUESTED"].includes(st) ? ahead(60 * 48) : "null"}, ${finished ? ago(t.doneMin) : "null"}, ${finished ? (t.doneMin > 60 * 24 * 7 ? ago(t.doneMin - 60 * 24 * 7) : ahead(60 * 24 * 7 - t.doneMin)) : "null"}, ` +
    `${finished && t.doneMin > 60 * 24 * 7 ? ago(t.doneMin - 60 * 24 * 7) : "null"}, ${t.topup ?? 0}, ${t.photos}, ` +
    `${t.hunt ? q(t.hunt.window) : "null"}, ${t.hunt ? ahead(t.hunt.untilMin) : "null"}, ${t.hunt ? arr(t.hunt.needs) : "null"})`;
});
w(`insert into public.tasks (id, poster_id, pillar, title, description, benchmark_minor, status, flag, loc_label, loc_lat, loc_lng, kind, category,
  skills, difficulty, due_at, created_at, locked_bid_id, locked_minor, funded_at, funding_payment_id, funded_via, funded_minor,
  started_at, work_done_at, auto_complete_at, completed_at, clear_at, cleared_at, topup_pct, want_photos, hunt_window, hunt_until, hunt_needs,
  time_limit_minutes, payout_mode, assignment_mode, updated_at)
select v.id::uuid, v.poster::uuid, v.pillar::public.pillar, v.title, v.d, v.price, v.st::public.task_status, v.flag::public.task_flag, v.label, v.lat, v.lng,
  v.kind, v.cat, v.skills::text[], v.diff, v.due, v.created, v.bid::uuid, v.locked, v.funded, v.pay::uuid, v.via, v.fmin,
  v.started, v.wdone, v.auto, v.completed, v.clear_at, v.cleared, v.topup, v.photos, v.hw, v.hu, v.hn::text[],
  2880, 'one_time', 'bids', now()
from (values
${values(taskRows)}
) as v(id, poster, pillar, title, d, price, st, flag, label, lat, lng, kind, cat, skills, diff, due, created, bid, locked, funded, pay, via, fmin,
       started, wdone, auto, completed, clear_at, cleared, topup, photos, hw, hu, hn);

insert into public.task_private (task_id, loc_lat, loc_lng) values
${values(tasks.filter((t) => t.lat !== null).map((t) => `(${q(t.id)}, ${t.lat}, ${t.lng})`))};
`);

w(`insert into public.bids (id, task_id, worker_id, price_minor, time_limit_minutes, message, is_locked, created_at) values
${values(bids.map((b) => `(${q(b.id)}, ${q(b.task.id)}, ${q(b.worker.id)}, ${b.price}, ${b.minutes}, ${q(b.message)}, ${b.locked}, ${ago(b.createdMin)})`))};

insert into public.payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at) values
${values(payments.map((p) => `(${q(p.id)}, ${q(p.user.id)}, ${q(p.task.id)}, 'escrow', ${p.amount}, 'paid', 'seed', ${ago(p.paidMin)}, ${ago(p.paidMin)})`))};

insert into public.assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode) values
${values(assignments.map((a) => `(${q(a.id)}, ${q(a.task.id)}, ${q(a.bid.id)}, ${q(a.worker.id)}, '${a.status}', ${a.escrow}, 'one_time')`))};

insert into public.messages (task_id, sender_id, body, created_at) values
${values(messages.map((m) => `(${q(m.task.id)}, ${q(m.from.id)}, ${q(m.body)}, ${ago(m.min)})`))};

insert into public.task_proofs (task_id, worker_id, summary)
select id, (select worker_id from public.assignments a where a.task_id = t.id), 'Finished as agreed. Photos in the chat.'
from public.tasks t where t.id::text like 'fa4e0002-%' and t.status in ('WORK_DONE','REVISION_REQUESTED','COMPLETED','AUTO_COMPLETED');

insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment, created_at) values
${values(reviews.map((r) => `(${q(r.task.id)}, ${q(r.author.id)}, ${q(r.subject.id)}, '${r.role}', ${r.rating}, ${q(r.comment)}, ${ago(Math.max(1, r.min))})`))};

update public.profiles p set
  worker_rating_avg   = coalesce((select round(avg(rating), 2) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'), 0),
  worker_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'),
  poster_rating_avg   = coalesce((select round(avg(rating), 2) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster'), 0),
  poster_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster')
where p.id::text like 'fa4e0001-%';
`);

// People map: 60 sharers on "Everyone nearby", spots live for 30 days.
const sharers = shuffle(people.filter((p) => p.region !== "abroad")).slice(0, 52).concat(people.filter((p) => p.region === "abroad").slice(0, 8));
const snap = (x) => Math.round(Math.round(x / 0.005) * 0.005 * 1000) / 1000;
w(`insert into public.map_sharing (user_id, share_live, notice_version, consented_at, audience, audience_at, updated_at) values
${values(sharers.map((p) => `(${q(p.id)}, true, 'v2', now(), 'everyone', now(), now())`))};
insert into public.map_spots (user_id, cell_lat, cell_lng, updated_at, expires_at) values
${values(sharers.map((p) => `(${q(p.id)}, ${snap(p.lat)}, ${snap(p.lng)}, now(), now() + interval '30 days')`))};

commit;

-- Freshen: run this alone any time to make ~40% of the fake people "online now" and keep their map spots alive.
-- update public.profiles set last_seen_at = now() - make_interval(mins => (abs(hashtext(id::text)) % 25))
--  where id::text like 'fa4e0001-%' and abs(hashtext(id::text)) % 5 < 2;
-- update public.map_spots set updated_at = now(), expires_at = now() + interval '30 days' where user_id::text like 'fa4e0001-%';
`);

writeFileSync(join(root, "supabase/seed/fake_world.sql"), out.join("\n"));
writeFileSync(join(root, "supabase/seed/fake_world_remove.sql"), `-- Removes everything supabase/seed/fake_world.sql made (staging only).
-- Deleting the fake accounts cascades to their profiles, wallets, tasks, quotes, payments, chats, reviews and map spots.
begin;
delete from auth.users where id::text like 'fa4e0001-%';
commit;
`);
const by = (f) => tasks.filter(f).length;
console.log(`people ${people.length} (workers ${workers.length}, posters ${posters.length}); tasks ${tasks.length}: open requests ${by((t) => t.status === "OPEN" && t.kind === "request")}, ` +
  `services ${by((t) => t.kind === "service")}, in progress ${by((t) => t.worker && !["COMPLETED", "AUTO_COMPLETED"].includes(t.status))}, finished ${by((t) => ["COMPLETED", "AUTO_COMPLETED"].includes(t.status))}; ` +
  `quotes ${bids.length}; reviews ${reviews.length}; map sharers ${sharers.length}`);
