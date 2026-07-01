/**
 * models/ClinicianScopeOfPractice.js — Module 3 (Tab 9)
 *
 * Tracks clinician's workstreams, systems in use, and shadowing availability.
 * Tab 9 in the 9-tab clinician profile.
 *
 * Uses createModel library (JSONB in app_records table).
 */

import { createModel } from "../lib/model.js";

const ClinicianScopeOfPractice = createModel({
  modelName: "ClinicianScopeOfPractice",
  refs: {
    clinician: { model: "Clinician" },
    updatedBy: { model: "User" },
  },
  defaults: {
    // Link to clinician
    clinician: null,

    // ── Workstreams (trained + actively using) ──────────────────────
    workstreams: [
      // [
      //   {
      //     name: "SMR (Structured Medicines Review)",
      //     trainedDate: "2024-01-15",
      //     trainedBy: "user_id",
      //     activelyUsing: true,
      //     activeSince: "2024-02-01",
      //     notes: "Lead clinician for PCN A"
      //   },
      //   ...
      // ]
    ],

    // ── Systems in use (ICE, AccuRX, EMIS, SystmOne, Docman, etc.) ──
    systemsInUse: [
      // [
      //   {
      //     name: "EMIS",
      //     accessGranted: true,
      //     accessGrantedDate: "2024-01-10",
      //     accessGrantedBy: "user_id",
      //     lastAccessedAt: "2025-01-20T14:30:00Z",
      //     notes: "Primary system for PCN X"
      //   },
      //   ...
      // ]
    ],

    // ── Shadowing availability ──────────────────────────────────────
    shadowingAvailable: false,       // Boolean: willing to shadow new starters?
    shadowingNotes: "",              // "Available Tue/Wed mornings", etc.
    maxShadowingPerMonth: 4,         // Max shadowing sessions per month
    shadowingHistory: [
      // [
      //   {
      //     newStarterName: "John Doe",
      //     newStarterRole: "IP",
      //     date: "2024-12-15",
      //     hours: 8,
      //     feedback: "Good progress, needs EMIS training"
      //   },
      //   ...
      // ]
    ],

    // ── General notes ───────────────────────────────────────────────
    notes: "",                       // Any special notes about scope

    // ── Audit ───────────────────────────────────────────────────────
    updatedBy: null,
    updatedAt: null,
  },
});

export default ClinicianScopeOfPractice;