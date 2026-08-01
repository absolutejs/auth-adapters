# @absolutejs/auth-twilio

Twilio Verify implementation of the `auth/verification-provider` contract from
`@absolutejs/auth`. Twilio owns OTP generation, delivery, fraud evaluation, and
verification status; Absolute Auth owns enrollment, MFA policy, and session
promotion.

This is intentionally separate from `@absolutejs/dispatch-twilio`, which sends
application-authored alerts through Programmable Messaging.

## Install

```sh
bun add @absolutejs/auth @absolutejs/auth-twilio twilio
```

## Usage

```ts
import { auth } from "@absolutejs/auth";
import { createTwilioVerificationProvider } from "@absolutejs/auth-twilio";
import { Twilio } from "twilio";

const client = new Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const authPlugin = await auth({
  // credentials, mfa, stores, providersConfiguration, etc.
  verificationProvider: createTwilioVerificationProvider({
    profile: {
      client,
      verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID!,
    },
    // Must match the token lifetime configured on the Verify Service.
    serviceTokenTtlMs: 10 * 60 * 1000,
  }),
});
```

Optional per-purpose templates keep enrollment and login copy distinct:

```ts
createTwilioVerificationProvider({
  profile: { client, verifyServiceSid },
  serviceTokenTtlMs: 600_000,
  templates: {
    mfa_enrollment: { sms: "HJ...", whatsapp: "HJ..." },
    mfa_challenge: { call: "HJ...", sms: "HJ..." },
  },
});
```

The adapter supports SMS, WhatsApp, and voice-call OTP channels, locale,
rate-limit buckets, and tenant-to-account/Verify-Service routing. Twilio's
Fraud Guard risk check is enabled only for SMS, the channel Twilio supports it
on. By default tags contain only the purpose; `buildTags` is an
explicit opt-in and should never return direct personal data. Unknown Verify
statuses fail closed.

## Boundaries

- `@absolutejs/auth` enforces enrollment state, resend cooldown, failed-attempt
  policy, audit events, and session promotion.
- Twilio Verify generates and checks the code and applies service-level fraud
  and rate-limit policy.
- The configured `serviceTokenTtlMs` is an application assertion because
  Twilio's start response does not expose the service token lifetime.
- Prefer Twilio API keys in production when constructing the SDK client.

## License

Apache-2.0.
