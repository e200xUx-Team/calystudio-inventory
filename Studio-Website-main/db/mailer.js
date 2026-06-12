'use strict';

/**
 * mailer.js — Nodemailer email service for ePlane Clay Studio
 * Uses Gmail SMTP. Set GMAIL_USER and GMAIL_APP_PASS in Vercel env vars.
 *
 * To get a Gmail App Password:
 * 1. Go to Google Account → Security → 2-Step Verification (must be ON)
 * 2. Go to Security → App passwords
 * 3. Select app: Mail, device: Other → name it "ePlane Studio"
 * 4. Copy the 16-char password → set as GMAIL_APP_PASS in Vercel
 */

const nodemailer = require('nodemailer');

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASS;

  if (!user || !pass) {
    console.warn('[Mailer] GMAIL_USER or GMAIL_APP_PASS not set. Emails will be logged only.');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

async function sendMail({ to, subject, html }) {
  const transporter = getTransporter();
  const from = `"The ePlane Co." <${process.env.GMAIL_USER || 'noreply@eplane.ai'}>`;

  if (!transporter) {
    // Dev fallback — just log
    console.log(`\n📧 [EMAIL LOG]\nTo: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, '')}\n`);
    return;
  }

  await transporter.sendMail({ from, to, subject, html });
  console.log(`[Mailer] Email sent → ${to}: ${subject}`);
}

/* ─── OTP Email ─────────────────────────────────────── */
async function sendOTPEmail({ to, name, otp }) {
  const html = `
    <div style="font-family:Montserrat,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fe;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background:#2563eb;color:#fff;font-weight:800;font-size:20px;padding:12px 20px;border-radius:12px;letter-spacing:1px;">eP</div>
        <div style="font-weight:700;font-size:16px;color:#0d1b2e;margin-top:8px;">The ePlane Co. — Clay Studio</div>
      </div>
      <h2 style="color:#0d1b2e;font-size:20px;margin-bottom:8px;">Reset your password</h2>
      <p style="color:#64748b;font-size:14px;">Hi ${name}, use the OTP below to reset your password. It expires in <strong>10 minutes</strong>.</p>
      <div style="background:#fff;border:2px solid #2563eb;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#2563eb;">${otp}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:8px;">One-time password · valid 10 minutes</div>
      </div>
      <p style="color:#94a3b8;font-size:12px;">If you didn't request this, ignore this email. Your password won't change.</p>
    </div>
  `;
  await sendMail({ to, subject: `${otp} is your ePlane Studio OTP`, html });
}

/* ─── New User Signup Notification to Admins ─────────── */
async function sendNewUserNotification({ adminEmail, adminName, newUserName, newUserEmail }) {
  const approveUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://your-studio.vercel.app';

  const html = `
    <div style="font-family:Montserrat,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fe;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background:#2563eb;color:#fff;font-weight:800;font-size:20px;padding:12px 20px;border-radius:12px;">eP</div>
        <div style="font-weight:700;font-size:16px;color:#0d1b2e;margin-top:8px;">The ePlane Co. — Clay Studio</div>
      </div>
      <h2 style="color:#0d1b2e;font-size:20px;margin-bottom:8px;">New user signup request</h2>
      <p style="color:#64748b;font-size:14px;">Hi ${adminName}, a new team member has requested access to the Clay Studio dashboard.</p>
      <div style="background:#fff;border-radius:12px;padding:20px;margin:20px 0;border-left:4px solid #2563eb;">
        <div style="font-weight:700;color:#0d1b2e;font-size:15px;">${newUserName}</div>
        <div style="color:#64748b;font-size:13px;margin-top:4px;">${newUserEmail}</div>
      </div>
      <p style="color:#64748b;font-size:14px;">Log in to the admin dashboard to approve or reject this request:</p>
      <div style="text-align:center;margin:20px 0;">
        <a href="${approveUrl}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Open Dashboard → Admin Panel</a>
      </div>
      <p style="color:#94a3b8;font-size:12px;">Go to the Admin tab → Users section to manage this request.</p>
    </div>
  `;
  await sendMail({
    to: adminEmail,
    subject: `[Action Required] New signup: ${newUserName} (${newUserEmail})`,
    html,
  });
}

/* ─── Account Approved Notification to User ─────────── */
async function sendApprovalEmail({ to, name, approved }) {
  const loginUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://your-studio.vercel.app';

  const html = approved ? `
    <div style="font-family:Montserrat,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fe;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background:#2563eb;color:#fff;font-weight:800;font-size:20px;padding:12px 20px;border-radius:12px;">eP</div>
        <div style="font-weight:700;font-size:16px;color:#0d1b2e;margin-top:8px;">The ePlane Co. — Clay Studio</div>
      </div>
      <h2 style="color:#16a34a;font-size:20px;">✅ Your account is approved!</h2>
      <p style="color:#64748b;font-size:14px;">Hi ${name}, your Clay Studio account has been approved. You can now sign in.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${loginUrl}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Sign In Now →</a>
      </div>
    </div>
  ` : `
    <div style="font-family:Montserrat,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fe;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background:#2563eb;color:#fff;font-weight:800;font-size:20px;padding:12px 20px;border-radius:12px;">eP</div>
      </div>
      <h2 style="color:#dc2626;font-size:20px;">Account not approved</h2>
      <p style="color:#64748b;font-size:14px;">Hi ${name}, unfortunately your request for Clay Studio access was not approved. Contact an admin if you think this is a mistake.</p>
    </div>
  `;

  await sendMail({
    to,
    subject: approved ? '✅ Your ePlane Studio account is approved' : 'Your ePlane Studio request was not approved',
    html,
  });
}

function isMailerConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASS);
}

module.exports = { sendOTPEmail, sendNewUserNotification, sendApprovalEmail, isMailerConfigured };
