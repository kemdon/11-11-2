import { Resend } from 'resend';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function field(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !env.CONTACT_FORM_TO_EMAIL) {
    console.error('Contact form email environment variables are not configured.');
    return json({ ok: false, error: 'Email service is not configured.' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 16_384) {
    return json({ ok: false, error: 'Request is too large.' }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  const data = {
    name: field(payload?.name, 120),
    country: field(payload?.country, 120),
    whatsapp: field(payload?.whatsapp, 80),
    type: field(payload?.type, 80),
    brand: field(payload?.brand, 120),
    email: field(payload?.email, 254),
  };

  if (Object.values(data).some((value) => !value)) {
    return json({ ok: false, error: 'Please complete all required fields.' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const subjectName = data.name.replace(/[\r\n]+/g, ' ');
  const text = [
    'New website contact inquiry',
    '',
    `Name: ${data.name}`,
    `Country: ${data.country}`,
    `WhatsApp: ${data.whatsapp}`,
    `Type: ${data.type}`,
    `Car Brand: ${data.brand}`,
    `Email: ${data.email}`,
  ].join('\n');

  try {
    const { error } = await resend.emails.send({
      from: `Website Contact <${env.RESEND_FROM_EMAIL}>`,
      to: [env.CONTACT_FORM_TO_EMAIL],
      replyTo: data.email,
      subject: `Website inquiry from ${subjectName}`,
      text,
    });

    if (error) {
      console.error('Resend rejected contact email:', error.name, error.message);
      return json({ ok: false, error: 'Unable to send your inquiry right now.' }, 502);
    }

    return json({ ok: true });
  } catch (error) {
    console.error('Contact email delivery failed:', error);
    return json({ ok: false, error: 'Unable to send your inquiry right now.' }, 502);
  }
}

export function onRequest() {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
