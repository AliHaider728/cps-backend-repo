import { pool } from "./config/db.js";
import { bulkReviewManagerEnterHours } from "./controllers/enterMyHoursController.js";
import EnterMyHoursEntry from "./models/EnterMyHoursEntry.js";

async function test() {
  try {
    console.log("Seeding test data...");
    const clinicianId = "12345678-1234-1234-1234-123456789012";
    
    // Create dummy entry
    const entry = new EnterMyHoursEntry({
      clinician: clinicianId,
      month: 8,
      year: 2026,
      submissionStatus: "submitted",
      managerApprovalStatus: "pending",
      totalWorkedHours: 8
    });
    const saved = await entry.save();
    console.log("Saved entry ID:", saved._id);

    // Mock Express Req/Res
    const req = {
      user: { role: "super_admin", _id: "admin-uuid" },
      body: {
        clinicianId: clinicianId,
        month: 8,
        year: 2026,
        action: "approve"
      }
    };

    const res = {
      status: function(code) { this.statusCode = code; return this; },
      json: function(data) { console.log("Response(", this.statusCode || 200, "):", data); return data; }
    };

    const next = (err) => console.error("Next Error:", err);

    console.log("Calling bulkReviewManagerEnterHours...");
    await bulkReviewManagerEnterHours(req, res, next);

    // Verify
    const updated = await EnterMyHoursEntry.findById(saved._id).lean();
    console.log("Updated Status:", updated?.managerApprovalStatus);
    
    // Cleanup
    await EnterMyHoursEntry.findByIdAndDelete(saved._id);
    
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

test();
