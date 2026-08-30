const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Single entry point for all outbound email — every notification in the
// app calls this, so swapping email providers later means changing this
// one file, not every controller that sends mail.
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — skipping email to ${to}: "${subject}"`);
    return;
  }
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'KoboBuy <onboarding@resend.dev>',
      to,
      subject,
      html,
    });
  } catch (error) {
    // Email failures should never break the request that triggered them
    // (an order, an offer response, etc.) — log and move on.
    console.error(`Failed to send email to ${to}:`, error.message);
  }
}

// Shared wrapper so every transactional email looks consistent without
// duplicating the header/footer markup in every controller.
function wrapEmail(bodyHtml) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="background: #04342C; padding: 20px; text-align: center;">
        <span style="color: #ffffff; font-size: 18px; font-weight: 600;">Kobo<span style="color: #FAC775;">Buy</span></span>
      </div>
      <div style="padding: 24px; color: #1A1A1A; font-size: 14px; line-height: 1.6;">
        ${bodyHtml}
      </div>
      <div style="padding: 16px 24px; color: #8B8A84; font-size: 12px;">
        KoboBuy — buy smart, sell easy, negotiate freely.
      </div>
    </div>
  `;
}

module.exports = { sendEmail, wrapEmail };
