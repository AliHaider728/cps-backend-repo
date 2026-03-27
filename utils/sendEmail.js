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
    subject: "Welcome to Core Prescribing Solutions",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Welcome</title>
  <style>
    @media only screen and (max-width:600px){
      .card  { width:100%!important; border-radius:12px!important; }
      .hpad  { padding:28px 20px 24px!important; }
      .bpad  { padding:22px 20px!important; }
      .rstrip{ padding:10px 20px!important; }
      .fpad  { padding:14px 20px 20px!important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef0f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <table class="card" width="500" cellpadding="0" cellspacing="0"
        style="background:#ffffff;border-radius:16px;overflow:hidden;
               border:1px solid #dddaf0;box-shadow:0 8px 32px rgba(30,0,195,0.10);">

        <!-- HEADER -->
        <tr>
          <td class="hpad"
            style="background:linear-gradient(135deg,#0d0080 0%,#1e00c3 50%,#3318d4 100%);
                   padding:36px 36px 30px;">

            <!-- Logo -->
            <div style="margin-bottom:20px;">
              <img
                src="https://coreprescribingsolutions.co.uk/wp-content/themes/core-prescribing/images/core-prescribing-logo.png"
                alt="Core Prescribing Solutions"
                width="64" height="64"
                style="width:64px;height:64px;border-radius:50%;
                       border:2px solid rgba(255,255,255,0.25);display:block;"/>
            </div>

            <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;
              color:#ffffff;line-height:1.25;">Welcome, ${name}!</h1>
            <p style="margin:0;font-size:13px;color:rgba(180,170,255,0.9);line-height:1.5;">
              Your account is ready. Here are your login credentials.
            </p>
          </td>
        </tr>

        <!-- ROLE STRIP -->
        <tr>
          <td class="rstrip"
            style="background:#f7f6ff;border-bottom:1px solid #eceaf8;padding:11px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:12px;color:#6b7280;">
                  &#x25CF;&nbsp; Assigned role
                </td>
                <td align="right">
                  <span style="font-size:12px;font-weight:600;color:#1e00c3;
                    background:#eeecff;padding:4px 12px;border-radius:20px;">
                    ${role}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td class="bpad" style="padding:28px 36px;">

            <p style="margin:0 0 14px;font-size:10px;font-weight:700;color:#b0b8c8;
              letter-spacing:0.1em;text-transform:uppercase;">Login Credentials</p>

            <!-- Email field -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="margin-bottom:10px;background:#f9f9fd;border:1px solid #eceaf8;
                     border-radius:10px;">
              <tr>
                <td style="padding:14px 18px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right:14px;vertical-align:middle;">
                        <div style="width:36px;height:36px;background:#eeecff;
                          border-radius:8px;text-align:center;line-height:36px;">
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none"
                            style="vertical-align:middle;margin-top:10px;">
                            <rect x="2" y="5" width="16" height="11" rx="2"
                              stroke="#1e00c3" stroke-width="1.5"/>
                            <path d="M2 8l8 5 8-5" stroke="#1e00c3"
                              stroke-width="1.5" stroke-linecap="round"/>
                          </svg>
                        </div>
                      </td>
                      <td>
                        <p style="margin:0 0 2px;font-size:10px;font-weight:600;
                          color:#b0b8c8;letter-spacing:0.07em;text-transform:uppercase;">Email</p>
                        <p style="margin:0;font-size:14px;color:#1a1a2e;font-weight:500;">
                          ${email}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Password field -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="margin-bottom:18px;background:#f9f9fd;border:1px solid #eceaf8;
                     border-radius:10px;">
              <tr>
                <td style="padding:14px 18px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right:14px;vertical-align:middle;">
                        <div style="width:36px;height:36px;background:#eeecff;
                          border-radius:8px;text-align:center;line-height:36px;">
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none"
                            style="vertical-align:middle;margin-top:10px;">
                            <rect x="5" y="8" width="10" height="9" rx="1.5"
                              stroke="#1e00c3" stroke-width="1.5"/>
                            <path d="M7 8V6a3 3 0 016 0v2" stroke="#1e00c3"
                              stroke-width="1.5" stroke-linecap="round"/>
                            <circle cx="10" cy="12.5" r="1.2" fill="#1e00c3"/>
                          </svg>
                        </div>
                      </td>
                      <td>
                        <p style="margin:0 0 2px;font-size:10px;font-weight:600;
                          color:#b0b8c8;letter-spacing:0.07em;text-transform:uppercase;">
                          Temporary Password</p>
                        <p style="margin:0;font-size:15px;color:#1a1a2e;font-weight:700;
                          font-family:'Courier New',Courier,monospace;letter-spacing:0.06em;">
                          ${password}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Warning -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="margin-bottom:26px;background:#fffbeb;border:1px solid #fde68a;
                     border-radius:10px;">
              <tr>
                <td style="padding:13px 16px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right:12px;vertical-align:top;">
                        <div style="width:20px;height:20px;background:#fef3c7;
                          border-radius:50%;text-align:center;line-height:20px;">
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
                            style="vertical-align:middle;margin-top:5px;">
                            <path d="M6 1L1 10h10L6 1z" stroke="#d97706"
                              stroke-width="1.3" stroke-linejoin="round"/>
                            <line x1="6" y1="5" x2="6" y2="7.5" stroke="#d97706"
                              stroke-width="1.2" stroke-linecap="round"/>
                            <circle cx="6" cy="8.8" r="0.5" fill="#d97706"/>
                          </svg>
                        </div>
                      </td>
                      <td style="font-size:13px;color:#92400e;line-height:1.5;">
                        You will be required to change your password on first login.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:linear-gradient(135deg,#0d0080,#1e00c3);
                  border-radius:10px;">
                  <a href="${loginUrl}"
                    style="display:inline-block;padding:14px 32px;color:#ffffff;
                    font-size:14px;font-weight:600;text-decoration:none;
                    letter-spacing:0.03em;">
                    Sign in to your account &nbsp;&rarr;
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td class="fpad"
            style="padding:16px 36px 22px;border-top:1px solid #f0eeff;">
            <p style="margin:0;font-size:11px;color:#b0b8c8;line-height:1.6;">
              If you did not expect this email, please contact your administrator
              immediately. Do not share your credentials with anyone.
            </p>
          </td>
        </tr>

      </table>

      <p style="margin:14px 0 0;font-size:11px;color:#b0b8c8;text-align:center;">
        &copy; 2025 Core Prescribing Solutions. All rights reserved.
      </p>

    </td>
  </tr>
</table>

</body>
</html>`,
  });
};