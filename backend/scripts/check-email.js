import { createSmtpMailer } from '../mail.js';

if (!process.env.SMTP_HOST) {
  console.error('SMTP_HOST is not configured in backend/.env.');
  process.exitCode = 1;
} else {
  const port = Number(process.env.SMTP_PORT || 587);
  const mailer = createSmtpMailer({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {})
  });
  try {
    await mailer.verify();
    console.log('SMTP connection and authentication passed. No email was sent.');
  } catch (error) {
    console.error(`SMTP verification failed: ${error.code || 'unknown'}${error.responseCode ? ` (${error.responseCode})` : ''}. No email was sent.`);
    if (error.code === 'EAUTH') console.error('Set SMTP_USER and a valid provider App Password in backend/.env.');
    process.exitCode = 1;
  } finally {
    mailer.close();
  }
}
