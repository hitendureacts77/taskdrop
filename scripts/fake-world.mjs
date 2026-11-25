#!/usr/bin/env node
/**
 * Builds supabase/seed/fake_world.sql: a "busy city" of fake people and tasks for testing the
 * maps, lists, quotes, ratings, nearby pulse and people map on the STAGING project only.
 *
 *   node scripts/fake-world.mjs          writes supabase/seed/fake_world.sql (same rows every run)
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
// NS = 9 while the 8074413313 account's rows are made: their ids start fa4e0009- (see the 25 Nov block).
let NS = null;
const id = (kind, n) => (NS ? `fa4e0009-000${kind}-4000-8000-${hex(n)}` : `fa4e000${kind}-0000-4000-8000-${hex(n)}`);
// Ids for the 25 Nov tables: fa4e0006-<type>-... for the fake city, fa4e0009-<type + 0x10>-... for the account.
const ctr = {};
const nid = (type) => {
  const k = `${NS ?? 6}:${type}`;
  ctr[k] = (ctr[k] ?? 0) + 1;
  return `fa4e000${NS ?? 6}-${hex(type + (NS ? 0x10 : 0), 4)}-4000-8000-${hex(ctr[k])}`;
};
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

// People map: 60 sharers on "Everyone nearby", spots live for 30 days.
const sharers = shuffle(people.filter((p) => p.region !== "abroad")).slice(0, 52).concat(people.filter((p) => p.region === "abroad").slice(0, 8));

// ======================================================================= 25 Nov 2026 additions ====
// Plan task 1.19 row P: every screen and table gets data. A fresh random stream, so everything above
// (the 120 people, their ids, phones and the 10 Nov tasks) comes out exactly as before.
s = 20261125;
const TY = { MSG: 1, REV: 2, NOTIF: 3, DISPUTE: 5, PROMO: 6, PROMOPAY: 7, QUESTION: 8, FIND: 9, DEST: 10, PAYOUT: 11, FB: 12, FBC: 13, CANCEL: 14 };
const disputes = [], promos = [], questions = [], finds = [], saved = [], dests = [], payouts = [], notifs = [];
const fbPosts = [], fbComments = [], fbVotes = [], referrals = [], cancels = [];
const rupees = (minor) => `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;
const first = (p) => p.name.split(" ")[0];
const isOpenReq = (t) => t.status === "OPEN" && t.kind === "request" && !t.hunt;
const local = (p) => p.region === "near" || p.region === "hyd";
const FINISHED = ["COMPLETED", "AUTO_COMPLETED"];
const notify = (user, kind, title, body, task, min, read) =>
  notifs.push({ id: nid(TY.NOTIF), user, kind, title, body, task, min, readMin: read ? Math.max(0, min - int(1, 60)) : null });

const LONG_CHAT = [
  ["p", "Hi, are you free to start today?"], ["w", "Yes, I can come by 4 pm."], ["p", "Great. Gate code is 2211, flat on the 3rd floor."],
  ["w", "Noted. Should I bring anything?"], ["p", "Just your tools. There is a ladder here."], ["w", "Reached the gate, coming up."],
  ["w", "Started. Will send photos when done."], ["p", "Thanks! Let me know if you need anything."],
];
function chat(t, n, endMin) {
  const lines = LONG_CHAT.slice(0, n);
  let m = endMin + lines.length * 12;
  for (const [who, body] of lines) {
    messages.push({ id: nid(TY.MSG), task: t, from: who === "p" ? t.poster : t.worker, body, min: m });
    m = Math.max(1, m - int(3, 20));
  }
}
function quoteOn(t, pool, n) {
  for (const w of pool.slice(0, n)) {
    bn += 1;
    bids.push({ id: id(3, bn), task: t, worker: w, price: Math.max(5000, Math.round((t.price * (0.8 + rnd() * 0.4)) / 5000) * 5000),
      minutes: pick([240, 720, 1440, 2880]), message: pick(QUOTE_LINES), locked: false, createdMin: Math.max(1, t.createdMin - int(5, Math.max(6, t.createdMin - 1))) });
  }
}
function promote(t, startMin, days, status = "active") {
  t.promoted = true;
  promos.push({ id: nid(TY.PROMO), pay: nid(TY.PROMOPAY), task: t, user: t.poster, days, daily: pick([4900, 9900, 19900]), startMin, status, audience: pick(["city", "radius"]) });
}
const DISPUTE_REASONS = ["Work is only half done and the worker stopped replying.", "The tap is still leaking after the repair.",
  "Photos sent do not match what was done.", "Worker asked for extra cash on site."];
const QUESTIONS = [["Do I need to bring my own ladder?", "Yes please, there is none here."], ["Is parking available near the building?", "Visitor parking at the back gate."],
  ["Can I come on Sunday instead?", "Sunday morning works."], ["How old is the unit?", "About 4 years."], ["Is the material already bought?", null],
  ["Will someone be at home?", "My mother will be there all day."], ["Is this a one-time job or regular?", null], ["Which floor is it on?", "Second floor, there is a lift."]];
const FIND_SPOTS = [["Sri Balaji Steel Centre, Begum Bazaar", "₹45 each for 50+", "Owner says new stock comes every Monday."],
  ["Ravi Gas Agency, Kondapur", "₹905 refill", "Open 9 to 7, carry the old cylinder."], ["Sports Corner, Ameerpet", "₹2,750 full kit", "Bat, pads, gloves and bag."],
  ["Classic Tailors, Kukatpally", "₹3,200 stitching", "Can do it in 3 days if the cloth comes by Tuesday."], ["Krishna Stores, Madhapur", "₹60 each", "Only 30 in stock right now."],
  ["Old City Auto Works, Malakpet", "₹1,500 for a check-up", "Mechanic has fixed Chetaks for 30 years."]];
const IDEAS = [["feature", "Let me save a task as a template", "I post the same cleaning task every month. A post again button would save time.", "planned"],
  ["improvement", "Show distance on every task card", "Hard to tell which tasks are close without opening each one.", "in_progress"],
  ["bug", "Map pins overlap in Kondapur", "When many tasks are in one building the pins hide each other.", "under_review"],
  ["feature", "Telugu language option", "My parents would use the app if it was in Telugu.", "planned"],
  ["feature", "Pay in two parts for big jobs", "For painting jobs I want to pay half at the start and half at the end.", "open"],
  ["improvement", "Remind me before the due time", "A reminder an hour before would help me not miss jobs.", "done"],
  ["feature", "Dark mode for the map", "The map is very bright at night.", "open"],
  ["other", "Add a tip button after the job", "Sometimes the worker does extra and I want to thank them.", "under_review"],
  ["bug", "Chat opens at the oldest message", "On Android the chat opens at the top instead of the newest message.", "done"],
  ["feature", "Filter tasks by price", "Let me hide tasks under ₹300.", "open"],
  ["improvement", "Bigger photos on task details", "Photos are small on my phone.", "declined"],
  ["feature", "Verified badge for workers with ID", "Would make me trust new workers more.", "open"]];
const FB_REPLIES = ["Yes please, I need this too.", "+1, this would help a lot.", "Same problem on my phone.", "Good idea.", "Would use this every week."];

// Disputed jobs: hired, work sent in, then the poster reported a problem.
for (let i = 0; i < 4; i++) {
  const poster = pick(posters.filter(local));
  const t = makeTask(poster, pick(LOCAL_REQUESTS), { createdMin: int(60 * 24 * 2, 60 * 24 * 6) });
  const ws = workersFor(t, poster);
  if (!ws.length) { tasks.pop(); continue; }
  hire(t, pick(ws), "DISPUTED");
  disputes.push({ id: nid(TY.DISPUTE), task: t, by: poster, reason: DISPUTE_REASONS[i % DISPUTE_REASONS.length], min: int(30, 60 * 24) });
}
// Open requests whose date has passed, promoted ones (live and ended), and repeating ones.
for (const t of shuffle(tasks.filter((x) => isOpenReq(x) && local(x.poster) && x.flag === "none")).slice(0, 8)) t.dueMin = -int(60 * 3, 60 * 24 * 5);
for (const t of shuffle(tasks.filter((x) => isOpenReq(x) && local(x.poster) && (x.dueMin ?? 1) > 0)).slice(0, 10)) {
  const days = pick([1, 3, 7]);
  promote(t, int(30, days * 1440 - 120), days);
}
for (const t of shuffle(tasks.filter((x) => FINISHED.includes(x.status) && local(x.poster))).slice(0, 4)) promote(t, int(60 * 24 * 8, 60 * 24 * 20), pick([1, 3]), "expired");
for (const t of shuffle(tasks.filter((x) => isOpenReq(x) && !x.promoted)).slice(0, 5)) t.repeat = pick(["week", "month"]);
for (const t of tasks.filter((x) => x.status === "CANCELLED")) cancels.push({ id: nid(TY.CANCEL), task: t, by: "poster", phase: "OPEN", locked: null, pen: 0, min: t.createdMin - 60 });
// Questions on open requests, about two thirds answered.
for (const t of tasks.filter(isOpenReq)) {
  if (!chance(0.35)) continue;
  for (const w of shuffle(workersFor(t, t.poster)).slice(0, int(1, 2))) {
    const [body, answer] = pick(QUESTIONS);
    const min = Math.max(2, t.createdMin - int(1, Math.max(2, t.createdMin - 1)));
    questions.push({ id: nid(TY.QUESTION), task: t, asker: w, body, answer: chance(0.7) ? answer : null, min });
  }
}
// City Hunt finds.
for (const t of tasks.filter((x) => x.hunt)) {
  for (const w of shuffle(workers.filter((x) => local(x) && km(x, t) < 15)).slice(0, int(1, 3))) {
    const [place, priceNote, note] = pick(FIND_SPOTS);
    finds.push({ id: nid(TY.FIND), task: t, finder: w, place, priceNote, note, lat: r6(t.lat + (rnd() - 0.5) * 0.02), lng: r6(t.lng + (rnd() - 0.5) * 0.02),
      status: pick(["pending", "pending", "accepted", "declined"]), min: int(5, Math.max(6, t.createdMin - 1)) });
  }
}
// Saved jobs.
for (const w of workers.filter(local)) {
  for (const t of shuffle(tasks.filter((x) => isOpenReq(x) && x.poster.id !== w.id && (x.remote || (x.lat !== null && km(w, x) < 15)))).slice(0, int(0, 3))) saved.push({ user: w, task: t });
}
// Longer chats on hired jobs.
for (const t of tasks.filter((x) => x.worker)) {
  if (!FINISHED.includes(t.status)) chat(t, int(3, 8), int(5, 600));
  else if (chance(0.4)) chat(t, int(2, 5), t.doneMin + 30);
}
// Notifications: quotes to posters, picked/started to workers, reviews to whoever was reviewed.
for (const b of bids.filter((x) => !x.locked && x.task.status === "OPEN")) {
  notify(b.task.poster, "quote", `${first(b.worker)} offered ${rupees(b.price)}`, `To do "${b.task.title}". Open it to compare offers.`, b.task, b.createdMin, chance(0.5));
}
for (const t of tasks.filter((x) => x.worker && !FINISHED.includes(x.status))) {
  notify(t.worker, "picked", "You got the job", `${first(t.poster)} picked your offer for "${t.title}".`, t, t.createdMin - 6, true);
  notify(t.worker, "funded", `${first(t.poster)} has paid. You can start`, `"${t.title}": your payment is held safely until the work is approved.`, t, t.createdMin - 11, chance(0.6));
}
for (const r of reviews) notify(r.subject, "review", `${first(r.author)} rated you ${r.rating} stars`, `For "${r.task.title}".`, r.task, Math.max(1, r.min - 1), chance(0.7));
// Payout accounts, withdrawals and wallet balances for workers who have earned.
const share = (t) => Math.round(t.price * 0.9);
for (const w of workers) {
  const mine = assignments.filter((a) => a.worker.id === w.id && a.status === "released");
  if (!mine.length) continue;
  let cleared = mine.filter((a) => a.task.doneMin > 60 * 24 * 7).reduce((n, a) => n + share(a.task), 0);
  w.clearing = mine.filter((a) => a.task.doneMin <= 60 * 24 * 7).reduce((n, a) => n + share(a.task), 0);
  const d = { id: nid(TY.DEST), user: w, upi: `${w.username.replace(/_/g, ".")}@${pick(["okaxis", "oksbi", "ybl", "okhdfcbank", "paytm"])}` };
  dests.push(d);
  for (let i = int(0, 2); i > 0; i--) {
    const amount = Math.round((cleared * (0.3 + rnd() * 0.4)) / 10000) * 10000;
    if (amount < 10000) break;
    const status = pick(["paid", "paid", "paid", "processing", "requested", "failed"]);
    payouts.push({ id: nid(TY.PAYOUT), user: w, dest: d, amount, status, min: int(60, 60 * 24 * 40) });
    if (status !== "failed") cleared -= amount;
  }
  w.balance = cleared;
}
// The public Ideas board, and who invited whom.
for (const [category, title, body, status] of IDEAS) {
  const author = pick(people.filter((p) => p.region !== "abroad"));
  const post = { id: nid(TY.FB), author, category, title, body, status, min: int(60 * 24, 60 * 24 * 30), votes: 0 };
  fbPosts.push(post);
  for (const v of shuffle(people.filter((p) => p.id !== author.id)).slice(0, int(0, 25))) { fbVotes.push({ post, user: v }); post.votes += 1; }
  for (const c of shuffle(people.filter((p) => p.id !== author.id)).slice(0, int(0, 3))) {
    fbComments.push({ id: nid(TY.FBC), post, author: c, body: pick(FB_REPLIES), min: Math.max(5, post.min - int(30, 60 * 24)) });
  }
}
const byAge = [...people].sort((a, b) => b.createdMin - a.createdMin);
for (let i = 0; i < 15; i++) {
  const referrer = byAge[i * 2], referred = byAge[byAge.length - 1 - i];
  if (referrer.id !== referred.id) referrals.push({ referrer, referred });
}

// ---------------------------------------------------------- the 8074413313 account (Tasker 3313) ----
// The owner's own test account. Its profile, name, phone, sign-in and wallet are never changed; the
// rows below only point at it, all with ids starting fa4e0009- so a re-run or the remove file finds them.
const OWNER = { id: "ec7ca544-48d7-403d-9f54-bcd7312abbd9", name: "Tasker 3313", region: "near", label: "Hitec City, Hyderabad", lat: 17.4435, lng: 78.3772 };
NS = 9;
const nearWorkers = sharers.filter((p) => p.region === "near" && p.role !== "post");
const nearPosters = sharers.filter((p) => p.region === "near" && p.role !== "earn");
const closest = (t, pool) => [...pool].sort((a, b) => km(a, t) - km(b, t));
const own = (cat, title, lo, opts = {}) => makeTask(OWNER, [cat, title, [lo, lo]], opts);
const ownerTasks = [];

// As a poster: open requests with offers.
const o1 = own("Home Services", "Deep clean my 3BHK in Kondapur before Sankranti", 3500, { createdMin: 300 });
o1.photos = true; o1.dueMin = 60 * 24 * 4;
quoteOn(o1, closest(o1, nearWorkers), 5);
promote(o1, 240, 3);
const o2 = own("Repairs & Maintenance", "Kitchen sink is leaking, need a plumber today", 600, { createdMin: 45 });
o2.flag = "urgent"; o2.dueMin = 240; o2.topup = 10;
quoteOn(o2, closest(o2, nearWorkers).slice(2), 3);
const o3 = own("Design & Creative", "Design a menu card for my tiffin centre", 1800, { remote: true, createdMin: 60 * 26 });
o3.dueMin = 60 * 24 * 6;
quoteOn(o3, [...new Set(shuffle(workers.filter((w) => w.skills.some((k) => ["Design", "Logo design", "Canva"].includes(k)))).concat(shuffle(workers)))], 4);
const o4 = own("Errands & Delivery", "Collect my passport from Begumpet PSK", 400, { createdMin: 60 * 24 * 4 });
o4.dueMin = -60 * 30;
quoteOn(o4, closest(o4, nearWorkers).slice(4), 2);
const o5 = own("Local Checks & Info", "Find a mechanic who still repairs old Bajaj Chetak scooters", 400, { createdMin: 60 * 5 });
o5.hunt = { window: "3d", untilMin: 60 * 48, needs: ["photo", "place", "price"] };
const o6 = own("Home Services", "Water and trim my balcony plants every Saturday", 500, { createdMin: 60 * 24 * 2 });
o6.repeat = "week"; o6.dueMin = 60 * 24 * 3;
quoteOn(o6, closest(o6, nearWorkers).slice(1), 2);
for (const [t, qs] of [[o1, [["Do you have a vacuum cleaner or should I bring one?", "Please bring one, mine is broken."], ["Are the fans included?", null]]],
  [o2, [["Is it the pipe under the sink or the tap?", "The pipe under the sink."]]]]) {
  for (const [body, answer] of qs) questions.push({ id: nid(TY.QUESTION), task: t, asker: pick(nearWorkers), body, answer, min: int(10, 40) });
}
for (const [i, st] of ["pending", "pending", "declined"].entries()) {
  const [place, priceNote, note] = FIND_SPOTS[[5, 3, 1][i]];
  finds.push({ id: nid(TY.FIND), task: o5, finder: nearWorkers[i + 3], place: i === 0 ? place : `Sai Motors, ${pick(["Miyapur", "Kukatpally", "Madhapur"])}`,
    priceNote, note: i === 0 ? note : "They work on old scooters, ask for Anwar.", lat: r6(o5.lat + 0.01 * (i + 1)), lng: r6(o5.lng - 0.008 * (i + 1)), status: st, min: 60 * (4 - i) });
}
ownerTasks.push(o1, o2, o3, o4, o5, o6);
// As a poster: hired and in progress, finished, cancelled.
const ownerHired = [
  ["Repairs & Maintenance", "Assemble a wardrobe and a shoe rack", 1200, "LOCKED"], ["Repairs & Maintenance", "Paint the kids' room light blue", 4500, "TASK_STARTED"],
  ["Writing & Content", "Translate my rental agreement to Telugu", 1500, "WORK_DONE", true], ["Photo & Video", "Edit our wedding highlights video (5 min)", 3500, "REVISION_REQUESTED", true],
  ["Repairs & Maintenance", "Service the 1.5 ton split AC in the bedroom", 900, "DISPUTED"],
];
for (const [cat, title, price, st, remote] of ownerHired) {
  const t = own(cat, title, price, { remote: Boolean(remote), createdMin: int(60 * 24, 60 * 24 * 3) });
  hire(t, remote ? pick(workers.filter((w) => w.region !== "abroad")) : pick(nearWorkers), st);
  chat(t, int(4, 8), int(10, 400));
  ownerTasks.push(t);
}
const disputedOwn = ownerTasks[ownerTasks.length - 1];
disputes.push({ id: nid(TY.DISPUTE), task: disputedOwn, by: OWNER, reason: "The AC still does not cool after the service. Asked the worker to come back, no reply.", min: 120 });
const ownerDone = [["Home Services", "Sofa shampoo cleaning (3+2 seater)", 1400, 60 * 24 * 20], ["Repairs & Maintenance", "Mount a 55-inch TV on the wall", 800, 60 * 24 * 10],
  ["Errands & Delivery", "Drop a birthday cake in Madhapur before 7 pm", 350, 60 * 24 * 2], ["Repairs & Maintenance", "Fix the geyser that trips the switch", 900, 300]];
for (const [i, [cat, title, price, doneMin]] of ownerDone.entries()) {
  const t = own(cat, title, price, { createdMin: doneMin + int(60 * 6, 60 * 24 * 2) });
  hire(t, nearWorkers[i % nearWorkers.length], "COMPLETED");
  t.doneMin = doneMin;
  reviews.push({ id: nid(TY.REV), task: t, author: OWNER, subject: t.worker, role: "worker", rating: [5, 5, 4, 5][i], comment: pick(REVIEW_WORKER), min: doneMin - 30 });
  reviews.push({ id: nid(TY.REV), task: t, author: t.worker, subject: OWNER, role: "poster", rating: [5, 4, 5, 5][i], comment: pick(REVIEW_POSTER), min: doneMin - 60 });
  chat(t, 3, doneMin + 30);
  ownerTasks.push(t);
}
promote(ownerTasks[ownerTasks.length - 3], 60 * 24 * 12, 3, "expired");
const ownAuto = own("Shopping & Sourcing", "Buy fresh vegetables from Rythu Bazar", 300, { createdMin: 60 * 24 * 12 });
hire(ownAuto, nearWorkers[5 % nearWorkers.length], "AUTO_COMPLETED");
ownAuto.doneMin = 60 * 24 * 9;
reviews.push({ id: nid(TY.REV), task: ownAuto, author: ownAuto.worker, subject: OWNER, role: "poster", rating: 4, comment: "Clear list, easy job.", min: 60 * 24 * 9 - 60 });
const ownCancelled = own("Home Services", "Cook lunch for 8 people on Sunday", 2500, { status: "CANCELLED", createdMin: 60 * 24 * 6 });
cancels.push({ id: nid(TY.CANCEL), task: ownCancelled, by: "poster", phase: "OPEN", locked: null, pen: 0, min: 60 * 24 * 5 });
ownerTasks.push(ownAuto, ownCancelled);
own("Errands & Delivery", "I will run errands and pick-ups around Hitec City", 400, { kind: "service", createdMin: 60 * 24 * 15 });

// As a worker: offers sent, jobs in progress, jobs done.
for (const t of closest(OWNER, tasks.filter((x) => isOpenReq(x) && x.poster.id !== OWNER.id && x.lat !== null)).slice(0, 4)) {
  bn += 1;
  bids.push({ id: id(3, bn), task: t, worker: OWNER, price: t.price, minutes: 1440, message: "I live close by and can do this today.", locked: false, createdMin: Math.max(1, t.createdMin - 20) });
}
const ownerJobs = [
  ["Errands & Delivery", "Pick up documents from Ameerpet and drop at Hitec City", 450, "LOCKED"], ["Repairs & Maintenance", "Fix a jammed bedroom door lock", 500, "TASK_STARTED"],
  ["Repairs & Maintenance", "Install 4 curtain rods", 700, "WORK_DONE"], ["Home Services", "Clean the kitchen chimney and stove", 1200, "OVERDUE"],
  ["Repairs & Maintenance", "Paint one accent wall in the living room", 3800, "REVISION_REQUESTED"],
];
for (const [i, [cat, title, price, st]] of ownerJobs.entries()) {
  const poster = nearPosters[i % nearPosters.length];
  const t = makeTask(poster, [cat, title, [price, price]], { createdMin: int(60 * 24, 60 * 24 * 3) });
  hire(t, OWNER, st);
  chat(t, int(4, 8), int(10, 400));
  notify(OWNER, "picked", "You got the job", `${first(poster)} picked your offer for "${title}".`, t, t.createdMin - 6, i > 1);
  notify(OWNER, "funded", `${first(poster)} has paid. You can start`, `"${title}": your payment is held safely until the work is approved.`, t, t.createdMin - 11, i > 1);
}
const jobsDone = [["Errands & Delivery", "Get medicines from Apollo pharmacy", 250, 60 * 24 * 25], ["Repairs & Maintenance", "Replace two ceiling fan regulators", 700, 60 * 24 * 18],
  ["Shopping & Sourcing", "Compare prices for a fridge at 3 local shops", 600, 60 * 24 * 11], ["Repairs & Maintenance", "Assemble a study table and chair", 900, 60 * 24 * 6],
  ["Home Services", "Water plants while I travel (5 days)", 800, 60 * 24 * 3], ["Errands & Delivery", "Collect a parcel from the courier office", 300, 60 * 20],
  ["Local Checks & Info", "Check if a PG near Gachibowli is as shown in photos", 450, 90]];
for (const [i, [cat, title, price, doneMin]] of jobsDone.entries()) {
  const poster = nearPosters[(i + 2) % nearPosters.length];
  const t = makeTask(poster, [cat, title, [price, price]], { createdMin: doneMin + int(60 * 4, 60 * 24) });
  hire(t, OWNER, "COMPLETED");
  t.doneMin = doneMin;
  // For the Streaks badges: two early starts (7 am in India), two jobs with photos, one live answer.
  if (i === 0 || i === 2) t.earlyDays = Math.floor(doneMin / 1440) + 1;
  if (i === 1 || i === 3) t.photos = true;
  if (i === 6) t.live = true;
  reviews.push({ id: nid(TY.REV), task: t, author: poster, subject: OWNER, role: "worker", rating: [5, 5, 4, 5, 5, 5, 4][i], comment: REVIEW_WORKER[i % REVIEW_WORKER.length], min: doneMin - 30 });
  if (i % 2 === 0) reviews.push({ id: nid(TY.REV), task: t, author: OWNER, subject: poster, role: "poster", rating: 5, comment: pick(REVIEW_POSTER), min: doneMin - 60 });
  if (i >= 4) notify(OWNER, "released", "Payment released", `${first(poster)} approved "${title}". ${rupees(share(t))} is on its way to your wallet.`, t, doneMin - 5, i !== 6);
}
for (const t of closest(OWNER, tasks.filter((x) => isOpenReq(x) && x.poster.id !== OWNER.id && x.lat !== null)).slice(4, 8)) saved.push({ user: OWNER, task: t });
// The account's bell: offers, questions, finds, progress and money.
for (const b of bids.filter((x) => x.task.poster.id === OWNER.id && !x.locked)) {
  notify(OWNER, "quote", `${first(b.worker)} offered ${rupees(b.price)}`, `To do "${b.task.title}". Open it to compare offers.`, b.task, b.createdMin, b.task !== o2);
}
for (const qn of questions.filter((x) => x.task.poster.id === OWNER.id)) notify(OWNER, "question", "New question on your task", `${first(qn.asker)} asked: "${qn.body}"`, qn.task, qn.min, Boolean(qn.answer));
for (const f of finds.filter((x) => x.task === o5)) notify(OWNER, "hunt_find", `${first(f.finder)} found a place`, `For "${o5.title}": ${f.place}.`, o5, f.min, f.status !== "pending");
for (const t of ownerTasks.filter((x) => x.worker && !FINISHED.includes(x.status))) {
  if (t.status !== "LOCKED") notify(OWNER, "started", `${first(t.worker)} started your task`, `"${t.title}" is now in progress.`, t, t.createdMin - 120, true);
  if (["WORK_DONE", "REVISION_REQUESTED", "DISPUTED"].includes(t.status)) notify(OWNER, "submitted", `${first(t.worker)} sent in the work`, `For "${t.title}". Approve it to pay them, or ask for changes.`, t, 200, t.status !== "WORK_DONE");
}
notify(OWNER, "dispute", "A problem was reported", `On "${disputedOwn.title}". Our team is looking into it and will update you here.`, disputedOwn, 115, false);
for (const r of reviews.filter((x) => x.subject === OWNER)) notify(OWNER, "review", `${first(r.author)} rated you ${r.rating} stars`, `For "${r.task.title}".`, r.task, Math.max(1, r.min - 1), r.min > 60 * 24);
notify(OWNER, "announcement", "New: City Hunts", "Post a find-it task and people nearby send photos, places and prices.", null, 60 * 24 * 4, true);
// Withdrawals to the account's own saved payout method (looked up when the SQL runs; left empty if there is none).
payouts.push({ id: nid(TY.PAYOUT), user: OWNER, ownDest: true, amount: 150000, status: "paid", min: 60 * 24 * 8 },
  { id: nid(TY.PAYOUT), user: OWNER, ownDest: true, amount: 80000, status: "processing", min: 50 });
notify(OWNER, "payout_paid", `${rupees(150000)} sent to your account`, "Your withdrawal is done. It can take a few hours to show in your bank app.", null, 60 * 24 * 8 - 30, true);
// The Ideas board: one idea of its own, votes on others.
{
  const post = { id: nid(TY.FB), author: OWNER, category: "feature", title: "Show my earnings by week", body: "A small chart of what I earned each week would help me plan.", status: "under_review", min: 60 * 24 * 3, votes: 0 };
  fbPosts.push(post);
  for (const v of nearWorkers.slice(0, 6)) { fbVotes.push({ post, user: v }); post.votes += 1; }
  fbComments.push({ id: nid(TY.FBC), post, author: nearWorkers[0], body: "Yes, I want this too.", min: 60 * 24 * 2 });
  for (const p of fbPosts.slice(0, 5)) { fbVotes.push({ post: p, user: OWNER }); p.votes += 1; }
}
// Three newer fake people joined with the account's invite code.
for (const p of byAge.slice(byAge.length - 18, byAge.length - 15)) referrals.push({ referrer: OWNER, referred: p });
NS = null;

// --------------------------------------------------------------------------------------- SQL ----
const out = [];
const w = (x) => out.push(x);
const values = (rowsSql) => rowsSql.join(",\n");
const at = (min) => (min === null || min === undefined ? "null" : ago(min));

// Removes every seeded row. With triggers off nothing cascades, so it walks the tables itself: a row goes
// when its own id is a seed id (fa4e000…), or when it points at a fake person or seeded task and at no real
// person or real task. So rows the owner made by hand (an offer on a fake task, say) stay, and the seeded
// rows they point at come back with the same ids on the next run.
const PURGE = `do $purge$
declare t record; cond text;
begin
  delete from auth.refresh_tokens where user_id like 'fa4e000%';
  delete from auth.mfa_amr_claims where session_id in (select id from auth.sessions where user_id::text like 'fa4e000%');
  for t in
    with fk as (
      select c.conrelid as rel, a.attname::text as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and cardinality(c.conkey) = 1 and a.atttypid = 'uuid'::regtype
         and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.tasks'::regclass)
    ), ids as (
      select k.oid as rel
        from pg_class k join pg_namespace n on n.oid = k.relnamespace
        join pg_attribute a on a.attrelid = k.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped
       where n.nspname = 'public' and k.relkind = 'r'
    )
    select r.rel::regclass as rel, exists (select 1 from ids where ids.rel = r.rel) as has_id,
           (select array_agg(distinct fk.col) from fk where fk.rel = r.rel) as cols
      from (select rel from fk union select rel from ids) r
  loop
    cond := null;
    if t.cols is not null then
      cond := format('((%s) and (%s))',
        (select string_agg(format('%I::text like %L', c, 'fa4e000%'), ' or ') from unnest(t.cols) c),
        (select string_agg(format('(%I is null or %I::text like %L)', c, c, 'fa4e000%'), ' and ') from unnest(t.cols) c));
    end if;
    if t.has_id then
      cond := concat_ws(' or ', format('id::text like %L', 'fa4e000%'), cond);
    end if;
    execute format('delete from %s where %s', t.rel, cond);
  end loop;
  delete from auth.users where id::text like 'fa4e000%';
end
$purge$;`;
const RATINGS = (where) => `update public.profiles p set
  worker_rating_avg   = coalesce((select round(avg(rating), 2) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'), 0),
  worker_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'),
  poster_rating_avg   = coalesce((select round(avg(rating), 2) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster'), 0),
  poster_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster')
where ${where};`;

w(`-- GENERATED by scripts/fake-world.mjs. Do not edit by hand: change the script and run it again.
-- Fake people and tasks for the STAGING project (wjxvingpfbfvkfqhrguj). NEVER run on production.
-- ${people.length} people, ${tasks.length} tasks, ${bids.length} quotes, ${reviews.length} reviews. Undo: supabase/seed/fake_world_remove.sql
-- Every fake account id starts with fa4e0001-; phones 9888000001..${people[people.length - 1].phone}.
-- Safe to run again: it removes what the last run made first (every seeded id starts fa4e000).
-- Also fills the owner's test account 8074413313 (${OWNER.id}) with rows whose ids start fa4e0009-.

begin;
set local session_replication_role = replica;  -- no triggers: no sign-up alerts, pushes or events

do $$
declare v_account uuid := '${OWNER.id}';  -- kept off the users line: gitleaks reads "auth ... = '<id>'" as a key
begin
  if not exists (select 1 from auth.users where id = v_account and email = 'p8074413313@phone.taskdrop.app') then
    raise exception 'The 8074413313 test account is not on this database: is this the staging project?';
  end if;
end $$;

${PURGE}
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
  const started = ["TASK_STARTED", "OVERDUE", "WORK_DONE", "REVISION_REQUESTED", "DISPUTED", "COMPLETED", "AUTO_COMPLETED"].includes(st);
  const done = ["WORK_DONE", "REVISION_REQUESTED", "DISPUTED", "COMPLETED", "AUTO_COMPLETED"].includes(st);
  const finished = ["COMPLETED", "AUTO_COMPLETED"].includes(st);
  const descr = t.kind === "service"
    ? `${t.title}. Fake listing for testing. Message me with what you need and when.`
    : `${t.title}. ${t.remote ? "Can be done from anywhere." : `Location: ${t.label}.`} Fake task for testing - nothing will be paid.`;
  return `(${q(t.id)}, ${q(t.poster.id)}, ${q(pillarFor(t.category))}, ${q(t.title)}, ${q(descr)}, ${t.price}, ${q(st)}, ${q(t.flag)}, ` +
    `${q(t.label)}, ${t.lat === null ? "null" : r2(t.lat)}, ${t.lng === null ? "null" : r2(t.lng)}, ${q(t.kind)}, ${q(t.category)}, ${arr(t.skills)}, ${q(t.difficulty)}, ` +
    `${st === "OVERDUE" ? ago(60 * 10) : due}, ${ago(t.createdMin)}, ${hired ? q(t.bid.id) : "null"}, ${hired ? t.price : "null"}, ` +
    `${hired ? ago(t.createdMin - 10) : "null"}, ${hired ? q(t.payment) : "null"}, ${hired ? "'payment'" : "null"}, ${hired ? t.escrow : "null"}, ` +
    `${!started ? "null" : t.earlyDays ? `date_trunc('day', now() - interval '${t.earlyDays} days') + interval '90 minutes'` : ago(Math.max(5, (t.doneMin ?? 60) + 120))}, ${done ? ago(Math.max(1, (t.doneMin ?? 30) + 30)) : "null"}, ` +
    `${["WORK_DONE", "REVISION_REQUESTED"].includes(st) ? ahead(60 * 48) : "null"}, ${finished ? ago(t.doneMin) : "null"}, ${finished ? (t.doneMin > 60 * 24 * 7 ? ago(t.doneMin - 60 * 24 * 7) : ahead(60 * 24 * 7 - t.doneMin)) : "null"}, ` +
    `${finished && t.doneMin > 60 * 24 * 7 ? ago(t.doneMin - 60 * 24 * 7) : "null"}, ${t.topup ?? 0}, ${t.photos}, ` +
    `${t.hunt ? q(t.hunt.window) : "null"}, ${t.hunt ? ahead(t.hunt.untilMin) : "null"}, ${t.hunt ? arr(t.hunt.needs) : "null"}, ${q(t.repeat ?? null)}, ${Boolean(t.live)})`;
});
w(`insert into public.tasks (id, poster_id, pillar, title, description, benchmark_minor, status, flag, loc_label, loc_lat, loc_lng, kind, category,
  skills, difficulty, due_at, created_at, locked_bid_id, locked_minor, funded_at, funding_payment_id, funded_via, funded_minor,
  started_at, work_done_at, auto_complete_at, completed_at, clear_at, cleared_at, topup_pct, want_photos, hunt_window, hunt_until, hunt_needs,
  repeat_every, live_answer, time_limit_minutes, payout_mode, assignment_mode, updated_at)
select v.id::uuid, v.poster::uuid, v.pillar::public.pillar, v.title, v.d, v.price, v.st::public.task_status, v.flag::public.task_flag, v.label, v.lat, v.lng,
  v.kind, v.cat, v.skills::text[], v.diff, v.due, v.created, v.bid::uuid, v.locked, v.funded, v.pay::uuid, v.via, v.fmin,
  v.started, v.wdone, v.auto, v.completed, v.clear_at, v.cleared, v.topup, v.photos, v.hw, v.hu, v.hn::text[],
  v.rep, v.live, 2880, 'one_time', 'bids', now()
from (values
${values(taskRows)}
) as v(id, poster, pillar, title, d, price, st, flag, label, lat, lng, kind, cat, skills, diff, due, created, bid, locked, funded, pay, via, fmin,
       started, wdone, auto, completed, clear_at, cleared, topup, photos, hw, hu, hn, rep, live);

insert into public.task_private (task_id, loc_lat, loc_lng) values
${values(tasks.filter((t) => t.lat !== null).map((t) => `(${q(t.id)}, ${t.lat}, ${t.lng})`))};
`);

w(`insert into public.bids (id, task_id, worker_id, price_minor, time_limit_minutes, message, is_locked, created_at) values
${values(bids.map((b) => `(${q(b.id)}, ${q(b.task.id)}, ${q(b.worker.id)}, ${b.price}, ${b.minutes}, ${q(b.message)}, ${b.locked}, ${ago(b.createdMin)})`))};

insert into public.payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at) values
${values(payments.map((p) => `(${q(p.id)}, ${q(p.user.id)}, ${q(p.task.id)}, 'escrow', ${p.amount}, 'paid', 'seed', ${ago(p.paidMin)}, ${ago(p.paidMin)})`))};

insert into public.assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode) values
${values(assignments.map((a) => `(${q(a.id)}, ${q(a.task.id)}, ${q(a.bid.id)}, ${q(a.worker.id)}, '${a.status}', ${a.escrow}, 'one_time')`))};

insert into public.messages (id, task_id, sender_id, body, created_at) values
${values(messages.map((m) => `(${q(m.id ?? nid(TY.MSG))}, ${q(m.task.id)}, ${q(m.from.id)}, ${q(m.body)}, ${ago(m.min)})`))};

insert into public.task_proofs (id, task_id, worker_id, summary, created_at) values
${values(tasks.filter((t) => ["WORK_DONE", "REVISION_REQUESTED", "DISPUTED", ...FINISHED].includes(t.status)).map((t) =>
  // The proof's id is the task's with an f in the second group: unique, and still a seed id.
  `(${q(`${t.id.slice(0, 9)}f${t.id.slice(10)}`)}, ${q(t.id)}, ${q(t.worker.id)}, ${q(t.remote ? "Done and uploaded. Files are in the chat." : "Finished as agreed. Photos in the chat.")}, ${ago(Math.max(1, (t.doneMin ?? 30) + 30))})`))};

insert into public.reviews (id, task_id, author_id, subject_id, about_role, rating, comment, created_at) values
${values(reviews.map((r) => `(${q(r.id ?? nid(TY.REV))}, ${q(r.task.id)}, ${q(r.author.id)}, ${q(r.subject.id)}, '${r.role}', ${r.rating}, ${q(r.comment)}, ${ago(Math.max(1, r.min))})`))};

${RATINGS(`p.id::text like 'fa4e0001-%' or p.id = '${OWNER.id}'`)}
`);

// ------------------------------------------------------------------- 25 Nov tables (row P) ----
const promoEnd = (p) => p.startMin - p.days * 1440;
w(`insert into public.task_disputes (id, task_id, opened_by, reason, created_at) values
${values(disputes.map((d) => `(${q(d.id)}, ${q(d.task.id)}, ${q(d.by.id)}, ${q(d.reason)}, ${ago(d.min)})`))};

insert into public.cancellations_log (id, task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor, created_at) values
${values(cancels.map((c) => `(${q(c.id)}, ${q(c.task.id)}, '${c.by}', 'normal', ${q(c.phase)}, ${c.locked ?? "null"}, ${c.pen}, ${ago(c.min)})`))};

insert into public.task_promotions (id, task_id, user_id, amount_minor, days, status, payment_id, starts_at, ends_at, created_at, updated_at, audience, settled_at) values
${values(promos.map((p) => `(${q(p.id)}, ${q(p.task.id)}, ${q(p.user.id)}, ${p.daily * p.days}, ${p.days}, '${p.status}', ${q(p.pay)}, ${ago(p.startMin)}, ${ago(promoEnd(p))}, ${ago(p.startMin + 5)}, now(), '${p.audience}', ${p.status === "expired" ? ago(promoEnd(p)) : "null"})`))};

insert into public.payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at, promotion_id) values
${values(promos.map((p) => `(${q(p.pay)}, ${q(p.user.id)}, ${q(p.task.id)}, 'promotion', ${p.daily * p.days}, 'paid', 'seed', ${ago(p.startMin + 2)}, ${ago(p.startMin + 5)}, ${q(p.id)})`))};

insert into public.task_questions (id, task_id, asker_id, body, answer, answered_at, created_at) values
${values(questions.map((x) => `(${q(x.id)}, ${q(x.task.id)}, ${q(x.asker.id)}, ${q(x.body)}, ${q(x.answer)}, ${x.answer ? ago(Math.max(1, x.min - 30)) : "null"}, ${ago(x.min)})`))};

insert into public.hunt_finds (id, task_id, finder_id, place_name, lat, lng, price_note, note, status, decline_reason, created_at, decided_at) values
${values(finds.map((f) => `(${q(f.id)}, ${q(f.task.id)}, ${q(f.finder.id)}, ${q(f.place)}, ${f.lat}, ${f.lng}, ${q(f.priceNote)}, ${q(f.note)}, '${f.status}', ${f.status === "declined" ? "'not_it'" : "null"}, ${ago(f.min)}, ${f.status === "pending" ? "null" : ago(Math.max(1, f.min - 20))})`))};

insert into public.saved_tasks (user_id, task_id, created_at) values
${values(saved.map((x) => `(${q(x.user.id)}, ${q(x.task.id)}, now() - interval '${int(1, 72)} hours')`))}
on conflict do nothing;

insert into public.payout_destinations (id, user_id, kind, label, upi_id, is_default, created_at) values
${values(dests.map((d) => `(${q(d.id)}, ${q(d.user.id)}, 'upi', 'My UPI', ${q(d.upi)}, true, ${ago(d.user.createdMin - 60)})`))};

insert into public.payouts (id, user_id, amount_minor, status, destination, destination_id, via, failure_note, created_at, updated_at, sent_at) values
${values(payouts.map((p) => {
  const dest = p.ownDest ? `(select id from public.payout_destinations where user_id = ${q(OWNER.id)} order by is_default desc, created_at limit 1)` : q(p.dest.id);
  const label = p.ownDest ? "'UPI · saved account'" : q(`UPI · ${p.dest.upi}`);
  return `(${q(p.id)}, ${q(p.user.id)}, ${p.amount}, '${p.status}', ${label}, ${dest}, 'manual', ${p.status === "failed" ? "'The bank did not accept this UPI id.'" : "null"}, ${ago(p.min)}, ${ago(Math.max(1, p.min - 30))}, ${p.status === "paid" ? ago(Math.max(1, p.min - 60)) : "null"})`;
}))};

update public.wallets w set balance_minor = v.bal, clearing_minor = v.clr, updated_at = now()
from (values
${values(workers.filter((x) => x.balance !== undefined).map((x) => `(${q(x.id)}::uuid, ${x.balance}, ${x.clearing})`))}
) as v(id, bal, clr) where w.user_id = v.id;

insert into public.notifications (id, user_id, kind, title, body, task_id, read_at, created_at) values
${values(notifs.map((n) => `(${q(n.id)}, ${q(n.user.id)}, ${q(n.kind)}, ${q(n.title)}, ${q(n.body)}, ${n.task ? q(n.task.id) : "null"}, ${at(n.readMin)}, ${ago(n.min)})`))};

insert into public.feedback_posts (id, author_id, title, body, category, status, vote_count, created_at, status_changed_at) values
${values(fbPosts.map((p) => `(${q(p.id)}, ${q(p.author.id)}, ${q(p.title)}, ${q(p.body)}, '${p.category}', '${p.status}', ${p.votes}, ${ago(p.min)}, ${p.status === "open" ? ago(p.min) : ago(Math.max(1, p.min - 60 * 12))})`))};
insert into public.feedback_votes (post_id, user_id, created_at) values
${values(fbVotes.map((v) => `(${q(v.post.id)}, ${q(v.user.id)}, ${ago(Math.max(1, v.post.min - int(10, 600)))})`))}
on conflict do nothing;
insert into public.feedback_comments (id, post_id, author_id, is_team, body, created_at) values
${values(fbComments.map((c) => `(${q(c.id)}, ${q(c.post.id)}, ${q(c.author.id)}, false, ${q(c.body)}, ${ago(c.min)})`))};

insert into public.referrals (referred_id, referrer_id, created_at) values
${values(referrals.map((r) => `(${q(r.referred.id)}, ${q(r.referrer.id)}, ${ago(r.referred.createdMin)})`))}
on conflict do nothing;

-- Profile details the 10 Nov file left empty: why they earn, a weekly goal, an invite code.
update public.profiles set
  earn_goal = case when intent = 'post' then null else (array['business','gig','other'])[1 + abs(hashtext(id::text)) % 3] end,
  weekly_goal_minor = case when intent = 'post' then null else (array[150000, 300000, 500000])[1 + abs(hashtext(id::text || 'g')) % 3] end,
  referral_code = upper(substr(md5(id::text), 1, 8))
where id::text like 'fa4e0001-%';
`);

// People map (sharers are picked above, before the 25 Nov block).
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
-- That is the 120 fake people and all they own, and the rows added to the 8074413313 account (ids fa4e0009-).
-- Rows real people made by hand are kept. The account's star ratings are worked out again afterwards.
begin;
set local session_replication_role = replica;
${PURGE}
${RATINGS(`p.id = '${OWNER.id}'`)}
commit;
`);
const by = (f) => tasks.filter(f).length;
console.log(`people ${people.length} (workers ${workers.length}, posters ${posters.length}); tasks ${tasks.length}: open requests ${by((t) => t.status === "OPEN" && t.kind === "request")}, ` +
  `services ${by((t) => t.kind === "service")}, in progress ${by((t) => t.worker && !["COMPLETED", "AUTO_COMPLETED"].includes(t.status))}, finished ${by((t) => ["COMPLETED", "AUTO_COMPLETED"].includes(t.status))}; ` +
  `quotes ${bids.length}; reviews ${reviews.length}; map sharers ${sharers.length}; chats ${messages.length}; notifications ${notifs.length}; ` +
  `disputes ${disputes.length}; promotions ${promos.length}; questions ${questions.length}; hunt finds ${finds.length}; saved ${saved.length}; ` +
  `payouts ${payouts.length}; ideas ${fbPosts.length} (${fbVotes.length} votes, ${fbComments.length} comments); referrals ${referrals.length}`);
const mine = (f) => tasks.filter((t) => f(t)).length;
console.log(`8074413313: posted ${mine((t) => t.poster.id === OWNER.id)}, works on ${mine((t) => t.worker?.id === OWNER.id)}, offers sent ${bids.filter((b) => b.worker.id === OWNER.id && !b.locked).length}, ` +
  `offers received ${bids.filter((b) => b.task.poster.id === OWNER.id && !b.locked).length}, chats ${messages.filter((m) => m.task.poster.id === OWNER.id || m.task.worker?.id === OWNER.id).length}, ` +
  `reviews ${reviews.filter((r) => r.author.id === OWNER.id || r.subject.id === OWNER.id).length}, notifications ${notifs.filter((n) => n.user.id === OWNER.id).length}`);
