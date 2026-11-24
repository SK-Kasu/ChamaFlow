function getEmailConfiguration() {
  const { RESEND_API_KEY, EMAIL_FROM, APP_BASE_URL } = process.env;
  if (!RESEND_API_KEY && !EMAIL_FROM && process.env.NODE_ENV !== 'production') {
    let appUrl;
    try {
      appUrl = new URL(APP_BASE_URL || 'http://localhost:5173');
    } catch {
      throw new Error('APP_BASE_URL must be an absolute URL.');
    }
    if (!['http:', 'https:'].includes(appUrl.protocol)) {
      throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname)) {
      throw new Error('Configure Resend before using a non-local APP_BASE_URL.');
    }
    return { delivery: 'console', appUrl };
  }
  if (!RESEND_API_KEY || !EMAIL_FROM || !APP_BASE_URL) {
    throw new Error('Set RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL to enable email verification.');
  }
  let appUrl;
  try {
    appUrl = new URL(APP_BASE_URL);
  } catch {
    throw new Error('APP_BASE_URL must be an absolute URL.');
  }
  if (!['http:', 'https:'].includes(appUrl.protocol)) {
    throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
  }
  if (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS in production.');
  }
  return { delivery: 'resend', apiKey: RESEND_API_KEY, from: EMAIL_FROM, appUrl };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function sendVerificationEmail({ email, fullName, token }) {
  const { delivery, apiKey, from, appUrl } = getEmailConfiguration();
  appUrl.hash = new URLSearchParams({ verify: token }).toString();
  const verificationUrl = appUrl.toString();
  if (delivery === 'console') {
    console.info(`ChamaFlow development verification link: ${verificationUrl}`);
    return;
  }
  const safeName = escapeHtml(fullName);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Verify your ChamaFlow email address',
      text: `Hello ${fullName},\n\nVerify your email address to activate your ChamaFlow account:\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this message.`,
      html: `<p>Hello ${safeName},</p><p>Verify your email address to activate your ChamaFlow account.</p><p><a href="${verificationUrl}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this message.</p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the verification email (HTTP ${response.status}).`);
  }
}

module.exports = { getEmailConfiguration, sendVerificationEmail };
