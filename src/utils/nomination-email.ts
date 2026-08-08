type FormDataRecord = Record<string, unknown>;

type NominationLike = {
  nominatorEmail: string;
  nomineeName: string;
  formData: unknown;
};

function asFormData(formData: unknown): FormDataRecord {
  if (formData && typeof formData === "object" && !Array.isArray(formData)) {
    return formData as FormDataRecord;
  }
  return {};
}

export function getNomineeEmail(formData: unknown): string | null {
  const data = asFormData(formData);
  const email = data.nomineeEmail;
  return typeof email === "string" && email.includes("@") ? email : null;
}

export function getNomineePhone(formData: unknown): string {
  const data = asFormData(formData);
  const phone = data.nomineePhone;
  return typeof phone === "string" ? phone : "";
}

export function getNominatorEmail(row: NominationLike): string {
  return row.nominatorEmail;
}

export function hasNominationAttachments(payload: {
  profilePhotoKey?: string | null;
  supportingDocsKey?: string | null;
  videoKey?: string | null;
}): boolean {
  return Boolean(payload.profilePhotoKey || payload.supportingDocsKey || payload.videoKey);
}

export function isSelfNomination(
  formData: unknown,
  nominatorEmail: string,
  nomineeEmail: string,
): boolean {
  const data = asFormData(formData);
  const relationship = data.relationship;
  if (relationship === "Self (Nominee)") {
    return true;
  }

  return nominatorEmail.trim().toLowerCase() === nomineeEmail.trim().toLowerCase();
}
