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
  <title>Welcome to Core Prescribing System</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Georgia',serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f2a5e 0%,#1a4a9e 100%);padding:36px 40px 28px;text-align:center;">
              <!-- Logo / Icon -->
              <div style="margin-bottom:16px;">
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="52" rx="14" fill="rgba(255,255,255,0.12)"/>
                  <path d="M26 12C26 12 18 16 18 24V32L26 36L34 32V24C34 16 26 12 26 12Z" stroke="white" stroke-width="1.8" fill="rgba(255,255,255,0.08)"/>
                  <path d="M22 24H30M26 20V28" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Core Prescribing System</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:26px;font-weight:normal;letter-spacing:0.5px;">Welcome, ${name}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 28px;">

              <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">
                Your account has been successfully created on the <strong>Core Prescribing System</strong>. Below are your login credentials to get started.
              </p>

              <!-- Role Badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 16px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle;padding-right:10px;">
                          <!-- Role/Badge Icon -->
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#1d4ed8"/>
                          </svg>
                        </td>
                        <td style="vertical-align:middle;font-family:Arial,sans-serif;font-size:13px;color:#1e40af;">
                          <strong>Role Assigned:</strong>&nbsp;${role}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="border-top:1px solid #e5e7eb;margin-bottom:28px;"></div>

              <!-- Credentials Heading -->
              <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;font-weight:600;">Your Login Credentials</p>

              <!-- Email Row -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:12px;">
                <tr>
                  <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;">
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="width:36px;vertical-align:middle;">
                          <!-- Mail Icon -->
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="2" y="4" width="20" height="16" rx="3" stroke="#6b7280" stroke-width="1.6"/>
                            <path d="M2 8l10 7 10-7" stroke="#6b7280" stroke-width="1.6" stroke-linejoin="round"/>
                          </svg>
                        </td>
                        <td style="vertical-align:middle;padding-left:4px;">
                          <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Email Address</p>
                          <p style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#111827;font-weight:600;">${email}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Password Row -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;">
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="width:36px;vertical-align:middle;">
                          <!-- Key Icon -->
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="12" r="4" stroke="#6b7280" stroke-width="1.6"/>
                            <path d="M12 12h8M17 10v4" stroke="#6b7280" stroke-width="1.6" stroke-linecap="round"/>
                          </svg>
                        </td>
                        <td style="vertical-align:middle;padding-left:4px;">
                          <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Temporary Password</p>
                          <p style="margin:2px 0 0;font-family:'Courier New',monospace;font-size:15px;color:#111827;font-weight:700;letter-spacing:1.5px;">${password}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Warning Box -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:top;padding-right:12px;padding-top:2px;">
                          <!-- Warning Icon -->
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L2 21h20L12 2z" stroke="#c2410c" stroke-width="1.8" stroke-linejoin="round"/>
                            <path d="M12 9v5M12 16.5v.5" stroke="#c2410c" stroke-width="2" stroke-linecap="round"/>
                          </svg>
                        </td>
                        <td style="font-family:Arial,sans-serif;font-size:13px;color:#9a3412;line-height:1.6;">
                          <strong>Password Change Required</strong><br/>
                          You will be prompted to set a new password the first time you log in.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#1a4a9e,#0f2a5e);color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;font-weight:600;padding:14px 40px;border-radius:10px;letter-spacing:0.4px;">
                      Access Your Account
                      &nbsp;
                      <svg style="vertical-align:middle;" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M5 12h14M13 6l6 6-6 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;line-height:1.6;">
                If you did not expect this email, please contact your system administrator immediately.<br/>
                &copy; ${new Date().getFullYear()} Core Prescribing System. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
    `,
  });
};