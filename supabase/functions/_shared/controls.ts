/**
 * App controls: the admin panel's remote switches (migration 092), as the api
 * and app-config functions use them.
 *
 * The merge itself is done in SQL (`get_app_controls`); this file only reads
 * the headers that say who is asking, turns a switch that is off into a plain
 * refusal, and shapes the public answer. No Deno imports on purpose, so it can
 * be exercised from Node.
 */

export const PLATFORM_HEADER = "x-taskdrop-platform";
export const VERSION_HEADER = "x-taskdrop-app-version";

export const PLATFORMS = ["web", "android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Who is asking. A request with no (or an unknown) platform is the old app. */
export type Client = { platform: Platform | null; appVersion: string | null };

const VERSION = /^[0-9]+(\.[0-9]+){0,2}$/;

export function readClient(headers: { get(name: string): string | null }): Client {
  const p = (headers.get(PLATFORM_HEADER) ?? "").trim().toLowerCase();
  const v = (headers.get(VERSION_HEADER) ?? "").trim();
  return {
    platform: (PLATFORMS as readonly string[]).includes(p) ? (p as Platform) : null,
    appVersion: VERSION.test(v) ? v : null,
  };
}

/** The merged controls for one caller, exactly as `get_app_controls` returns them. */
export type Controls = {
  platform: Platform | null;
  maintenance: boolean;
  maintenance_message: string | null;
  min_version: string | null;
  update_required: boolean;
  update_url: string | null;
  signups_open: boolean;
  signin_phone: boolean;
  signin_google: boolean;
  signin_apple: boolean;
  signin_password: boolean;
  posting: boolean;
  bidding: boolean;
  topups: boolean;
  withdrawals: boolean;
  promotions: boolean;
  chat_photos: boolean;
  /** When on, posting, offers and withdrawals need a confirmed phone number (migration 097). */
  require_phone_verified: boolean;
  banner_text: string | null;
  banner_level: "info" | "warning" | "critical" | null;
  banner_link: string | null;
};

/** The switches the api can refuse an operation for. */
export type Feature = "posting" | "bidding" | "topups" | "withdrawals" | "promotions" | "chat_photos";

const FEATURE_WORDS: Record<Feature, string> = {
  posting: "Posting new tasks",
  bidding: "Sending offers",
  topups: "Adding money",
  withdrawals: "Withdrawals",
  promotions: "Promotions",
  chat_photos: "Sending photos in chat",
};

/** Which api operation sits behind which switch. Anything not listed is never switched off by a feature flag. */
const OP_FEATURE: Record<string, Feature> = {
  createTask: "posting",
  placeBid: "bidding",
  updateBid: "bidding",
  requestWithdrawal: "withdrawals",
  startPromotion: "promotions",
};

/** What keeps working in maintenance and below the minimum version: harmless bookkeeping. */
const ALWAYS_ALLOWED = new Set(["recordDevice", "touchPresence"]);

/** The start of a chat message that is a photo (apps/mobile/src/data/api.ts CHAT_MEDIA_PREFIX). */
const CHAT_MEDIA_PREFIX = "::media::";

export const MAINTENANCE_FALLBACK = "TaskDrop is being updated. Please try again in a little while.";
export const UPDATE_REQUIRED_MESSAGE = "Please update TaskDrop to keep using it.";

export type Refusal = {
  message: string;
  code: "MAINTENANCE" | "UPDATE_REQUIRED" | "FEATURE_OFF" | "PHONE_REQUIRED";
  details: string | null;
};

/** The operations that need a confirmed phone while `require_phone_verified` is on. */
const PHONE_OPS = new Set(["createTask", "placeBid", "updateBid", "requestWithdrawal"]);
export const PHONE_REQUIRED_MESSAGE = "Please confirm your phone number first. You can do it in Settings.";

/** What the api knows about the caller, beyond the switches. */
export type Caller = { phoneVerified?: boolean };

export const featureOffMessage = (f: Feature) => `${FEATURE_WORDS[f]} is switched off for now. Please try again later.`;

/**
 * Whether `op` may run under these controls; null when it may.
 *
 * `details` carries the switch name for FEATURE_OFF so the app can react to
 * it without parsing words. Missing controls (the lookup failed) never refuse:
 * an outage of the switches must not become an outage of the app.
 */
export function refusalFor(
  op: unknown,
  controls: Controls | null,
  args: Record<string, unknown> = {},
  caller: Caller = {},
): Refusal | null {
  if (!controls || typeof op !== "string" || ALWAYS_ALLOWED.has(op)) return null;
  if (controls.maintenance) {
    return { message: controls.maintenance_message?.trim() || MAINTENANCE_FALLBACK, code: "MAINTENANCE", details: null };
  }
  if (controls.update_required) {
    return { message: UPDATE_REQUIRED_MESSAGE, code: "UPDATE_REQUIRED", details: controls.min_version };
  }
  let feature: Feature | undefined = Object.prototype.hasOwnProperty.call(OP_FEATURE, op) ? OP_FEATURE[op] : undefined;
  if (op === "createUpload" && args.purpose === "chat") feature = "chat_photos";
  if (op === "sendMessage" && typeof args.body === "string" && args.body.startsWith(CHAT_MEDIA_PREFIX)) feature = "chat_photos";
  if (feature && !controls[feature]) return { message: featureOffMessage(feature), code: "FEATURE_OFF", details: feature };
  // Only a known "no": if we could not tell whether the phone is confirmed, the request goes ahead.
  if (controls.require_phone_verified && PHONE_OPS.has(op) && caller.phoneVerified === false) {
    return { message: PHONE_REQUIRED_MESSAGE, code: "PHONE_REQUIRED", details: null };
  }
  return null;
}

/** Read what `get_app_controls` returned; null if it is not the shape we expect. */
export function parseControls(data: unknown): Controls | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const bool = (k: string, dflt: boolean) => (typeof d[k] === "boolean" ? (d[k] as boolean) : dflt);
  const text = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string) : null);
  const level = d.banner_level === "info" || d.banner_level === "warning" || d.banner_level === "critical" ? d.banner_level : null;
  return {
    platform: (PLATFORMS as readonly string[]).includes(String(d.platform)) ? (d.platform as Platform) : null,
    maintenance: bool("maintenance", false),
    maintenance_message: text("maintenance_message"),
    min_version: text("min_version"),
    update_required: bool("update_required", false),
    update_url: text("update_url"),
    signups_open: bool("signups_open", true),
    signin_phone: bool("signin_phone", true),
    signin_google: bool("signin_google", true),
    signin_apple: bool("signin_apple", true),
    signin_password: bool("signin_password", true),
    posting: bool("posting", true),
    bidding: bool("bidding", true),
    topups: bool("topups", true),
    withdrawals: bool("withdrawals", true),
    promotions: bool("promotions", true),
    chat_photos: bool("chat_photos", true),
    require_phone_verified: bool("require_phone_verified", false),
    banner_text: text("banner_text"),
    banner_level: level,
    banner_link: text("banner_link"),
  };
}

