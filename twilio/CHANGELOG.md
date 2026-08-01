# Changelog

## [0.2.0] — 2026-08-01

- Add SMS, WhatsApp, and voice-call verification channels.
- Forward locale and provider rate-limit buckets to Twilio Verify.
- Route tenants to isolated Verify Services.
- Cancel provider challenges when auth rolls back or replaces them.
- Remove auth subjects from default provider tags and make custom tags opt-in.
- Require the atomic verification lifecycle in `@absolutejs/auth` 0.59.

## [0.1.0] — 2026-07-31

- Implement `auth/verification-provider` with Twilio Verify SMS.
- Normalize Verify lifecycle statuses into the auth contract.
- Keep SMS risk checking enabled for every challenge.
- Support distinct enrollment and login templates.
- Validate service, template, destination, and token-lifetime configuration.
- Fail closed on unexpected provider statuses.
