# AbsoluteJS Auth Adapters

Provider implementations for extension contracts owned by `@absolutejs/auth`.

| Package                   | Contract                     | Provider surface |
| ------------------------- | ---------------------------- | ---------------- |
| `@absolutejs/auth-twilio` | `auth/verification-provider` | Twilio Verify    |

Authentication features and routes remain in `@absolutejs/auth`; this repository
contains vendor infrastructure behind those stable contracts.

## Installation

```sh
bun add @absolutejs/auth @absolutejs/auth-twilio twilio
```

Use the adapter when Absolute Auth should deliver and verify MFA challenges through Twilio Verify. The adapter README documents service identifiers, credentials, challenge lifecycle, and test seams.
