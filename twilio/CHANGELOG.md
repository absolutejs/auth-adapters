# Changelog

## [0.1.0] — 2026-07-31

- Implement `auth/verification-provider` with Twilio Verify SMS.
- Normalize Verify lifecycle statuses into the auth contract.
- Keep SMS risk checking enabled for every challenge.
- Support distinct enrollment and login templates.
- Validate service, template, destination, and token-lifetime configuration.
- Fail closed on unexpected provider statuses.
