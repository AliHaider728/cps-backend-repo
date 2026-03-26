import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendWelcomeEmail = async ({ name, email, password, role }) => {
  const loginUrl =
    process.env.CLIENT_URL?.split(",")[1] || "https://cps-tau-five.vercel.app";

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Welcome to Core Prescribing System — Your Login Credentials",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome</title>
  <style>
    @media only screen and (max-width: 600px) {
      .wrapper { width: 100% !important; padding: 16px !important; }
      .card    { border-radius: 12px !important; }
      .header  { padding: 28px 20px 22px !important; }
      .body    { padding: 20px !important; }
      .btn a   { padding: 13px 24px !important; font-size: 14px !important; }
      .cred-row td { display: block !important; width: 100% !important; }
      .cred-label  { margin-bottom: 4px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef0f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" class="wrapper" style="padding:40px 16px;">

        <!-- CARD -->
        <table class="card" width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 28px rgba(30,0,180,0.12);">

          <!-- ── HEADER ── -->
          <tr>
            <td class="header"
              style="background:linear-gradient(150deg,#0a006e 0%,#1e00c3 55%,#2d10d4 100%);padding:32px 36px 26px;text-align:left;">

              <!-- Brand label -->
              <p style="margin:0 0 14px;display:inline-block;background:rgba(255,255,255,0.13);
                border:1px solid rgba(255,255,255,0.22);border-radius:30px;
                padding:4px 14px;color:#c5beff;font-size:11px;
                font-weight:700;letter-spacing:0.09em;text-transform:uppercase;">
                 &nbsp;Core Prescribing Solutions
              </p>

              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;line-height:1.35;">
                Welcome, ${name}!
              </h1>
              <p style="margin:0;color:#a89ef5;font-size:13px;line-height:1.5;">
                Your account is ready. Please find your login credentials below.
              </p>
            </td>
          </tr>

          <!-- ── BODY ── -->
          <tr>
            <td class="body" style="padding:28px 36px;">

              <!-- Role badge -->
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:22px;">
                <tr>
                  <td style="background:#eeecff;border:1px solid #c8c3ff;border-radius:8px;
                    padding:9px 16px;color:#1e00c3;font-size:13px;font-weight:600;">
                    &#9632;&nbsp; Role: ${role}
                  </td>
                </tr>
              </table>

              <!-- Section label -->
              <p style="margin:0 0 12px;color:#9298a8;font-size:10px;font-weight:700;
                letter-spacing:0.1em;text-transform:uppercase;">Login Credentials</p>

              <!-- Email field -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="margin-bottom:10px;background:#f5f5fc;border:1px solid #e0dff5;
                border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="width:6px;background:#1e00c3;"></td>
                  <td style="padding:13px 16px;">
                    <p style="margin:0 0 3px;color:#9298a8;font-size:10px;font-weight:700;
                      letter-spacing:0.08em;text-transform:uppercase;">Email Address</p>
                    <p style="margin:0;color:#1a1a2e;font-size:14px;font-weight:500;">${email}</p>
                  </td>
                </tr>
              </table>

              <!-- Password field -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="margin-bottom:18px;background:#f5f5fc;border:1px solid #e0dff5;
                border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="width:6px;background:#1e00c3;"></td>
                  <td style="padding:13px 16px;">
                    <p style="margin:0 0 3px;color:#9298a8;font-size:10px;font-weight:700;
                      letter-spacing:0.08em;text-transform:uppercase;">Temporary Password</p>
                    <p style="margin:0;color:#1a1a2e;font-size:15px;font-weight:700;
                      font-family:'Courier New',Courier,monospace;letter-spacing:0.06em;">${password}</p>
                  </td>
                </tr>
              </table>

              <!-- Warning notice -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="margin-bottom:26px;background:#fff7f0;border:1px solid #ffd4b0;
                border-left:4px solid #f97316;border-radius:0 8px 8px 0;overflow:hidden;">
                <tr>
                  <td style="padding:12px 16px;color:#92400e;font-size:13px;line-height:1.5;font-weight:500;">
                    &#9888;&nbsp; You will be required to change your password upon first login.
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table class="btn" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="background:linear-gradient(135deg,#0a006e,#1e00c3);
                    border-radius:10px;box-shadow:0 4px 16px rgba(30,0,195,0.32);">
                    <a href="${loginUrl}"
                      style="display:inline-block;padding:14px 32px;color:#ffffff;
                      font-size:15px;font-weight:700;text-decoration:none;
                      letter-spacing:0.02em;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
                      Sign In to Your Account &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td style="padding:16px 36px 24px;border-top:1px solid #eeecff;">
              <p style="margin:0;color:#b0b8c8;font-size:11px;line-height:1.6;">
                If you did not expect this email, please ignore it or contact your administrator.
                Do not share your credentials with anyone.
              </p>
            </td>
          </tr>

        </table>

        <!-- Below card note -->
        <p style="margin:14px 0 0;color:#b0b8c8;font-size:11px;">
          &copy; 2025 Core Prescribing Solutions. All rights reserved.
        </p>

      </td>
    </tr>
  </table>

</body>
</html>
    `,
  });
};