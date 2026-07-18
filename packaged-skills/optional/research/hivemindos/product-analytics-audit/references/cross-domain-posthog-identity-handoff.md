# Cross-domain PostHog identity handoff

Use when funnel events span different root domains (e.g. a `yourproduct.com` landing page -> a `yourproduct.app` app). Browser cookies/localStorage cannot be shared across root domains, so PostHog's anonymous distinct ID will reset at the domain boundary unless you explicitly hand it off.

## Symptom

- Landing events have healthy counts (`landing_cta_clicked`, `landing_signup_intent`).
- App/auth events have healthy counts (`login_started`, `login_completed`, `message_sent`).
- Per-person overlap between landing CTA and login is zero or near zero.
- Direct event counts look fine, but funnels/retention/attribution are disconnected.

## Root cause

A typical broken path:

1. User visits landing site; PostHog creates anonymous ID `landing_anon_123`.
2. User clicks CTA to a different root domain; app cannot read landing cookies/localStorage.
3. App initializes PostHog with a new anonymous ID `app_anon_456`.
4. User logs in; app identifies/aliases `app_anon_456` to `user_789`.
5. `landing_anon_123` is never linked to `user_789`.

## Implementation pattern

### Landing site

On tracked CTA click, append a handoff payload to the app URL:

```ts
const landingDistinctId = posthog.get_distinct_id();
const params = new URLSearchParams(window.location.search);

params.set('ph_landing_distinct_id', landingDistinctId);
params.set('landing_url', window.location.href);
params.set('landing_referrer', document.referrer || 'direct');
params.set('cta_location', location);
params.set('cta_text', text);

posthog.capture('landing_cta_clicked', { cta_location: location, cta_text: text });
posthog.capture('landing_signup_intent', { cta_location: location, cta_text: text });

window.location.href = `https://app.yourproduct.app/auth/login?${params.toString()}`;
```

Also convert raw app links to a shared tracked link/helper so all CTAs carry the handoff payload. Raw `href="https://app.yourproduct.app"` links bypass the handoff.

### App site

On arrival, read and persist the handoff params before OAuth/login redirects:

```ts
const params = new URLSearchParams(window.location.search);
const landingDistinctId = params.get('ph_landing_distinct_id');

if (landingDistinctId) {
  sessionStorage.setItem('app_landing_distinct_id', landingDistinctId);
  localStorage.setItem('app_landing_distinct_id', landingDistinctId);

  posthog.register({
    landing_distinct_id: landingDistinctId,
    landing_url: params.get('landing_url'),
    landing_referrer: params.get('landing_referrer'),
    landing_cta_location: params.get('cta_location'),
    landing_cta_text: params.get('cta_text'),
  });

  posthog.capture('landing_to_app_arrived', { landing_distinct_id: landingDistinctId });
}
```

### Auth callback / successful signup

Once the canonical user ID exists, link the landing anonymous distinct ID to the user. Cover both paths:

1. **OAuth/server callback path** — preserve `ph_landing_distinct_id` in the provider callback URL (or in a `next` URL that the server can parse), then capture the alias server-side after Supabase/session exchange succeeds.
2. **Client identity-sync path** — after any non-OAuth login (wallet, email OTP, embedded auth) calls `identify(userId)`, read the persisted handoff from `localStorage` and capture the same alias/link events once. Without this second path, only OAuth users get linked.

```ts
// Server callback after user ID is known
ph.capture({
  distinctId: landingDistinctId,
  event: '$create_alias',
  properties: { alias: userId, source: 'landing_handoff' },
});

ph.capture({
  distinctId: userId,
  event: 'landing_user_linked',
  properties: { landing_distinct_id: landingDistinctId, method: provider },
});
```

```ts
// Client identity sync after identify(userId), for non-OAuth flows
const handoff = getStoredLandingHandoff();
if (handoff?.landingDistinctId && handoff.landingDistinctId !== userId) {
  posthog.capture('$create_alias', {
    alias: userId,
    distinct_id: handoff.landingDistinctId,
    source: 'landing_handoff',
  });
  posthog.capture('landing_user_linked', {
    landing_distinct_id: handoff.landingDistinctId,
  });
}
```

Verify current PostHog alias semantics before implementation; newer PostHog versions can also merge via `identify(userId)` if the anonymous ID is available in the same client instance, but cross-domain handoff still needs to pass the original anonymous ID.

## Instrumentation pitfalls

- Lazy-loaded PostHog can miss quick CTA clicks. CTA handlers should ensure PostHog is loaded or use a short flush/beacon delay before navigation.
- Wrappers that do `if (!isReady()) return` silently drop early login/UTM events. Queue until PostHog is ready or initialize earlier on auth/login pages.
- UTM capture should retry if PostHog is not ready; a one-shot delayed call often produces null attribution.
- Preserve the handoff through OAuth redirects. A cookie scoped to the app's root domain works after arrival on the app domain; otherwise put the handoff ID in the callback `next` param.

## Verification checklist

In a fresh incognito flow, one final merged PostHog person should show:

- `landing_session_start`
- `landing_cta_clicked`
- `landing_signup_intent`
- `landing_to_app_arrived`
- `login_started`
- `login_completed`
- `landing_user_linked`
- first activation event, e.g. `message_sent`

Then rerun a PostHog overlap query: users with both landing CTA and login should be non-zero.

## Code verification pattern

When implementing this in two separate repos, verify at three levels:

- **Landing compile/lint:** install deps for the landing repo and run its typecheck/lint on the changed CTA helper.
- **App changed-file lint:** run ESLint on the handoff helper, provider, login page, and auth callback.
- **Targeted analytics suite:** run existing PostHog analytics tests if present; if the full app typecheck fails on unrelated pre-existing asset/module declaration issues, explicitly report that caveat and run a targeted TS check on the new handoff helper.

Example commands:

```bash
# landing
npm ci
npx tsc --noEmit
npx eslint lib/posthog-cta.ts

# app
corepack pnpm install --frozen-lockfile
corepack pnpm exec eslint src/lib/analytics/landing-handoff.ts src/lib/providers/PostHogProvider.tsx src/app/auth/callback/route.ts src/app/auth/login/page.tsx
corepack pnpm test -- src/__tests__/posthog-analytics.e2e.test.ts --runInBand
corepack pnpm exec tsc --noEmit --skipLibCheck --moduleResolution node --module commonjs --target es2022 --jsx react-jsx src/lib/analytics/landing-handoff.ts
```
