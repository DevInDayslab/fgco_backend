type PaymentContactSource = {
  metadata: unknown;
  type: "nomination" | "sponsorship";
  nomination?: {
    nominatorName: string;
    nominatorEmail: string | null;
    nominatorPhone: string | null;
    nomineeName: string | null;
    nomineeEmail: string | null;
    category: string | null;
    referenceId: string | null;
  } | null;
  sponsorship?: {
    company: string | null;
    contactName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    referenceId: string | null;
    tierName: string | null;
  } | null;
};

function metaString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolvePaymentContactFields(source: PaymentContactSource) {
  const metadata = (source.metadata ?? {}) as Record<string, unknown>;

  const contactName =
    metaString(metadata, "contactName") ??
    metaString(metadata, "nominatorName") ??
    source.nomination?.nominatorName ??
    source.sponsorship?.contactName ??
    metaString(metadata, "nomineeName") ??
    source.nomination?.nomineeName ??
    null;

  const contactEmail =
    metaString(metadata, "contactEmail") ??
    metaString(metadata, "nominatorEmail") ??
    source.nomination?.nominatorEmail ??
    source.sponsorship?.contactEmail ??
    metaString(metadata, "nomineeEmail") ??
    source.nomination?.nomineeEmail ??
    null;

  const contactPhone =
    metaString(metadata, "contactPhone") ??
    metaString(metadata, "nominatorPhone") ??
    source.nomination?.nominatorPhone ??
    source.sponsorship?.contactPhone ??
    null;

  const company =
    metaString(metadata, "company") ?? source.sponsorship?.company ?? null;

  const nomineeName =
    metaString(metadata, "nomineeName") ?? source.nomination?.nomineeName ?? null;

  const nomineeEmail =
    metaString(metadata, "nomineeEmail") ?? source.nomination?.nomineeEmail ?? null;

  const category =
    metaString(metadata, "category") ?? source.nomination?.category ?? null;

  const referenceId =
    metaString(metadata, "referenceId") ??
    source.nomination?.referenceId ??
    source.sponsorship?.referenceId ??
    null;

  const tierName = source.sponsorship?.tierName ?? metaString(metadata, "tierName") ?? null;

  return {
    contactName,
    contactEmail,
    contactPhone,
    company,
    nomineeName,
    nomineeEmail,
    category,
    referenceId,
    tierName,
    payerLabel:
      source.type === "sponsorship"
        ? (company ?? contactName)
        : contactName ?? nomineeName,
  };
}
