/**
 * lib/emailTemplates.js — Module 3
 *
 * HTML email templates for clinician onboarding (welcome pack + mobilisation plan).
 * All templates accept a context object and return { subject, html, text }.
 *
 * Used by controllers/onboardingController.js → sendWelcomePack().
 */

const escape = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const wrap = (title, body) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escape(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(15,23,42,0.04);">
            <tr>
              <td style="background:linear-gradient(135deg,#2563eb 0%,#0d9488 100%);padding:24px 28px;color:#fff;">
                <div style="font-size:13px;letter-spacing:0.18em;font-weight:700;opacity:0.85;">CORE PRESCRIBING SOLUTIONS</div>
                <div style="font-size:22px;font-weight:800;margin-top:6px;">${escape(title)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-size:14px;line-height:1.65;color:#334155;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b;">
                Core Prescribing Solutions · Intranet · This is an automated message.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

/**
 * Welcome pack — sent when a clinician is onboarded.
 *
 * @param {object} ctx
 * @param {string} ctx.fullName
 * @param {string} ctx.clinicianType
 * @param {string} ctx.contractType
 * @param {string} ctx.opsLeadName
 * @param {string} ctx.supervisorName
 * @param {string} ctx.startDate    ISO date
 * @param {string} ctx.portalUrl    optional clinician portal link
 */
export const welcomePackTemplate = (ctx = {}) => {
  const subject = `Welcome to Core Prescribing Solutions — ${ctx.fullName || ""}`.trim();

  const html = wrap("Welcome to the team", `
    <p>Dear ${escape(ctx.fullName) || "Clinician"},</p>
    <p>
      A warm welcome to <strong>Core Prescribing Solutions</strong>. We are delighted to have you join us
      as a <strong>${escape(ctx.clinicianType || "clinician")}</strong> on the
      <strong>${escape(ctx.contractType || "ARRS")}</strong> contract.
    </p>

    <p style="margin:20px 0 8px;font-weight:700;color:#0f172a;">Your key contacts</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Operations Lead</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${escape(ctx.opsLeadName) || "TBC"}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Supervisor</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${escape(ctx.supervisorName) || "TBC"}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Start Date</td><td style="padding:8px 0;text-align:right;font-weight:600;">${escape(ctx.startDate) || "TBC"}</td></tr>
    </table>

    <p style="margin:24px 0 8px;font-weight:700;color:#0f172a;">Next steps</p>
    <ol style="padding-left:18px;margin:0 0 18px;">
      <li>Complete your compliance pack (DBS, indemnity, GPhC, ID, right-to-work).</li>
      <li>Sign your contract &amp; return the indemnity declaration.</li>
      <li>We will arrange your smartcard, system access (EMIS / SystmOne / AccuRx) and induction.</li>
      <li>Your supervisor will book your first 1:1 within the first two weeks.</li>
    </ol>

    ${ctx.portalUrl ? `
      <p style="text-align:center;margin:28px 0 8px;">
        <a href="${escape(ctx.portalUrl)}" style="background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;display:inline-block;">Open Clinician Portal</a>
      </p>
    ` : ""}

    <p style="margin-top:24px;">If anything is unclear, just reply to this email and the operations team will help.</p>
    <p style="margin-top:20px;">Kind regards,<br/><strong>Core Prescribing Solutions — Operations</strong></p>
  `);

  const text = [
    `Welcome to Core Prescribing Solutions, ${ctx.fullName || ""}.`,
    `Role: ${ctx.clinicianType || "clinician"} · Contract: ${ctx.contractType || "ARRS"}.`,
    `Ops Lead: ${ctx.opsLeadName || "TBC"} · Supervisor: ${ctx.supervisorName || "TBC"} · Start: ${ctx.startDate || "TBC"}.`,
    `Next steps: complete compliance pack, sign contract, await smartcard & system access, book first 1:1.`,
    ctx.portalUrl ? `Portal: ${ctx.portalUrl}` : "",
  ].filter(Boolean).join("\n\n");

  return { subject, html, text };
};

/**
 * Mobilisation plan — sent to ops lead when a new clinician is added,
 * or to the clinician with their setup checklist.
 *
 * @param {object} ctx
 * @param {string} ctx.fullName
 * @param {string} ctx.contractType
 * @param {Array<string>} ctx.systemsRequired   list of systems to provision
 * @param {string} ctx.targetGoLiveDate
 */
export const mobilisationPlanTemplate = (ctx = {}) => {
  const subject = `Mobilisation Plan — ${ctx.fullName || "New Clinician"}`;

  const systems = Array.isArray(ctx.systemsRequired) && ctx.systemsRequired.length
    ? ctx.systemsRequired.map((s) => `<li>${escape(s)}</li>`).join("")
    : `<li>To be confirmed by operations</li>`;

  const html = wrap("Mobilisation Plan", `
    <p>Hi team,</p>
    <p>
      Please find below the mobilisation plan for
      <strong>${escape(ctx.fullName) || "the new clinician"}</strong>
      (<strong>${escape(ctx.contractType || "ARRS")}</strong> contract).
    </p>

    <p style="margin:20px 0 8px;font-weight:700;color:#0f172a;">Target go-live</p>
    <p style="margin:0;">${escape(ctx.targetGoLiveDate) || "TBC — to confirm with PCN/practice"}</p>

    <p style="margin:20px 0 8px;font-weight:700;color:#0f172a;">Systems to provision</p>
    <ul style="padding-left:18px;margin:0 0 18px;">${systems}</ul>

    <p style="margin:20px 0 8px;font-weight:700;color:#0f172a;">Operations checklist</p>
    <ul style="padding-left:18px;margin:0 0 18px;">
      <li>Smartcard request raised</li>
      <li>Indemnity certificate verified</li>
      <li>Compliance pack issued &amp; tracked</li>
      <li>Induction date booked with supervisor</li>
      <li>First 1:1 supervision scheduled</li>
    </ul>

    <p style="margin-top:20px;">Thanks,<br/><strong>CPS Operations</strong></p>
  `);

  const text = [
    `Mobilisation Plan — ${ctx.fullName || "New Clinician"} (${ctx.contractType || "ARRS"})`,
    `Target go-live: ${ctx.targetGoLiveDate || "TBC"}`,
    `Systems: ${(ctx.systemsRequired || []).join(", ") || "TBC"}`,
  ].join("\n\n");

  return { subject, html, text };
};

export default { welcomePackTemplate, mobilisationPlanTemplate };
