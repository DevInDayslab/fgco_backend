export type EmailTemplate = {
  subject: string;
  html: string;
};

const TROPHY_IMG = "https://hercules-cdn.com/file_b2DU3aBUuAvhNj9hib9bhLeG";
const ROOPA_IMG = "https://hercules-cdn.com/file_lrKNLabjpjLQdctOev3AWiwb";

const GOLD = "#D4A017";
const GOLD_LIGHT = "#F5C842";
const GOLD_DARK = "#8B6010";
const BG = "#09090B";
const BG_PANEL = "#0d0d18";
const TEXT = "#c8bfa0";
const TEXT_LIGHT = "#e8d898";

/** Programme / awards year used in email copy (env override or current IST year). */
export function getAwardsProgrammeYear(date: Date = new Date()): string {
  const configured = process.env.AWARDS_PROGRAMME_YEAR?.trim();
  if (configured && /^\d{4}$/.test(configured)) {
    return configured;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(date);
}

export function formatAwardDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(date);

  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";

  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";

  return `${day}${suffix} ${month} ${year}`;
}

export function formatAwardDateTime(date: Date = new Date()): string {
  const datePart = formatAwardDate(date);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${datePart} · ${timePart} IST`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getPublicSiteUrl(): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return "https://fgco.in";
}

/** Public API origin for email-hosted assets (CEO photo, etc.). */
export function getPublicApiUrl(): string {
  const configured = process.env.PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV !== "production") {
    const port = process.env.PORT?.trim() || "3000";
    return `http://localhost:${port}`;
  }
  return getPublicSiteUrl();
}

/** Inline CID used when the CEO photo is attached to outbound emails. */
export const RAMESH_EMAIL_IMAGE_CID = "ramesh-ceo";

export function getRameshEmailImageUrl(): string {
  // Always embed via CID so Gmail/Outlook can show the photo without fetching localhost/private URLs.
  return `cid:${RAMESH_EMAIL_IMAGE_CID}`;
}

export function buildNominationCompletionUrl(token: string): string {
  return `${getPublicSiteUrl()}/nominate/complete?token=${encodeURIComponent(token)}`;
}

function wrapEmailTemplate(title: string, bodyHtml: string): string {
  const year = getAwardsProgrammeYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:680px;margin:0 auto;background:${BG_PANEL};">
    <div style="height:4px;background:linear-gradient(90deg,#3a2500,${GOLD_DARK},${GOLD},${GOLD_LIGHT},${GOLD},${GOLD_DARK},#3a2500);"></div>
    <div style="padding:16px 24px;text-align:center;border-bottom:1px solid #3a2c08;">
      <p style="margin:0;font-size:9px;letter-spacing:3px;color:${GOLD_DARK};text-transform:uppercase;">FG MEDIA GROUP &bull; AP MEDIA FOUNDATION &bull; WWW.FGCO.IN</p>
    </div>
    ${bodyHtml}
    <div style="background:linear-gradient(135deg,#050508,#0a0808);padding:28px 24px;text-align:center;border-top:1px solid #3a2c08;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:3px;color:${GOLD_DARK};text-transform:uppercase;">FG Media Group</p>
      <p style="margin:0;font-size:11px;color:#5a5040;line-height:1.8;">
        &copy; ${year} FG Media Group &amp; AP Media Foundation. All rights reserved.<br />
        Confidential communication intended solely for the recipient.<br />
        CEO@FGCO.IN &nbsp;|&nbsp; WWW.FGCO.IN &nbsp;|&nbsp; APMEDIA@LIVE.COM
      </p>
      <div style="height:3px;margin-top:20px;background:linear-gradient(90deg,#3a2500,${GOLD_DARK},${GOLD},${GOLD_LIGHT},${GOLD},${GOLD_DARK},#3a2500);"></div>
    </div>
  </div>
</body>
</html>`;
}

function heroBlock(subtitle: string): string {
  const year = getAwardsProgrammeYear();
  return `
    <div style="text-align:center;padding:28px 24px 20px;background:#050508;">
      <img src="${TROPHY_IMG}" alt="HIT ViERA Trophy" width="180" style="display:block;margin:0 auto 16px;max-width:180px;height:auto;" />
      <h1 style="margin:0;font-size:28px;letter-spacing:6px;color:${GOLD_LIGHT};text-transform:uppercase;font-weight:bold;">HIT ViERA</h1>
      <p style="margin:6px 0 0;font-size:11px;letter-spacing:4px;color:${GOLD_DARK};text-transform:uppercase;">National Awards ${year}</p>
      <p style="margin:14px 0 0;font-size:10px;letter-spacing:2px;color:#6a5020;font-style:italic;">${escapeHtml(subtitle)}</p>
    </div>`;
}

function completionCtaBlock(completionUrl: string): string {
  return `
      <div style="margin:28px 0;text-align:center;">
        <a href="${escapeHtml(completionUrl)}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,${GOLD_DARK},${GOLD});color:#120e04;font-size:13px;font-weight:bold;letter-spacing:1px;text-decoration:none;text-transform:uppercase;border-radius:2px;">
          Complete Your Nomination
        </a>
        <p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#8a8070;">
          Or open this link in your browser:<br />
          <a href="${escapeHtml(completionUrl)}" style="color:${GOLD};word-break:break-all;">${escapeHtml(completionUrl)}</a>
        </p>
      </div>`;
}

function goldDivider(): string {
  return `<div style="text-align:center;padding:8px 0;color:${GOLD};font-size:10px;letter-spacing:4px;">&#9670; &#9670; &#9670;</div>`;
}

