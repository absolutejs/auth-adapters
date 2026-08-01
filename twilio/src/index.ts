import {
  VerificationProviderError,
  type VerificationCheckResult,
  type VerificationChannel,
  type VerificationProvider,
  type VerificationPurpose,
  type VerificationStartInput,
} from "@absolutejs/auth";

type TwilioVerificationStatus =
  | "approved"
  | "canceled"
  | "deleted"
  | "expired"
  | "failed"
  | "max_attempts_reached"
  | "pending";

export type TwilioVerifyClientLike = {
  verify: {
    v2: {
      services: (serviceSid: string) => {
        verificationChecks: {
          create: (input: {
            code: string;
            verificationSid: string;
          }) => Promise<{
            sid?: string;
            status: TwilioVerificationStatus | string;
          }>;
        };
        verifications: {
          (verificationSid: string): {
            update: (input: { status: "canceled" }) => Promise<unknown>;
          };
          create: (input: {
            channel: VerificationChannel;
            locale?: string;
            rateLimits?: Record<string, string>;
            riskCheck?: "enable";
            tags: string;
            templateSid?: string;
            to: string;
          }) => Promise<{
            sid?: string;
            status: TwilioVerificationStatus | string;
          }>;
        };
      };
    };
  };
};

export type CreateTwilioVerificationProviderOptions = {
  /** Default account-isolated Verify client and Service. */
  profile: TwilioVerificationProfile;
  /** Must match the token validity configured on the Twilio Verify Service. */
  serviceTokenTtlMs: number;
  /** Explicitly opt in to provider tags. The auth subject is never sent by default. */
  buildTags?: (input: VerificationStartInput) => Record<string, string>;
  /** Route tenants to isolated clients and Verify Services. */
  resolveProfile?: (
    input: VerificationStartInput,
  ) => Promise<TwilioVerificationProfile> | TwilioVerificationProfile;
  /** Templates are purpose-and-channel specific; accidental cross-channel reuse is blocked. */
  templates?: Partial<
    Record<VerificationPurpose, Partial<Record<VerificationChannel, string>>>
  >;
};

export type TwilioVerificationProfile = {
  client: TwilioVerifyClientLike;
  verifyServiceSid: string;
};

export class TwilioVerificationConfigurationError extends Error {
  override name = "TwilioVerificationConfigurationError";
}

export class TwilioVerificationResponseError extends Error {
  override name = "TwilioVerificationResponseError";
}

const VERIFY_SERVICE_SID = /^VA[0-9a-fA-F]{32}$/;
const VERIFICATION_SID = /^VE[0-9a-fA-F]{32}$/;
const TEMPLATE_SID = /^HJ[0-9a-fA-F]{32}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const MIN_TTL_MS = 120_000;
const MAX_TTL_MS = 86_400_000;

const providerError = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number(error.code)
      : undefined;
  const kind =
    code === 60203
      ? "rate_limited"
      : code === 60205
        ? "invalid_destination"
        : "unavailable";
  return new VerificationProviderError({
    cause: error,
    kind,
    message: `Twilio Verify request failed${code === undefined ? "" : ` (${code})`}`,
    provider: "twilio-verify",
  });
};

const validateOptions = (options: CreateTwilioVerificationProviderOptions) => {
  if (!VERIFY_SERVICE_SID.test(options.profile.verifyServiceSid)) {
    throw new TwilioVerificationConfigurationError(
      "verifyServiceSid must be a Twilio Verify Service SID (VA followed by 32 hexadecimal characters)",
    );
  }
  if (
    !Number.isInteger(options.serviceTokenTtlMs) ||
    options.serviceTokenTtlMs < MIN_TTL_MS ||
    options.serviceTokenTtlMs > MAX_TTL_MS
  ) {
    throw new TwilioVerificationConfigurationError(
      "serviceTokenTtlMs must be an integer between 120000 and 86400000",
    );
  }
  for (const channels of Object.values(options.templates ?? {})) {
    for (const templateSid of Object.values(channels ?? {})) {
      if (templateSid !== undefined && !TEMPLATE_SID.test(templateSid)) {
        throw new TwilioVerificationConfigurationError(
          "template SIDs must start with HJ and contain 32 hexadecimal characters",
        );
      }
    }
  }
};

