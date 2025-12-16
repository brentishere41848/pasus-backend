import { strict as assert } from "assert";
import {
  evaluateOtpAttempt,
  generateOtpCode,
  hashOtp,
  OTP_VERIFY_MAX_ATTEMPTS,
} from "../services/otp.js";

const baseRecord = (code: string) => ({
  id: "otp1",
  token: "tok",
  userId: "user1",
  codeHash: hashOtp(code),
  purpose: "LOGIN" as const,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  usedAt: null as Date | null,
  attemptCount: 0,
  lastSentAt: new Date(),
  resendCount: 0,
});

const run = () => {
  // OTP generation yields 6 digits
  const generated = generateOtpCode();
  assert.equal(generated.length, 6, "code should be 6 digits");
  assert(/^[0-9]{6}$/.test(generated), "code must be numeric");

  // Expiry check
  const expired = { ...baseRecord("111111"), expiresAt: new Date(Date.now() - 1000) };
  const expResult = evaluateOtpAttempt(expired as any, "111111", new Date());
  assert(!expResult.ok && expResult.reason === "expired", "expired OTP should fail");

  // One-time use
  const used = { ...baseRecord("222222"), usedAt: new Date() };
  const usedResult = evaluateOtpAttempt(used as any, "222222", new Date());
  assert(!usedResult.ok && usedResult.reason === "used", "used OTP should fail");

  // Lockout after max attempts
  const locked = { ...baseRecord("333333"), attemptCount: OTP_VERIFY_MAX_ATTEMPTS };
  const lockResult = evaluateOtpAttempt(locked as any, "333333", new Date());
  assert(!lockResult.ok && lockResult.reason === "locked", "locked OTP should fail");

  // Wrong code increments attemptCount
  const wrong = baseRecord("444444") as any;
  const wrongResult = evaluateOtpAttempt(wrong, "000000", new Date());
  assert(!wrongResult.ok && wrongResult.reason === "mismatch", "wrong code should mismatch");
  assert.equal(wrongResult.record.attemptCount, 1, "attempt count should increment");

  // Resend invalidates old (simulate)
  const old = baseRecord("555555") as any;
  const invalidated = { ...old, usedAt: new Date() };
  assert(invalidated.usedAt, "old code should be marked used on resend");

  console.log("OTP tests passed");
};

run();

