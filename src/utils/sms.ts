import axios from "axios";
import pino from "pino";

const logger = pino({ name: "fg-media-hub-sms" });

const LIVEAIR_TOKEN = process.env.LIVEAIR_TOKEN;
const LIVEAIR_URL = "https://godspeed.liveair.co.in/httpapi/httpapi";

export const SMS_TEMPLATES = {
  NOMINANT_ACK: {
    templateId: "1677100000000389644",
    senderId: "HITNWS",
    message:
      "HIT ViERA 2026: Dear {#var#}, your nomination of {#var#} for the {#var#} category has been received successfully. Thank you for recognising excellence. - FG MEDIA GROUP",
  },
  NOMINEE_NOTIFICATION: {
    templateId: "1677100000000389645",
    senderId: "HITIRN",
    message:
      "HIT ViERA 2026: Dear {#var#}, you have been nominated for the {#var#} Award by {#var#}. Your profile has been submitted for consideration by the National Jury. - HIT ViERA Awards Committee, FG MEDIA GROUP",
  },
  SELF_NOMINATION_ACK: {
    templateId: "1677100000000389646",
    senderId: "HITIRN",
    message:
      "HIT ViERA 2026: Dear {#var#}, your direct nomination application for the {#var#} category has been successfully registered under Application ID {#var#}. - FG MEDIA GROUP",
  },
  SPONSOR_CONFIRMATION: {
    templateId: "1677100000000389647",
    senderId: "HIT888",
    message:
      "HIT ViERA 2026: Dear {#var#}, your Sponsor registration for {#var#} has been successfully received. Thank you for supporting excellence and leadership. Our team will connect with you shortly. - FG MEDIA GROUP",
  },
  PAYMENT_RECEIPT: {
    templateId: "1677100000000389648",
    senderId: "HIT888",
    message:
      "HIT ViERA 2026: Dear {#var#}, we have received your payment of Rs. {#var#} for reference ID {#var#}. Your application is currently under review. - FG MEDIA GROUP",
  },
} as const;

/**
 * Normalizes Indian mobile numbers to 10 digits (Liveair expects 99XXXXXXXX format).
 */
export function sanitizeIndianMobile(mobileNumber: string): string | null {
  let cleaned = mobileNumber.replace(/\D/g, "");

  if (cleaned.startsWith("91") && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.length !== 10) {
    return null;
  }

  return cleaned;
}

/**
 * Replaces {#var#} placeholders sequentially with the provided values.
 */
function buildMessage(templateMessage: string, variables: (string | number)[]): string {
  let finalMessage = templateMessage;
  for (const val of variables) {
    finalMessage = finalMessage.replace("{#var#}", String(val));
  }
  return finalMessage;
}

/**
 * Dispatches an SMS via Liveair HTTP API.
 */
export async function sendLiveairSMS(
  mobileNumber: string,
  templateKey: keyof typeof SMS_TEMPLATES,
  variables: (string | number)[],
): Promise<void> {
  if (!LIVEAIR_TOKEN) {
    logger.warn("LIVEAIR_TOKEN missing. SMS dispatch skipped.");
    return;
  }

  const cleanedNumber = sanitizeIndianMobile(mobileNumber);
  if (!cleanedNumber) {
    logger.warn({ mobileNumber, templateKey }, "Invalid mobile number. SMS dispatch skipped.");
    return;
  }

  const template = SMS_TEMPLATES[templateKey];
  const rawMessage = buildMessage(template.message, variables);
  const encodedMessage = encodeURIComponent(rawMessage);

  const finalUrl = `${LIVEAIR_URL}?token=${LIVEAIR_TOKEN}&sender=${template.senderId}&number=${cleanedNumber}&route=2&type=1&sms=${encodedMessage}&templateid=${template.templateId}`;

  try {
    await axios.get(finalUrl);
    logger.info({ number: cleanedNumber, templateKey }, "Liveair SMS sent");
  } catch (error) {
    logger.error({ err: error, number: cleanedNumber, templateKey }, "Liveair SMS failed");
  }
}

/**
 * Fire-and-forget SMS dispatch so it does not block the main API response.
 */
export function sendLiveairSMSAsync(
  mobileNumber: string,
  templateKey: keyof typeof SMS_TEMPLATES,
  variables: (string | number)[],
): void {
  void sendLiveairSMS(mobileNumber, templateKey, variables);
}