function quoteBox(quote: string, attribution: string): string {
  return `
    <div style="margin:24px 0;padding:24px;background:linear-gradient(135deg,#120e04,#1a1406);border:1px solid #3a2c08;text-align:center;">
      <p style="margin:0 0 8px;font-size:48px;line-height:1;color:${GOLD};opacity:0.7;">&ldquo;</p>
      <p style="margin:0;font-size:17px;font-style:italic;color:${TEXT_LIGHT};line-height:1.8;">${quote}</p>
      <p style="margin:14px 0 0;font-size:9px;letter-spacing:3px;color:${GOLD_DARK};text-transform:uppercase;">${escapeHtml(attribution)}</p>
    </div>`;
}

function dataGrid(cells: { label: string; value: string }[]): string {
  const cols = cells
    .map(
      (cell) => `
      <td style="width:${Math.floor(100 / cells.length)}%;padding:16px 12px;text-align:center;border-right:1px solid #3a2c08;vertical-align:top;">
        <p style="margin:0 0 6px;font-size:9px;letter-spacing:2px;color:#8a8070;text-transform:uppercase;">${escapeHtml(cell.label)}</p>
        <p style="margin:0;font-size:14px;font-weight:bold;color:${GOLD};">${escapeHtml(cell.value)}</p>
      </td>`,
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid #3a2c08;background:#0f0f1c;"><tr>${cols}</tr></table>`;
}

function detailsTable(rows: { label: string; value: string }[]): string {
  const body = rows
    .map(
      (row) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #3a2c08;font-size:11px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #3a2c08;font-size:14px;color:${GOLD};vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid #3a2c08;background:#0f0f1c;">${body}</table>`;
}

function evaluationCriteriaBlock(): string {
  const items = [
    "Merit & Professional Excellence",
    "Innovation & Creative Leadership",
    "Ethical Standards & Integrity",
    "Measurable Impact & Nation-Building",
  ];

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      ${items
        .map(
          (item) => `
        <tr>
          <td style="padding:10px 12px;border:1px solid #3a2c08;background:#0f0f1c;width:50%;font-size:13px;color:${TEXT};vertical-align:top;">
            <span style="color:${GOLD};margin-right:8px;">&#10022;</span>${escapeHtml(item)}
          </td>
        </tr>`,
        )
        .join("")}
    </table>`;
}

function rameshSignatureFull(): string {
  const rameshImg = getRameshEmailImageUrl();
  return `
    <div style="margin-top:32px;padding:24px;background:linear-gradient(135deg,#120e04,#1a1406);border:1px solid #3a2c08;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:110px;vertical-align:top;padding-right:20px;">
            <img src="${escapeHtml(rameshImg)}" alt="Ramesh Babu Pasupuleti" width="90" height="90" style="display:block;border:2px solid ${GOLD};border-radius:4px;object-fit:cover;" />
            <p style="margin:8px 0 0;font-size:8px;letter-spacing:2px;color:${GOLD_DARK};text-transform:uppercase;text-align:center;">Founder &amp; CEO</p>
          </td>
          <td style="vertical-align:top;">
            <p style="margin:0;font-size:16px;font-weight:bold;color:${GOLD_LIGHT};letter-spacing:1px;">RAMESH BABU PASUPULETI</p>
            <p style="margin:4px 0 0;font-size:10px;letter-spacing:2px;color:${GOLD_DARK};text-transform:uppercase;">Founder, Chief Executive Officer &amp; Editor-in-Chief</p>
            <p style="margin:8px 0 0;font-size:12px;color:#9a8860;">FG MEDIA GROUP</p>
            <p style="margin:4px 0 0;font-size:11px;color:#8a8070;">Managing Trustee, AP Media Foundation</p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
        <tr>
          <td style="width:50%;padding:8px;border:1px solid #3a2c08;font-size:11px;color:#8a8070;vertical-align:top;">Official Email:<br /><span style="color:${GOLD};">ceo@fgco.in</span></td>
          <td style="width:50%;padding:8px;border:1px solid #3a2c08;font-size:11px;color:#8a8070;vertical-align:top;">AP Media Foundation:<br /><span style="color:${GOLD};">apmedia@live.com</span></td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #3a2c08;font-size:11px;color:#8a8070;vertical-align:top;">WhatsApp:<br /><span style="color:${GOLD};">+91 73820 98888</span></td>
          <td style="padding:8px;border:1px solid #3a2c08;font-size:11px;color:#8a8070;vertical-align:top;">Website:<br /><span style="color:${GOLD};">www.fgco.in</span></td>
        </tr>
      </table>
    </div>`;
}

function rameshSignature(): string {
  return rameshSignatureFull();
}

function roopaSignature(): string {
  return `
    <div style="margin-top:24px;padding:24px;background:linear-gradient(135deg,#120e04,#1a1406);border:1px solid #3a2c08;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:110px;vertical-align:top;padding-right:20px;">
            <img src="${ROOPA_IMG}" alt="Roopa T" width="90" height="90" style="display:block;border-radius:50%;border:2px solid ${GOLD};object-fit:cover;" />
          </td>
          <td style="vertical-align:top;">
            <p style="margin:0;font-size:16px;font-weight:bold;color:${GOLD_LIGHT};letter-spacing:1px;">ROOPA . T</p>
            <p style="margin:4px 0 0;font-size:10px;letter-spacing:2px;color:${GOLD_DARK};text-transform:uppercase;">Convener</p>
            <p style="margin:10px 0 0;font-size:13px;color:#9a8860;line-height:1.7;">
              HIT ViERA Awards Committee<br />FG MEDIA GROUP<br />48A, MLA Layout, RT Nagar, Bengaluru
            </p>
            <p style="margin:10px 0 0;font-size:13px;color:#a09070;">hitawards@fgco.in &nbsp;|&nbsp; +91 73820 98888</p>
          </td>
        </tr>
      </table>
    </div>`;
}

export function getCeoNominationEmail(
  nomineeName: string,
  nominatorName: string,
  date: string = formatAwardDate(),
  issuedAt?: string,
  completionUrl?: string,
): EmailTemplate {
  const year = getAwardsProgrammeYear();
  const issued = issuedAt ?? formatAwardDateTime();
  const completionParagraph = completionUrl
    ? `
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        We invite you to complete your nomination profile by submitting your latest professional photograph, detailed profile, key achievements and supporting documents through our secure completion portal. These materials will enable the Jury to conduct a comprehensive and fair evaluation.
      </p>
      ${completionCtaBlock(completionUrl)}`
    : `
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        We invite you to complete your nomination profile by submitting your latest professional photograph, detailed profile, key achievements and supporting documents through our official process. These materials will enable the Jury to conduct a comprehensive and fair evaluation.
      </p>`;

  const body = `
    <div style="padding:20px 24px 0;text-align:center;background:#050508;border-bottom:1px solid #3a2c08;">
      <p style="margin:0 0 16px;font-size:10px;letter-spacing:4px;color:${GOLD_DARK};text-transform:uppercase;">&#9670; Nominee &nbsp; ${escapeHtml(nomineeName)} &nbsp;|&nbsp; Nominated By &nbsp; ${escapeHtml(nominatorName)} &#9670;</p>
      <p style="margin:0;font-size:10px;color:#8a8070;">Date of Issue: ${escapeHtml(issued)}</p>
    </div>
    ${heroBlock(`Official Nominee Communication · ${year}`)}
    <div style="padding:14px 24px;text-align:center;background:linear-gradient(135deg,#120e04,#1e1608);border-top:1px solid #3a2c08;border-bottom:1px solid #3a2c08;">
      <span style="font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;">&#9670; Official Communication To Nominee &#9670;</span>
    </div>
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 8px;font-size:11px;text-align:right;color:#8a8070;">REF: HVA/${year}/NOM<br />${escapeHtml(issued)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:${TEXT};"><strong>Dear Esteemed,</strong></p>
      <p style="margin:0 0 24px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">${escapeHtml(nomineeName)}</p>
      <p style="margin:0 0 8px;font-size:10px;letter-spacing:3px;color:${GOLD_DARK};text-align:center;text-transform:uppercase;">A Distinction You Have Truly Earned</p>
      <h2 style="margin:0 0 24px;text-align:center;font-size:22px;color:${GOLD_LIGHT};letter-spacing:1px;">CONGRATULATIONS.</h2>
      ${goldDivider()}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        It is our privilege to inform you that your name has been received for consideration in the
        <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong> &mdash; one of India&rsquo;s most distinguished national recognition programmes, honouring
        <strong style="color:${GOLD};">Excellence, Innovation, Leadership</strong> and <strong style="color:${GOLD};">Service to Society</strong>.
      </p>
      ${quoteBox(
        "Being nominated is, in itself, a significant distinction. It reflects the confidence, respect and admiration that others hold for your professional accomplishments and your positive contribution to your field and the nation.",
        "HIT ViERA Awards Committee",
      )}
      ${dataGrid([
        { label: "Nominated By", value: nominatorName },
        { label: "Date of Nomination", value: date },
        { label: "Programme Year", value: year },
      ])}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        Your nomination will now proceed through a <strong style="color:${GOLD};">rigorous and transparent evaluation process</strong> conducted by the HIT ViERA National Awards Jury &mdash; a distinguished panel that upholds the highest standards of integrity and impartiality. Each application is assessed with utmost care on:
      </p>
      ${evaluationCriteriaBlock()}
      ${completionParagraph}
      ${quoteBox(
        "Whether or not an award is ultimately conferred, your nomination stands as a testament to your commitment to excellence — and your unwavering dedication to creating meaningful, lasting impact.",
        "HIT ViERA Awards Committee",
      )}
      <p style="margin:20px 0 8px;font-size:10px;letter-spacing:3px;color:${GOLD_DARK};text-transform:uppercase;">A Message From The Editor-in-Chief</p>
      ${quoteBox(
        "Leaders whose vision continues to inspire India are the true architects of tomorrow. You are not merely a nominee — you are a beacon whose light guides a generation.",
        "Ramesh Babu Pasupuleti",
      )}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        Individuals who strive to make a difference elevate not only their professions but the very future of our nation. Your dedication, vision and purposeful action are the hallmarks of a legacy that will endure and inspire long after every accolade.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Thank you for accepting this invitation to be part of the <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong>. We look forward to celebrating your outstanding achievement and recognising the leader in you.
      </p>
      <p style="margin:24px 0 8px;font-size:14px;font-style:italic;color:#a09070;">With the highest regards and warmest best wishes,</p>
      ${goldDivider()}
      ${rameshSignatureFull()}
    </div>`;

  return {
    subject: `Official Nominee Communication - HIT ViERA National Awards ${year}`,
    html: wrapEmailTemplate("Official Nominee Communication", body),
  };
}

export function getNominantAcknowledgementEmail(
  nominatorName: string,
  nomineeName: string,
  date: string = formatAwardDateTime(),
): EmailTemplate {
  const year = getAwardsProgrammeYear();
  const body = `
    ${heroBlock("Nominant Acknowledgement — Official Executive Communiqué")}
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 8px;font-size:11px;text-align:right;color:#8a8070;">Submitted: ${escapeHtml(date)}</p>
      <p style="margin:0 0 24px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">Dear ${escapeHtml(nominatorName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        On behalf of the <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong> organising committee, we extend our sincere appreciation for your nomination of <strong style="color:${GOLD};">${escapeHtml(nomineeName)}</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        By recognising excellence in others, you participate in a national movement that celebrates leadership, integrity, and meaningful contribution to society. Your act of nomination reflects the values that the HIT ViERA Awards were founded to honour.
      </p>
      ${quoteBox(
        "History remembers those who recognise greatness as much as those who achieve it. Your nomination today writes a page in that history.",
        "HIT ViERA Awards Committee",
      )}
      ${dataGrid([
        { label: "Nominee", value: nomineeName },
        { label: "Date Submitted", value: date },
        { label: "Programme Year", value: year },
      ])}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        The nominee has been notified of this honour and invited to complete their official profile. Our team will keep you informed of significant milestones in the evaluation process.
      </p>
      <p style="margin:24px 0 8px;font-size:14px;font-style:italic;color:#a09070;">Together, let us celebrate excellence, inspire leadership and build a stronger future for our nation.</p>
      ${goldDivider()}
      ${rameshSignature()}
    </div>`;

  return {
    subject: `Nominant Acknowledgement - HIT ViERA National Awards ${year}`,
    html: wrapEmailTemplate("Nominant Acknowledgement", body),
  };
}

export function getApplicationReceivedEmail(applicantName: string): EmailTemplate {
  const year = getAwardsProgrammeYear();
  const issuedAt = formatAwardDateTime();
  const body = `
    ${heroBlock("Honouring Innovation · Excellence · Remarkable Achievement")}
    <div style="padding:14px 24px;text-align:center;background:linear-gradient(135deg,#120e04,#1e1608);border-top:1px solid #3a2c08;border-bottom:1px solid #3a2c08;">
      <span style="font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;">&#10022; Application Acknowledgement &#10022;</span>
    </div>
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 8px;font-size:11px;text-align:right;color:#8a8070;">Received: ${escapeHtml(issuedAt)}</p>
      <p style="margin:0 0 24px;font-size:24px;color:${TEXT_LIGHT};font-weight:bold;">Dear ${escapeHtml(applicantName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Thank you for submitting your application for the <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong> through our official website.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        We sincerely appreciate your interest in becoming part of one of India&rsquo;s most distinguished platforms dedicated to recognising excellence, leadership, innovation and meaningful contribution to society.
      </p>
      ${quoteBox(
        "Every remarkable achievement begins with the courage to take the first step. Your application reflects not only your accomplishments but also your commitment to creating a positive impact within your profession, community and the nation.",
        "HIT ViERA Awards Committee",
      )}
      <div style="margin:24px 0;padding:16px 20px;background:linear-gradient(135deg,#0a1a0a,#0d1f0d);border:1px solid #1a3a1a;border-left:4px solid #2a7a2a;">
        <p style="margin:0;font-size:11px;letter-spacing:2px;color:#4CAF50;text-transform:uppercase;">&#9679; Application Successfully Received &amp; Under Review</p>
      </div>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Your application will now undergo a comprehensive evaluation by the <strong style="color:${GOLD};">HIT ViERA Awards Committee</strong> in accordance with our transparent and merit-based assessment process. Should any additional information or supporting documents be required, our team will contact you through your registered email or mobile number.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        We encourage you to continue your pursuit of excellence with confidence, integrity and purpose. True leadership is measured not merely by success, but by the lives it inspires and the legacy it creates.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Thank you once again for choosing to be part of the <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong>. We wish you every success and look forward to celebrating outstanding achievements that contribute to a stronger, more innovative and more prosperous India.
      </p>
      <p style="margin:24px 0 8px;font-size:14px;font-style:italic;color:#a09070;">Warm Regards,</p>
      ${roopaSignature()}
    </div>`;

  return {
    subject: `Application Acknowledgement - HIT ViERA National Awards ${year}`,
    html: wrapEmailTemplate("Application Acknowledgement", body),
  };
}

export function getOfficialNominationLetterEmail(
  nomineeName: string,
  nominatorName: string,
  category: string,
  phone: string,
  email: string,
  date: string = formatAwardDateTime(),
  completionUrl?: string,
): EmailTemplate {
  const year = getAwardsProgrammeYear();
  const completionParagraph = completionUrl
    ? `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        To enable the National Jury to conduct a comprehensive and impartial evaluation, we cordially invite you to confirm your willingness to participate by submitting your latest professional photograph, profile, biodata, key achievements and supporting documents through our secure completion portal.
      </p>
      ${completionCtaBlock(completionUrl)}`
    : `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        To enable the National Jury to conduct a comprehensive and impartial evaluation, we cordially invite you to confirm your willingness to participate by submitting your latest professional photograph, profile, biodata, key achievements and supporting documents through our official nomination process.
      </p>`;

  const body = `
    ${heroBlock("FG Media Group Presents")}
    <div style="padding:14px 24px;text-align:center;background:linear-gradient(135deg,#120e04,#1e1608);border-top:1px solid #3a2c08;border-bottom:1px solid #3a2c08;">
      <span style="font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;">&#9670; Official Nomination Letter &#9670;</span>
    </div>
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 20px;font-size:12px;color:#8a8070;text-align:right;">Date: ${escapeHtml(date)}</p>
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;color:${GOLD_DARK};text-transform:uppercase;">To</p>
      <p style="margin:0 0 16px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">${escapeHtml(nomineeName)}</p>
      <p style="margin:0 0 24px;font-size:13px;color:${TEXT};"><strong style="color:${GOLD};">Category:</strong> ${escapeHtml(category)}</p>
      <p style="margin:0 0 24px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">Dear ${escapeHtml(nomineeName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Greetings from the HIT ViERA Awards Committee, <strong style="color:${GOLD};">FG MEDIA GROUP</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        It gives us great pleasure to inform you that <strong style="color:${GOLD};">Mr./Ms. ${escapeHtml(nominatorName)}</strong> has recommended your name for consideration for the <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong> under the category of <strong style="color:${GOLD};">${escapeHtml(category)}</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        This recommendation reflects the confidence and respect earned through your professional accomplishments, leadership, innovation and meaningful contributions to your field. Being recommended for the HIT ViERA National Awards is a noteworthy recognition of your commitment to excellence and your positive impact on society.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        The HIT ViERA National Awards have been instituted to identify, recognise and celebrate individuals and organisations whose vision, integrity and achievements inspire progress and contribute to nation-building.
      </p>
      ${completionParagraph}
      <p style="margin:0 0 12px;font-size:10px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;text-align:center;">&#9670; Your Details Currently Available With Us &#9670;</p>
      ${detailsTable([
        { label: "Nominee", value: nomineeName },
        { label: "Mobile", value: phone || "On file" },
        { label: "Email", value: email },
        { label: "Award Category", value: category },
        { label: "Recommended By", value: nominatorName },
      ])}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        Participation in the evaluation process offers an opportunity to present your achievements before an independent National Jury comprising distinguished professionals from diverse domains. Every nomination is assessed through a transparent, merit-based evaluation framework founded on excellence, leadership, innovation, integrity and measurable societal impact.
      </p>
      ${quoteBox(
        "History is shaped by individuals who dare to create meaningful change. Recognition does not define greatness — it acknowledges a journey that has already inspired others. We believe your work deserves thoughtful consideration, and we would be honoured to receive your confirmation.",
        "HIT ViERA Awards Committee",
      )}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        Should you require any assistance, our Awards Committee will be pleased to support you throughout the nomination process.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        We look forward to welcoming you to the <strong style="color:${GOLD};">HIT ViERA National Awards ${year}</strong> and wish you continued success in your inspiring journey.
      </p>
      <p style="margin:24px 0 8px;font-size:14px;font-style:italic;color:#a09070;">With warm regards,</p>
      ${roopaSignature()}
      <p style="margin:24px 0 0;font-size:10px;letter-spacing:3px;color:${GOLD_DARK};text-align:center;text-transform:uppercase;">
        HIT ViERA National Awards ${year} &nbsp;|&nbsp; Excellence &middot; Leadership &middot; Innovation &middot; Integrity
      </p>
    </div>`;

  return {
    subject: `Official Nomination Letter - HIT ViERA National Awards ${year}`,
    html: wrapEmailTemplate("Official Nomination Letter", body),
  };
}

export function getConvenerInviteEmail(
  nomineeName: string,
  nominatorName: string,
  category: string,
  phone: string,
  email: string,
  date: string = formatAwardDate(),
): EmailTemplate {
  return getCeoNominationEmail(nomineeName, nominatorName, date, formatAwardDateTime());
}

export function getNominatorNomineeCompletedEmail(
  nominatorName: string,
  nomineeName: string,
  referenceId: string,
  date: string = formatAwardDateTime(),
): EmailTemplate {
  const year = getAwardsProgrammeYear();
  const body = `
    ${heroBlock("Nominee Profile Completed")}
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 8px;font-size:11px;text-align:right;color:#8a8070;">Updated: ${escapeHtml(date)}</p>
      <p style="margin:0 0 24px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">Dear ${escapeHtml(nominatorName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Good news — <strong style="color:${GOLD};">${escapeHtml(nomineeName)}</strong> has completed their HIT ViERA National Awards ${year} nomination profile and payment.
      </p>
      ${dataGrid([
        { label: "Nominee", value: nomineeName },
        { label: "Reference", value: referenceId },
        { label: "Completed On", value: date },
        { label: "Programme Year", value: year },
      ])}
      <p style="margin:20px 0;font-size:15px;line-height:1.8;color:${TEXT};">
        The application is now with the Awards Committee for evaluation. We will keep you informed of significant milestones in the process.
      </p>
      <p style="margin:24px 0 8px;font-size:14px;font-style:italic;color:#a09070;">Thank you again for recognising excellence.</p>
      ${goldDivider()}
      ${rameshSignature()}
    </div>`;

  return {
    subject: `Nominee Completed Profile - HIT ViERA National Awards ${year}`,
    html: wrapEmailTemplate("Nominee Completed Profile", body),
  };
}

export function getPaymentReceiptEmail(
  payerName: string,
  amountInr: number,
  transactionId: string,
  date: string = formatAwardDateTime(),
): EmailTemplate {
  const formattedAmount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amountInr);

  const body = `
    ${heroBlock("Payment Confirmation")}
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 24px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">Dear ${escapeHtml(payerName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Thank you for your payment to <strong style="color:${GOLD};">FG Media Group</strong>. This email confirms that your transaction was processed successfully.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid #3a2c08;background:#0f0f1c;">
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Transaction ID</td>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:14px;color:${GOLD};text-align:right;font-family:monospace;">${escapeHtml(transactionId)}</td>
        </tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Date</td>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:14px;color:${TEXT};text-align:right;">${escapeHtml(date)}</td>
        </tr>
        <tr>
          <td style="padding:14px 20px;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Amount Paid</td>
          <td style="padding:14px 20px;font-size:20px;font-weight:bold;color:${GOLD_LIGHT};text-align:right;">${escapeHtml(formattedAmount)}</td>
        </tr>
      </table>
      <p style="margin:0;font-size:14px;line-height:1.8;color:${TEXT};">
        Please retain this email for your records. For any queries regarding your payment, contact us at <strong style="color:${GOLD};">pro@fgco.in</strong> or <strong style="color:${GOLD};">contact@fgco.in</strong>.
      </p>
      ${goldDivider()}
      <p style="margin:0;font-size:11px;color:#6a6050;text-align:center;">FG MEDIA GROUP &bull; AP MEDIA FOUNDATION &bull; WWW.FGCO.IN</p>
    </div>`;

  return {
    subject: "Payment Confirmation - FG Media Group",
    html: wrapEmailTemplate("Payment Confirmation", body),
  };
}

function formatInr(amountInr: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amountInr);
}

export type SponsorshipConfirmationEmailParams = {
  contactName: string;
  company: string;
  tierName: string;
  referenceId: string;
  /** Full sponsorship package value (ex-GST). */
  committedAmountInr: number;
  /** Advance base before GST. */
  advanceBaseInr: number;
  /** GST collected on the advance. */
  gstPaidInr: number;
  /** Total amount charged now (advance + GST). */
  amountPaidInr: number;
  transactionId: string;
  date?: string;
};

export function getSponsorshipConfirmationEmail(
  params: SponsorshipConfirmationEmailParams,
): EmailTemplate {
  const year = getAwardsProgrammeYear();
  const date = params.date ?? formatAwardDateTime();
  const balanceDueInr = Math.max(0, params.committedAmountInr - params.advanceBaseInr);

  const body = `
    ${heroBlock("Official Sponsorship Confirmation")}
    <div style="padding:14px 24px;text-align:center;background:linear-gradient(135deg,#120e04,#1e1608);border-top:1px solid #3a2c08;border-bottom:1px solid #3a2c08;">
      <span style="font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;">&#9670; Partnership Confirmation &#9670;</span>
    </div>
    <div style="padding:36px 32px;background:linear-gradient(180deg,${BG_PANEL},#0f0f1c);">
      <p style="margin:0 0 8px;font-size:11px;text-align:right;color:#8a8070;">Confirmed: ${escapeHtml(date)}</p>
      <p style="margin:0 0 24px;font-size:22px;color:${TEXT_LIGHT};font-weight:bold;">Dear ${escapeHtml(params.contactName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        On behalf of <strong style="color:${GOLD};">FG Media Group</strong> and the HIT ViERA National Awards ${year} organising committee, we are delighted to confirm your sponsorship partnership.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:${TEXT};">
        Your advance payment has been received successfully, and your sponsorship slot for
        <strong style="color:${GOLD};">${escapeHtml(params.tierName)}</strong> under
        <strong style="color:${GOLD};">${escapeHtml(params.company)}</strong> is now reserved.
      </p>
      ${quoteBox(
        "Strategic partnerships amplify excellence. By aligning with HIT ViERA, your brand joins a national celebration of leadership, innovation and purposeful impact.",
        "HIT ViERA Awards Committee",
      )}
      ${detailsTable([
        { label: "Organisation", value: params.company },
        { label: "Sponsorship Tier", value: params.tierName },
        { label: "Reference", value: params.referenceId },
        { label: "Transaction ID", value: params.transactionId },
        { label: "Confirmed On", value: date },
        { label: "Programme Year", value: year },
      ])}
      <p style="margin:8px 0 12px;font-size:10px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;text-align:center;">&#9670; Financial Summary &#9670;</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #3a2c08;background:#0f0f1c;">
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Total Committed (Package)</td>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:18px;font-weight:bold;color:${GOLD_LIGHT};text-align:right;">${escapeHtml(formatInr(params.committedAmountInr))}</td>
        </tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Advance (50%)</td>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:14px;color:${TEXT};text-align:right;">${escapeHtml(formatInr(params.advanceBaseInr))}</td>
        </tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">GST on Advance (18%)</td>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:14px;color:${TEXT};text-align:right;">${escapeHtml(formatInr(params.gstPaidInr))}</td>
        </tr>
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Already Paid</td>
          <td style="padding:14px 20px;border-bottom:1px solid #3a2c08;font-size:20px;font-weight:bold;color:${GOLD_LIGHT};text-align:right;">${escapeHtml(formatInr(params.amountPaidInr))}</td>
        </tr>
        <tr>
          <td style="padding:14px 20px;font-size:12px;color:#8a8070;text-transform:uppercase;letter-spacing:1px;">Balance Due (ex-GST)</td>
          <td style="padding:14px 20px;font-size:16px;font-weight:bold;color:${GOLD};text-align:right;">${escapeHtml(formatInr(balanceDueInr))}</td>
        </tr>
      </table>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:${TEXT};">
        The balance of <strong style="color:${GOLD};">${escapeHtml(formatInr(balanceDueInr))}</strong> remains payable as per sponsorship terms. Applicable GST on the balance will be collected at the time of settlement. Our corporate relations team will share the next steps and deliverables shortly.
      </p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:${TEXT};">
        For any assistance, contact us at <strong style="color:${GOLD};">pro@fgco.in</strong> or <strong style="color:${GOLD};">contact@fgco.in</strong>.
      </p>
      <p style="margin:24px 0 8px;font-size:14px;font-style:italic;color:#a09070;">With warm regards and appreciation for your partnership,</p>
      ${goldDivider()}
      ${rameshSignature()}
    </div>`;

  return {
    subject: `Sponsorship Confirmation - ${params.tierName} · HIT ViERA National Awards ${year}`,
    html: wrapEmailTemplate("Sponsorship Confirmation", body),
  };
}
