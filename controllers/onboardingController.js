/**
 * controllers/onboardingController.js — Module 3
 *
 * Endpoints under /api/clinicians/:id/onboarding
 *   PUT   /                  → update onboarding checklist
 *   POST  /welcome           → send welcome pack email (admin)
 */

import nodemailer from "nodemailer";
import Clinician  from "../models/Clinician.js";
import User       from "../models/User.js";
import { logAudit } from "../middleware/auditLogger.js";
import { normalizeId } from "../lib/ids.js";
import { welcomePackTemplate } from "../lib/emailTemplates.js";

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

const DEFAULT_ONBOARDING = {
  welcomePackSent:   false,
  welcomePackSentAt: null,
  welcomePackSentBy: null,
  mobilisationPlan:  false,
  systemsRequested:  false,
  smartcardOrdered:  false,
  contractSigned:    false,
  indemnityVerified: false,
  inductionBooked:   false,
  notes:             "",
};

/* ─── Build SMTP transport from env (dev-friendly) ───────── */
function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // No SMTP configured — return a fake "console" transport
    return {
      sendMail: async (msg) => {
        console.log("[onboarding][stub-smtp] would send:", {
          to: msg.to, subject: msg.subject,
        });
        return { messageId: `stub-${Date.now()}` };
      },
    };
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/* ─── UPDATE onboarding ──────────────────────────────────── */
export const updateOnboarding = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    const incoming = req.body?.onboarding || req.body || {};
    const merged   = { ...DEFAULT_ONBOARDING, ...(before.onboarding || {}), ...incoming };

    const updated = await Clinician.findByIdAndUpdate(
      id,
      { onboarding: merged },
      { new: true }
    );

    await logAudit(req, "UPDATE_CLINICIAN_ONBOARDING", "Clinician", {
      resourceId: id,
      detail: `Updated onboarding checklist for clinician "${before.fullName || id}"`,
      before: safeJson(before.onboarding),
      after:  safeJson(merged),
    });

    res.json({ onboarding: updated.onboarding });
  } catch (err) {
    next(err);
  }
};

/* ─── SEND WELCOME PACK ──────────────────────────────────── */
export const sendWelcomePack = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    if (!clinician.email)
      return res.status(400).json({ message: "Clinician has no email on record" });

    // Resolve ops + supervisor names for the email body
    const userIds = [clinician.opsLead, clinician.supervisor].filter(Boolean);
    const users = userIds.length
      ? await Promise.all(userIds.map((uid) => User.findById(uid).lean()))
      : [];
    const userMap = new Map(users.filter(Boolean).map((u) => [String(u._id), u]));

    const tpl = welcomePackTemplate({
      fullName:       clinician.fullName,
      clinicianType:  clinician.clinicianType,
      contractType:   clinician.contractType,
      opsLeadName:    userMap.get(String(clinician.opsLead))?.fullName || "",
      supervisorName: userMap.get(String(clinician.supervisor))?.fullName || "",
      startDate:      clinician.startDate
        ? new Date(clinician.startDate).toLocaleDateString("en-GB")
        : "",
      portalUrl: req.body?.portalUrl || process.env.CLINICIAN_PORTAL_URL || "",
    });

    const transport = buildTransport();
    const info = await transport.sendMail({
      from:    process.env.SMTP_FROM || `"CPS Operations" <${process.env.SMTP_USER || "noreply@cps.local"}>`,
      to:      clinician.email,
      subject: tpl.subject,
      html:    tpl.html,
      text:    tpl.text,
    });

    const nextOnboarding = {
      ...DEFAULT_ONBOARDING,
      ...(clinician.onboarding || {}),
      welcomePackSent:   true,
      welcomePackSentAt: new Date().toISOString(),
      welcomePackSentBy: req.user?._id || null,
    };

    const updated = await Clinician.findByIdAndUpdate(
      id,
      { onboarding: nextOnboarding },
      { new: true }
    );

    await logAudit(req, "SEND_WELCOME_PACK", "Clinician", {
      resourceId: id,
      detail: `Sent welcome pack to "${clinician.email}" (msgId: ${info.messageId || "n/a"})`,
      after:  { welcomePackSent: true, sentAt: nextOnboarding.welcomePackSentAt },
    });

    res.json({
      ok:        true,
      messageId: info.messageId,
      onboarding: updated.onboarding,
    });
  } catch (err) {
    next(err);
  }
};