const validateInput = (input: VerificationStartInput) => {
  if (!E164.test(input.to)) {
    throw new TwilioVerificationConfigurationError(
      "verification destination must be an E.164 phone number",
    );
  }
};

const validateReference = (reference: string) => {
  if (!VERIFICATION_SID.test(reference)) {
    throw new TwilioVerificationConfigurationError(
      "verification reference must be a Twilio Verification SID (VE followed by 32 hexadecimal characters)",
    );
  }
};

const normalizeStatus = (status: string): VerificationCheckResult["status"] => {
  if (status === "deleted") return "canceled";
  if (
    status === "approved" ||
    status === "canceled" ||
    status === "expired" ||
    status === "failed" ||
    status === "max_attempts_reached" ||
    status === "pending"
  ) {
    return status;
  }
  throw new TwilioVerificationResponseError(
    `unsupported Twilio Verify status: ${status}`,
  );
};

export const createTwilioVerificationProvider = (
  options: CreateTwilioVerificationProviderOptions,
): VerificationProvider => {
  validateOptions(options);
  const resolveService = async (input: VerificationStartInput) => {
    const profile = options.resolveProfile
      ? await options.resolveProfile(input)
      : options.profile;
    if (!VERIFY_SERVICE_SID.test(profile.verifyServiceSid)) {
      throw new TwilioVerificationConfigurationError(
        "resolved Verify Service SID must start with VA and contain 32 hexadecimal characters",
      );
    }

    return profile.client.verify.v2.services(profile.verifyServiceSid);
  };

  return {
    name: "twilio-verify",
    cancel: async (input) => {
      validateInput(input);
      validateReference(input.reference);
      try {
        const service = await resolveService(input);
        await service.verifications(input.reference).update({
          status: "canceled",
        });
      } catch (error) {
        if (error instanceof TwilioVerificationConfigurationError) throw error;
        throw providerError(error);
      }
    },
    start: async (input) => {
      validateInput(input);
      const templateSid = options.templates?.[input.purpose]?.[input.channel];
      let response;
      try {
        const service = await resolveService(input);
        response = await service.verifications.create({
          channel: input.channel,
          ...(input.locale === undefined ? {} : { locale: input.locale }),
          ...(input.rateLimits === undefined
            ? {}
            : { rateLimits: { ...input.rateLimits } }),
          ...(input.channel === "sms" ? { riskCheck: "enable" as const } : {}),
          tags: JSON.stringify(
            options.buildTags?.(input) ?? { purpose: input.purpose },
          ),
          ...(templateSid === undefined ? {} : { templateSid }),
          to: input.to,
        });
      } catch (error) {
        throw providerError(error);
      }
      if (response.status !== "pending") {
        throw new TwilioVerificationResponseError(
          `Twilio Verify start returned ${response.status}`,
        );
      }
      if (response.sid === undefined || !VERIFICATION_SID.test(response.sid)) {
        throw new TwilioVerificationResponseError(
          "Twilio Verify start did not return a valid verification SID",
        );
      }
      return {
        expiresAt: Date.now() + options.serviceTokenTtlMs,
        reference: response.sid,
      };
    },
    check: async (input) => {
      validateInput(input);
      validateReference(input.reference);
      let response;
      try {
        const service = await resolveService(input);
        response = await service.verificationChecks.create({
          code: input.code,
          verificationSid: input.reference,
        });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? Number(error.code)
            : undefined;
        if (code === 60202) return { status: "max_attempts_reached" };
        if (code === 20404) return { status: "expired" };
        throw providerError(error);
      }
      return {
        ...(response.sid === undefined ? {} : { reference: response.sid }),
        status: normalizeStatus(response.status),
      };
    },
  };
};
