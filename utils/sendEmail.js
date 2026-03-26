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
  const loginUrl = process.env.CLIENT_URL?.split(",")[1] || "https://cps-tau-five.vercel.app";

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Welcome to Core Prescribing System — Your Login Credentials",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #1e40af;">Welcome, ${name}!</h2>
        <p>Your account has been created on the <strong>Core Prescribing System</strong>.</p>
        <p><strong>Role:</strong> ${role}</p>
        <hr style="border-color: #e2e8f0;" />
        <p><strong>Your login credentials:</strong></p>
        <p>📧 <strong>Email:</strong> ${email}</p>
        <p>🔑 <strong>Temporary Password:</strong> <code style="background:#f1f5f9;padding:4px 8px;border-radius:6px;">${password}</code></p>
        <br/>
        <p style="color:#ef4444;"><strong>⚠️ You will be asked to change your password on first login.</strong></p>
        <br/>
        <a href="${loginUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Login Now →</a>
        <br/><br/>
        <p style="color:#94a3b8;font-size:12px;">If you did not expect this email, please contact your administrator.</p>
      </div>
    `,
  });
};