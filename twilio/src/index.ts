import {
  VerificationProviderError,
  type VerificationCheckResult,
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
          create: (input: {
            channel: "sms";
            riskCheck: "enable";
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
  client: TwilioVerifyClientLike;
  /** Must match the token validity configured on the Twilio Verify Service. */
  serviceTokenTtlMs: number;
  templates?: Partial<Record<VerificationPurpose, string>>;
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
  if (!VERIFY_SERVICE_SID.test(options.verifyServiceSid)) {
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
  for (const templateSid of Object.values(options.templates ?? {})) {
    if (templateSid !== undefined && !TEMPLATE_SID.test(templateSid)) {
      throw new TwilioVerificationConfigurationError(
        "template SIDs must start with HJ and contain 32 hexadecimal characters",
      );
    }
  }
};

const validateInput = (input: VerificationStartInput) => {
  if (input.channel !== "sms") {
    throw new TwilioVerificationConfigurationError(
      "@absolutejs/auth-twilio currently supports the SMS verification channel",
    );
  }
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
  const service = options.client.verify.v2.services(options.verifyServiceSid);

  return {
    name: "twilio-verify",
    start: async (input) => {
      validateInput(input);
      const templateSid = options.templates?.[input.purpose];
      let response;
      try {
        response = await service.verifications.create({
          channel: "sms",
          riskCheck: "enable",
          tags: JSON.stringify({
            purpose: input.purpose,
            subject: input.subject,
          }),
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
