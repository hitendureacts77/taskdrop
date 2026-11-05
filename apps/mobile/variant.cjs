/**
 * Which TaskDrop is being built (plan task 5.0a). One switch, APP_VARIANT, decides the app's
 * identity and which Expo project it belongs to, and `checkVariant` refuses a build that mixes the
 * staging and production copies (hole H15).
 *
 *   APP_VARIANT       identity                                    server       Expo project
 *   (not set)         today's app, com.taskdrop.app, "TaskDrop"    staging      @hitendureacts/taskdrop
 *   play-testing      the same as not set; the Play testing build  staging      @hitendureacts/taskdrop
 *   staging           TaskDrop Staging, com.taskdrop.app.staging   staging      @hitendureacts/taskdrop
 *   production        TaskDrop, com.taskdrop.app                   production   @hitendureacts/taskdrop-production
 *
 * "Not set" and `play-testing` change nothing in the app config on purpose: the existing beta app and
 * its update fingerprint stay exactly as they are until task 5.0c moves testers to the staging app.
 *
 * Plain CommonJS with no dependencies, so app.config.js, scripts/build-guard.mjs and the tests can all
 * load it. It never prints a value from the environment, only names.
 */

/** The staging Supabase project ref. It never changes (docs/ULTIMATE_PLAN.md, account rules). */
const STAGING_SUPABASE_REF = 'wjxvingpfbfvkfqhrguj';
/** The staging Expo project (@hitendureacts/taskdrop). */
const STAGING_EAS_PROJECT_ID = '08aa002b-4eea-4952-a62a-ec9245e77953';
/**
 * Web addresses that belong to staging. A production build may not use one as its app address.
 * Plan task 5.10, option B (swapping taskdrop.in onto production) means removing the first two here.
 */
const STAGING_HOSTS = ['taskdrop.in', 'www.taskdrop.in', 'admin.taskdrop.in', 'taskdrop-five.vercel.app'];

const VARIANTS = {
  'play-testing': { server: 'staging', sentryProject: 'taskdrop', identity: null },
  staging: {
    server: 'staging',
    sentryProject: 'taskdrop',
    identity: {
      name: 'TaskDrop Staging',
      scheme: 'taskdrop-staging',
      androidPackage: 'com.taskdrop.app.staging',
      icon: './assets/icon-staging.png',
      adaptiveForeground: './assets/android-icon-foreground-staging.png',
    },
  },
  production: {
    server: 'production',
    sentryProject: 'taskdrop-production',
    identity: { slug: 'taskdrop-production' },
  },
};

/** The variant name for an environment. A missing value means today's app. */
function resolveVariant(env) {
  const raw = String((env && env.APP_VARIANT) || '').trim().toLowerCase();
  return raw || 'play-testing';
}