/**
 * What the app-config function answers (and what the app reads). The admin
 * panel's preview should render exactly this.
 */
export type AppConfig = {
  platform: Platform | null;
  appVersion: string | null;
  maintenance: { on: boolean; message: string | null };
  update: { required: boolean; minVersion: string | null; url: string | null };
  features: {
    signups: boolean;
    signInPhone: boolean;
    signInGoogle: boolean;
    signInApple: boolean;
    signInPassword: boolean;
    posting: boolean;
    bidding: boolean;
    topups: boolean;
    withdrawals: boolean;
    promotions: boolean;
    chatPhotos: boolean;
  };
  /** True when posting, offers and withdrawals need a confirmed phone number. */
  requirePhoneVerified: boolean;
  banner: { text: string; level: "info" | "warning" | "critical"; link: string | null } | null;
  /** How long the app may keep this before asking again. */
  ttlSeconds: number;
};

export const CONFIG_TTL_SECONDS = 60;

export function publicConfig(c: Controls, client: Client): AppConfig {
  return {
    platform: client.platform,
    appVersion: client.appVersion,
    maintenance: { on: c.maintenance, message: c.maintenance ? c.maintenance_message?.trim() || MAINTENANCE_FALLBACK : null },
    update: { required: c.update_required, minVersion: c.min_version, url: c.update_url },
    features: {
      signups: c.signups_open,
      signInPhone: c.signin_phone,
      signInGoogle: c.signin_google,
      signInApple: c.signin_apple,
      signInPassword: c.signin_password,
      posting: c.posting,
      bidding: c.bidding,
      topups: c.topups,
      withdrawals: c.withdrawals,
      promotions: c.promotions,
      chatPhotos: c.chat_photos,
    },
    requirePhoneVerified: c.require_phone_verified,
    banner: c.banner_text ? { text: c.banner_text, level: c.banner_level ?? "info", link: c.banner_link } : null,
    ttlSeconds: CONFIG_TTL_SECONDS,
  };
}

/** What the app uses when it cannot reach app-config: everything on. */
export const OPEN_CONFIG: AppConfig = publicConfig(parseControls({})!, { platform: null, appVersion: null });

/**
 * A short-lived memo of controls per (platform, version), kept in the function
 * instance. Every api call needs the controls; one lookup per half minute per
 * instance keeps that from becoming a database round trip per call. If a
 * refresh fails, the last good answer is used rather than failing the request.
 */
export class ControlsCache {
  private entries = new Map<string, { at: number; value: Controls }>();
  private inflight = new Map<string, Promise<Controls | null>>();

  constructor(private ttlMs: number, private now: () => number = Date.now) {}

  get(client: Client, load: () => Promise<Controls | null>): Promise<Controls | null> {
    const key = `${client.platform ?? "-"}|${client.appVersion ?? "-"}`;
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .catch(() => null)
      .then((value) => {
        this.inflight.delete(key);
        if (value) {
          // A stray caller sending a different version every time must not grow this without bound.
          if (this.entries.size >= 200) this.entries.clear();
          this.entries.set(key, { at: this.now(), value });
          return value;
        }
        return hit?.value ?? null;
      });
    this.inflight.set(key, p);
    return p;
  }
}
