import { Modal, TextField, BlockStack, Text, Banner, InlineStack, Button } from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

interface OtpEmailResponse {
  otpSent?: boolean;
  otpError?: string;
}

interface OtpVerifyResponse {
  otpVerified?: boolean;
  sessionToken?: string;
  otpError?: string;
}

interface RefundOtpModalProps {
  open: boolean;
  onClose: () => void;
  onVerified: (sessionToken: string) => void;
}

type Step = "email" | "otp";

export default function RefundOtpModal({
  open,
  onClose,
  onVerified,
}: RefundOtpModalProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const emailFetcher = useFetcher();
  const otpFetcher = useFetcher();

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep("email");
      setEmail("");
      setCode("");
      setError("");
    }
  }, [open]);

  // Handle email submission response
  useEffect(() => {
    if (emailFetcher.data && emailFetcher.state === "idle") {
      const data = emailFetcher.data as OtpEmailResponse;
      if (data.otpSent) {
        setStep("otp");
        setError("");
      } else if (data.otpError) {
        setError(data.otpError);
      }
    }
  }, [emailFetcher.data, emailFetcher.state]);

  // Handle OTP verification response
  useEffect(() => {
    if (otpFetcher.data && otpFetcher.state === "idle") {
      const data = otpFetcher.data as OtpVerifyResponse;
      if (data.otpVerified && data.sessionToken) {
        onVerified(data.sessionToken);
        onClose();
      } else if (data.otpError) {
        setError(data.otpError);
      }
    }
  }, [otpFetcher.data, otpFetcher.state, onVerified, onClose]);

  const handleEmailSubmit = useCallback(() => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setError("");
    const formData = new FormData();
    formData.append("intent", "request-refund-otp");
    formData.append("email", email.trim());
    emailFetcher.submit(formData, { method: "post" });
  }, [email, emailFetcher]);

  const handleOtpSubmit = useCallback(() => {
    if (!code.trim()) {
      setError("Verification code is required.");
      return;
    }
    setError("");
    const formData = new FormData();
    formData.append("intent", "verify-refund-otp");
    formData.append("email", email.trim());
    formData.append("code", code.trim());
    otpFetcher.submit(formData, { method: "post" });
  }, [email, code, otpFetcher]);

  const handleResendCode = useCallback(() => {
    setCode("");
    setError("");
    const formData = new FormData();
    formData.append("intent", "request-refund-otp");
    formData.append("email", email.trim());
    emailFetcher.submit(formData, { method: "post" });
  }, [email, emailFetcher]);

  const isEmailSubmitting = emailFetcher.state === "submitting";
  const isOtpSubmitting = otpFetcher.state === "submitting";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Verify Identity for Refund"
      primaryAction={
        step === "email"
          ? {
              content: "Send Verification Code",
              onAction: handleEmailSubmit,
              loading: isEmailSubmitting,
              disabled: !email.trim() || isEmailSubmitting,
            }
          : {
              content: "Verify",
              onAction: handleOtpSubmit,
              loading: isOtpSubmitting,
              disabled: !code.trim() || isOtpSubmitting,
            }
      }
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && (
            <Banner tone="critical" onDismiss={() => setError("")}>
              {error}
            </Banner>
          )}

          {step === "email" && (
            <>
              <Banner tone="info">
                A 6-digit code will be sent to your email to authorize this refund.
              </Banner>
              <TextField
                label="Email address"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                placeholder="your@email.com"
                autoFocus
              />
            </>
          )}

          {step === "otp" && (
            <>
              <Text as="p" variant="bodyMd">
                Enter the 6-digit code sent to <strong>{email}</strong>
              </Text>
              <TextField
                label="Verification code"
                value={code}
                onChange={setCode}
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                autoFocus
              />
              <InlineStack gap="200">
                <Button
                  onClick={handleResendCode}
                  disabled={isEmailSubmitting}
                  loading={isEmailSubmitting}
                  variant="plain"
                >
                  Resend Code
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