function supabaseRef(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co(?:[/:?#]|$)/i.exec(String(url || '').trim());
  return m ? m[1].toLowerCase() : null;
}

function hostOf(url) {
  try {
    return new URL(String(url || '').trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const set = (env, name) => String((env && env[name]) || '').trim() !== '';

/**
 * Everything wrong with this build, as plain sentences (names only, never values). An empty list
 * means the build may go ahead. `ctx.androidBuild` is true for a native Android build or update.
 */
function checkVariant(env, ctx = {}) {
  const problems = [];
  const variant = resolveVariant(env);
  if (!VARIANTS[variant]) {
    return [`APP_VARIANT is "${variant}". It must be unset, "play-testing", "staging" or "production".`];
  }
  const production = variant === 'production';
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const ref = supabaseRef(url);

  if (production) {
    if (ref === STAGING_SUPABASE_REF) problems.push('A production build points at the STAGING server (EXPO_PUBLIC_SUPABASE_URL).');
    if (ctx.androidBuild && !set(env, 'EXPO_PUBLIC_SUPABASE_URL')) {
      problems.push('A production Android build has no EXPO_PUBLIC_SUPABASE_URL. It must come from the production Expo project.');
    }
    for (const name of ['EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN', 'ALLOW_ANY_OTP', 'TEST_PHONES']) {
      if (set(env, name)) problems.push(`${name} is set in a production build. It must never be.`);
    }
    const testKeys = Object.keys(env).filter((k) => /rzp_test_/.test(String(env[k] || '')));
    if (testKeys.length) problems.push(`A Razorpay test key is present in a production build (${testKeys.join(', ')}).`);
    if (set(env, 'EXPO_PUBLIC_SENTRY_ENVIRONMENT') && env.EXPO_PUBLIC_SENTRY_ENVIRONMENT.trim() !== 'production') {
      problems.push('EXPO_PUBLIC_SENTRY_ENVIRONMENT is not "production" in a production build.');
    }
    if (set(env, 'EXPO_PUBLIC_APP_ENV') && env.EXPO_PUBLIC_APP_ENV.trim().toLowerCase() !== 'production') {
      problems.push('EXPO_PUBLIC_APP_ENV is not "production" in a production build.');
    }
    if (ctx.androidBuild && !set(env, 'TASKDROP_PRODUCTION_EAS_PROJECT_ID')) {
      problems.push('A production Android build has no TASKDROP_PRODUCTION_EAS_PROJECT_ID (the production Expo project, task 5.7).');
    }
    if (ctx.androidBuild && !set(env, 'EXPO_PUBLIC_APP_URL')) {
      problems.push('A production Android build has no EXPO_PUBLIC_APP_URL (the production web address, tasks 5.8 and 5.10).');
    }
    const appHost = hostOf(env.EXPO_PUBLIC_APP_URL);
    if (appHost && STAGING_HOSTS.includes(appHost)) {
      problems.push(`EXPO_PUBLIC_APP_URL is a staging address (${appHost}) in a production build.`);
    }
  } else {
    if (ref && ref !== STAGING_SUPABASE_REF) problems.push('A staging build points at a server that is not the staging server (EXPO_PUBLIC_SUPABASE_URL).');
    const testOnly = Object.keys(env).filter((k) => /rzp_live_/.test(String(env[k] || '')));
    if (testOnly.length) problems.push(`A Razorpay live key is present in a staging build (${testOnly.join(', ')}).`);
    // No rule on EXPO_PUBLIC_SENTRY_ENVIRONMENT here: it is only a label on error reports, and the staging
    // website's Vercel project has carried "production" in it since before the two copies were split
    // (found 5 Nov, when this rule stopped the staging build). The staging-side checks that protect
    // the copies are the server address, the live key and EXPO_PUBLIC_APP_ENV.
    if (set(env, 'EXPO_PUBLIC_APP_ENV') && env.EXPO_PUBLIC_APP_ENV.trim().toLowerCase() === 'production') {
      problems.push('EXPO_PUBLIC_APP_ENV is "production" in a staging build.');
    }
  }
  return problems;
}

/** The Sentry project the build uploads its readable stacks to. */
function sentryProject(env) {
  return VARIANTS[resolveVariant(env)].sentryProject;
}

/**
 * The app config for this variant. `play-testing` and "not set" return the config unchanged (the same
 * object), so today's builds keep their fingerprint.
 */
function applyVariant(config, env) {
  const variant = resolveVariant(env);
  const v = VARIANTS[variant];
  if (variant === 'play-testing') return config;
  const out = { ...config };
  const id = v.identity;
  if (id.name) out.name = id.name;
  if (id.slug) out.slug = id.slug;
  if (id.scheme) out.scheme = id.scheme;
  if (id.icon) out.icon = id.icon;
  if (id.androidPackage || id.adaptiveForeground) {
    out.android = { ...config.android };
    if (id.androidPackage) out.android.package = id.androidPackage;
    if (id.adaptiveForeground) {
      out.android.adaptiveIcon = { ...(config.android && config.android.adaptiveIcon), foregroundImage: id.adaptiveForeground };
    }
  }
  if (variant === 'production') {
    // The base config carries the staging Expo project. A production build never keeps it: it uses
    // the production project, or has no Expo project at all (a web build) and so no update address.
    const projectId = String(env.TASKDROP_PRODUCTION_EAS_PROJECT_ID || '').trim();
    const cleanExtra = { ...(config.extra || {}) };
    delete cleanExtra.eas;
    if (projectId) {
      out.updates = { ...(config.updates || {}), url: `https://u.expo.dev/${projectId}` };
      out.extra = { ...cleanExtra, eas: { projectId } };
    } else {
      delete out.updates;
      out.extra = cleanExtra;
    }
  }
  return out;
}

module.exports = {
  STAGING_SUPABASE_REF,
  STAGING_EAS_PROJECT_ID,
  STAGING_HOSTS,
  VARIANTS,
  resolveVariant,
  supabaseRef,
  checkVariant,
  sentryProject,
  applyVariant,
};
