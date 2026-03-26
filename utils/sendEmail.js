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
      <body style="margin:0;padding:0;background-color:#f0f2f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f8;padding:40px 0;">
          <tr>
            <td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(30,0,180,0.10);">

                <!-- Header Banner -->
                <tr>
                  <td style="background:linear-gradient(135deg,#0f0087 0%,#1e00c3 60%,#3a1de0 100%);padding:36px 40px 28px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <!-- Logo wordmark pill -->
                          <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:5px 14px;margin-bottom:16px;">
                            <table cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding-right:7px;vertical-align:middle;">
                                  <!-- Rx pill icon -->
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="12" cy="12" r="11" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
                                    <text x="5" y="17" font-size="11" font-weight="700" fill="white" font-family="Arial">Rx</text>
                                  </svg>
                                </td>
                                <td>
                                  <span style="color:#c7c0ff;font-size:11px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;">Core Prescribing Solutions</span>
                                </td>
                              </tr>
                            </table>
                          </div>
                          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;line-height:1.3;">
                            Welcome aboard, ${name}!
                          </h1>
                          <p style="margin:8px 0 0;color:#a89ff5;font-size:14px;">Your account has been created. Here are your login details.</p>
                        </td>

                        <!-- Decorative Rx badge -->
                        <td width="68" align="right" valign="middle" style="padding-left:16px;">
                          <div style="width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.22);text-align:center;line-height:60px;">
                            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-top:13px;">
                              <path d="M6 3h7a5 5 0 0 1 0 10H6V3z" stroke="white" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
                              <line x1="6" y1="13" x2="6" y2="21" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
                              <line x1="13" y1="13" x2="18" y2="21" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
                            </svg>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Role badge row -->
                <tr>
                  <td style="padding:24px 40px 0;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#ededff;border:1px solid #c4bfff;border-radius:8px;padding:10px 16px;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding-right:10px;vertical-align:middle;">
                                <!-- Shield icon -->
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="#1e00c3"/>
                                </svg>
                              </td>
                              <td>
                                <span style="color:#1e00c3;font-size:13px;font-weight:600;">Role: ${role}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding:20px 40px 0;">
                    <div style="height:1px;background:#e8e8f4;"></div>
                  </td>
                </tr>

                <!-- Credentials Section -->
                <tr>
                  <td style="padding:24px 40px 0;">
                    <p style="margin:0 0 14px;color:#6b7280;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Your Login Credentials</p>

                    <!-- Email Row -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                      <tr>
                        <td style="background:#f7f7fd;border:1px solid #e2e2f0;border-radius:10px;padding:14px 18px;">
                          <table cellpadding="0" cellspacing="0" width="100%">
                            <tr>
                              <td style="padding-right:12px;vertical-align:middle;" width="36">
                                <div style="width:32px;height:32px;background:#ededff;border-radius:8px;text-align:center;line-height:32px;">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-top:8px;">
                                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="#1e00c3"/>
                                  </svg>
                                </div>
                              </td>
                              <td>
                                <p style="margin:0;color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Email Address</p>
                                <p style="margin:3px 0 0;color:#1a1a2e;font-size:14px;font-weight:500;">${email}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Password Row -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#f7f7fd;border:1px solid #e2e2f0;border-radius:10px;padding:14px 18px;">
                          <table cellpadding="0" cellspacing="0" width="100%">
                            <tr>
                              <td style="padding-right:12px;vertical-align:middle;" width="36">
                                <div style="width:32px;height:32px;background:#ededff;border-radius:8px;text-align:center;line-height:32px;">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin-top:8px;">
                                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" fill="#1e00c3"/>
                                  </svg>
                                </div>
                              </td>
                              <td>
                                <p style="margin:0;color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Temporary Password</p>
                                <p style="margin:3px 0 0;color:#1a1a2e;font-size:14px;font-weight:600;font-family:'Courier New',monospace;letter-spacing:0.05em;">${password}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Warning Notice -->
                <tr>
                  <td style="padding:14px 40px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#fff8f0;border:1px solid #fcd4a0;border-left:4px solid #f97316;border-radius:0 8px 8px 0;padding:12px 16px;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding-right:10px;vertical-align:middle;">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="#f97316"/>
                                </svg>
                              </td>
                              <td>
                                <span style="color:#9a3412;font-size:13px;font-weight:500;">You will be required to change your password upon first login.</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td style="padding:28px 40px 32px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,#0f0087,#1e00c3);border-radius:10px;box-shadow:0 4px 16px rgba(30,0,195,0.35);">
                          <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.02em;">
                            Sign In to Your Account &nbsp;→
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding:0 40px;">
                    <div style="height:1px;background:#e8e8f4;"></div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding:20px 40px 28px;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                      If you did not expect this email, please ignore it or contact your system administrator immediately. Do not share your credentials with anyone.
                    </p>
                  </td>
                </tr>

              </table>

              <!-- Bottom note -->
              <p style="margin:16px 0 0;color:#9ca3af;font-size:11px;">© 2025 Core Prescribing Solutions. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });
};