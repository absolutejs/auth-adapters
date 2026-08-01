import { describe, expect, test } from "bun:test";
import {
  createTwilioVerificationProvider,
  TwilioVerificationConfigurationError,
  TwilioVerificationResponseError,
  type TwilioVerifyClientLike,
} from "../src";
import { VerificationProviderError } from "@absolutejs/auth";

const VERIFY_SID = `VA${"0".repeat(32)}`;
const TEMPLATE_SID = `HJ${"1".repeat(32)}`;
const VERIFICATION_SID = `VE${"3".repeat(32)}`;
const PHONE = "+12025550100";

const createClient = () => {
  const starts: Array<Record<string, unknown>> = [];
  const checks: Array<Record<string, unknown>> = [];
  const cancels: Array<Record<string, unknown>> = [];
  let startStatus = "pending";
  let checkStatus = "approved";
  let checkError: unknown;
  let startError: unknown;
  let startSid: string | undefined = VERIFICATION_SID;
  const client: TwilioVerifyClientLike = {
    verify: {
      v2: {
        services: () => ({
          verificationChecks: {
            create: async (input: Record<string, unknown>) => {
              checks.push(input);
              if (checkError !== undefined) throw checkError;
              return { sid: `VE${"2".repeat(32)}`, status: checkStatus };
            },
          },
          verifications: Object.assign(
            (verificationSid: string) => ({
              update: async (request: Record<string, unknown>) => {
                cancels.push({ ...request, verificationSid });
              },
            }),
            {
              create: async (input: Record<string, unknown>) => {
                starts.push(input);
                if (startError !== undefined) throw startError;
                return {
                  ...(startSid === undefined ? {} : { sid: startSid }),
                  status: startStatus,
                };
              },
            },
          ),
        }),
      },
    },
  };
  return {
    cancels,
    checks,
    client,
    setCheckStatus: (status: string) => {
      checkStatus = status;
    },
    setCheckError: (error: unknown) => {
      checkError = error;
    },
    setStartError: (error: unknown) => {
      startError = error;
    },
    setStartStatus: (status: string) => {
      startStatus = status;
    },
    setStartSid: (sid: string | undefined) => {
      startSid = sid;
    },
    starts,
  };
};

const input = {
  channel: "sms" as const,
  purpose: "mfa_challenge" as const,
  subject: "user-1",
  to: PHONE,
};

describe("createTwilioVerificationProvider", () => {
  test("starts a risk-checked verification without leaking the auth subject", async () => {
    const mock = createClient();
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      templates: { mfa_challenge: TEMPLATE_SID },
      verifyServiceSid: VERIFY_SID,
    });
    const before = Date.now();
    const result = await provider.start(input);

    expect(mock.starts).toEqual([
      {
        channel: "sms",
        riskCheck: "enable",
        tags: JSON.stringify({ purpose: "mfa_challenge" }),
        templateSid: TEMPLATE_SID,
        to: PHONE,
      },
    ]);
    expect(result.reference).toMatch(/^VE/);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
  });

  test("supports channel, locale, rate-limit, tenant service routing, and cancellation", async () => {
    const mock = createClient();
    const tenantServiceSid = `VA${"4".repeat(32)}`;
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      resolveVerifyServiceSid: (request) =>
        request.tenant === "tenant-2" ? tenantServiceSid : VERIFY_SID,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    const request = {
      ...input,
      channel: "whatsapp" as const,
      locale: "es",
      rateLimits: { ip_hash: "opaque-value" },
      tenant: "tenant-2",
    };
    await provider.start(request);
    await provider.cancel({ ...request, reference: VERIFICATION_SID });
    expect(mock.starts[0]).toMatchObject({
      channel: "whatsapp",
      locale: "es",
      rateLimits: { ip_hash: "opaque-value" },
    });
    expect(mock.cancels).toEqual([
      { status: "canceled", verificationSid: VERIFICATION_SID },
    ]);
  });

  test.each([
    ["approved", "approved"],
    ["pending", "pending"],
    ["max_attempts_reached", "max_attempts_reached"],
    ["deleted", "canceled"],
  ] as const)(
    "normalizes check status %s",
    async (providerStatus, expected) => {
      const mock = createClient();
      mock.setCheckStatus(providerStatus);
      const provider = createTwilioVerificationProvider({
        client: mock.client,
        serviceTokenTtlMs: 600_000,
        verifyServiceSid: VERIFY_SID,
      });
      expect(
        (
          await provider.check({
            ...input,
            code: "123456",
            reference: VERIFICATION_SID,
          })
        ).status,
      ).toBe(expected);
      expect(mock.checks).toEqual([
        { code: "123456", verificationSid: VERIFICATION_SID },
      ]);
    },
  );

  test("fails closed on an unknown provider status", async () => {
    const mock = createClient();
    mock.setCheckStatus("new_status");
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    await expect(
      provider.check({
        ...input,
        code: "123456",
        reference: VERIFICATION_SID,
      }),
    ).rejects.toBeInstanceOf(TwilioVerificationResponseError);
  });

  test("rejects non-pending start responses", async () => {
    const mock = createClient();
    mock.setStartStatus("failed");
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    await expect(provider.start(input)).rejects.toBeInstanceOf(
      TwilioVerificationResponseError,
    );
  });

  test("rejects a start response without a verification SID", async () => {
    const mock = createClient();
    mock.setStartSid(undefined);
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    await expect(provider.start(input)).rejects.toBeInstanceOf(
      TwilioVerificationResponseError,
    );
  });

  test("rejects a check that is not bound to a Twilio verification SID", async () => {
    const mock = createClient();
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    await expect(
      provider.check({ ...input, code: "123456", reference: "bad" }),
    ).rejects.toBeInstanceOf(TwilioVerificationConfigurationError);
    expect(mock.checks).toHaveLength(0);
  });

  test.each([
    [60203, "rate_limited"],
    [60205, "invalid_destination"],
    [50000, "unavailable"],
  ] as const)("normalizes provider error %s", async (code, expectedKind) => {
    const mock = createClient();
    mock.setStartError({ code });
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    try {
      await provider.start(input);
      throw new Error("expected provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(VerificationProviderError);
      expect((error as VerificationProviderError).kind).toBe(expectedKind);
    }
  });

  test.each([
    [60202, "max_attempts_reached"],
    [20404, "expired"],
  ] as const)("normalizes terminal check error %s", async (code, expected) => {
    const mock = createClient();
    mock.setCheckError({ code });
    const provider = createTwilioVerificationProvider({
      client: mock.client,
      serviceTokenTtlMs: 600_000,
      verifyServiceSid: VERIFY_SID,
    });
    expect(
      (
        await provider.check({
          ...input,
          code: "123456",
          reference: VERIFICATION_SID,
        })
      ).status,
    ).toBe(expected);
  });

  test.each([
    { serviceTokenTtlMs: 1 },
    { verifyServiceSid: "VA_bad" },
    { templates: { mfa_enrollment: "HJ_bad" } },
  ])("rejects invalid configuration", (changed) => {
    const mock = createClient();
    expect(() =>
      createTwilioVerificationProvider({
        client: mock.client,
        serviceTokenTtlMs: 600_000,
        verifyServiceSid: VERIFY_SID,
        ...changed,
      }),
    ).toThrow(TwilioVerificationConfigurationError);
  });
});
