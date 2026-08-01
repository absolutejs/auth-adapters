import { defineImplementation, defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { CreateTwilioVerificationProviderOptions } from "./index";

export const manifest =
  defineManifest<CreateTwilioVerificationProviderOptions>()({
    contract: 2,
    identity: {
      accent: "#f22f46",
      category: "auth",
      description:
        "Twilio Verify implementation of the @absolutejs/auth verification-provider contract. Twilio owns code generation, SMS delivery, fraud checks, and verification status.",
      docsUrl: "https://github.com/absolutejs/auth-adapters/tree/main/twilio",
      name: "@absolutejs/auth-twilio",
      tagline: "Verify MFA challenges with Twilio Verify.",
    },
    implements: [
      defineImplementation<CreateTwilioVerificationProviderOptions>()({
        contract: "auth/verification-provider",
        factory: "createTwilioVerificationProvider",
        from: "@absolutejs/auth-twilio",
        requires: {
          env: [
            {
              description: "Twilio account SID",
              docsUrl: "https://console.twilio.com",
              example: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
              key: "TWILIO_ACCOUNT_SID",
              secret: true,
            },
            {
              description: "Twilio auth token",
              docsUrl: "https://console.twilio.com",
              key: "TWILIO_AUTH_TOKEN",
              secret: true,
            },
            {
              description: "Twilio Verify Service SID",
              docsUrl: "https://console.twilio.com/us1/develop/verify/services",
              example: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
              key: "TWILIO_VERIFY_SERVICE_SID",
              secret: true,
            },
          ],
          peers: [
            {
              name: "twilio",
              range: ">=6.0.0 <7",
              reason: "Twilio Verify SDK client",
            },
          ],
        },
        settings: Type.Object({
          serviceTokenTtlMs: Type.Integer({
            description:
              "Token validity configured on the Verify Service, in milliseconds.",
            maximum: 86400000,
            minimum: 120000,
            title: "Verification code lifetime",
          }),
          verifyServiceSid: Type.String({
            description: "Twilio Verify Service SID.",
            title: "Verify Service SID",
          }),
        }),
        title: "Twilio Verify",
        wiring: {
          code: "createTwilioVerificationProvider({ client: new Twilio(${env.TWILIO_ACCOUNT_SID}, ${env.TWILIO_AUTH_TOKEN}), verifyServiceSid: ${env.TWILIO_VERIFY_SERVICE_SID}, ...${settings} })",
          imports: [
            {
              from: "@absolutejs/auth-twilio",
              names: ["createTwilioVerificationProvider"],
            },
            { from: "twilio", names: ["Twilio"] },
          ],
        },
      }),
    ],
    settings: Type.Object({}),
    wiring: [],
  });
