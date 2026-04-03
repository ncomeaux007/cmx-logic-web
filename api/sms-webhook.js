/**
 * POST /api/sms-webhook
 *
 * Twilio inbound SMS handler. Manages the AI lead qualification conversation:
 *
 *   Stage flow (prospect):
 *     intro_sent → q1_answered → scheduling → awaiting_approval → approved
 *
 *   Nick's commands (from NICK_PHONE):
 *     YES → approve the most recent awaiting_approval lead (confirms with prospect)
 *     NO  → decline and notify prospect you'll reschedule
 *
 * Set this URL as your Twilio phone number's inbound SMS webhook:
 *   https://cmxlogic.com/api/sms-webhook
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   NICK_PHONE
 *   GOOGLE_SHEETS_SPREADSHEET_ID
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *   ANTHROPIC_API_KEY
 *   AVAILABLE_AUDIT_SLOTS  (optional: pipe-separated list, e.g. "Tuesday Apr 1 at 2pm CT|Wednesday Apr 2 at 10am CT")
 */

const { google } = require('googleapis');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const SHEET_NAME = 'Audit Leads';
const HEADERS = [
  'id', 'name', 'business', 'phone', 'email',
  'pain_point', 'stage', 'last_ai_message', 'proposed_time', 'created_at',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function twimlResponse(res, message) {
  res.setHeader('Content-Type', 'text/xml');
  const safe = (message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`
  );
}

function getAvailableSlots() {
  const env = process.env.AVAILABLE_AUDIT_SLOTS;
  if (env) return env.split('|').map((s) => s.trim());

  // Auto-generate: next 2 weekdays at 2pm CT
  const slots = [];
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  while (slots.length < 2) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      slots.push(
        d.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago',
        }) + ' at 2:00 PM CT'
      );
    }
  }
  return slots;
}

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function readSheet(sheets, spreadsheetId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:Z`,
  });
  return result.data.values || [];
}

function rowToLead(headers, row, rowIndex) {
  const lead = { _row: rowIndex + 1 };
  headers.forEach((h, i) => { lead[h] = row[i] || ''; });
  return lead;
}

async function updateLeadFields(sheets, spreadsheetId, rowNum, updates, headers) {
  for (const [key, value] of Object.entries(updates)) {
    const colIdx = headers.indexOf(key);
    if (colIdx < 0) continue;
    const col = String.fromCharCode(65 + colIdx);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!${col}${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });
  }
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').slice(-10);
}

async function findLeadByPhone(sheets, spreadsheetId, phone) {
  const values = await readSheet(sheets, spreadsheetId);
  if (values.length < 2) return null;
  const headers = values[0];
  const phoneIdx = headers.indexOf('phone');
  const target = normalizePhone(phone);

  for (let i = 1; i < values.length; i++) {
    if (normalizePhone(values[i][phoneIdx] || '') === target) {
      return { lead: rowToLead(headers, values[i], i), headers };
    }
  }
  return null;
}

async function findMostRecentByStage(sheets, spreadsheetId, stage) {
  const values = await readSheet(sheets, spreadsheetId);
  if (values.length < 2) return null;
  const headers = values[0];
  const stageIdx = headers.indexOf('stage');

  for (let i = values.length - 1; i >= 1; i--) {
    if ((values[i][stageIdx] || '') === stage) {
      return { lead: rowToLead(headers, values[i], i), headers };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nick's approval flow (he texts YES or NO)
// ---------------------------------------------------------------------------

async function handleNickReply(body, sheets, spreadsheetId, twilioClient) {
  const normalized = body.toLowerCase().trim();
  const isYes = normalized === 'yes' || normalized.startsWith('yes ');
  const isNo = normalized === 'no' || normalized.startsWith('no ');

  if (!isYes && !isNo) {
    // Not a YES/NO — show Nick the pending lead status
    const found = await findMostRecentByStage(sheets, spreadsheetId, 'awaiting_approval');
    if (!found) return 'No leads awaiting approval right now.';
    const { lead } = found;
    return `Pending: ${lead.name} (${lead.business}) wants ${lead.proposed_time}. Reply YES to confirm or NO to decline.`;
  }

  const found = await findMostRecentByStage(sheets, spreadsheetId, 'awaiting_approval');
  if (!found) return 'No leads currently awaiting your approval.';

  const { lead, headers } = found;
  const prospectPhone = lead.phone.startsWith('+') ? lead.phone : `+${lead.phone}`;

  if (isYes) {
    await updateLeadFields(sheets, spreadsheetId, lead._row, { stage: 'approved' }, headers);
    await twilioClient.messages.create({
      body: `You're all set, ${lead.name}! Nick will call you on ${lead.proposed_time} for your free operations audit. Looking forward to it! – CMX Logic`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: prospectPhone,
    });
    return `\u2705 Confirmed! ${lead.name} at ${lead.business} is booked for ${lead.proposed_time}.`;
  } else {
    await updateLeadFields(sheets, spreadsheetId, lead._row, { stage: 'rescheduling' }, headers);
    await twilioClient.messages.create({
      body: `Hi ${lead.name}, something came up on our end — we need to adjust your audit time. I'll reach out shortly with a couple new options. – CMX Logic`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: prospectPhone,
    });
    return `Got it. ${lead.name} has been notified you'll reschedule.`;
  }
}

// ---------------------------------------------------------------------------
// Prospect conversation flow
// ---------------------------------------------------------------------------

async function handleProspectReply(lead, headers, messageBody, sheets, spreadsheetId) {
  const claude = new Anthropic();
  const { name, business, pain_point: painPoint, stage } = lead;
  let responseText = '';
  let nextStage = stage;

  if (stage === 'intro_sent') {
    const aiResp = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are the CMX Logic AI assistant. You're texting ${name} who runs ${business}. Their main pain point is "${painPoint}" and they just replied: "${messageBody}".

Ask ONE short follow-up question to understand their current process — specifically what tools or software they're using (or not using) to manage this problem. Under 160 chars. Conversational, no fluff. End with "– CMX Logic"`,
        },
      ],
    });
    responseText = aiResp.content[0].text;
    nextStage = 'q1_answered';

  } else if (stage === 'q1_answered') {
    const slots = getAvailableSlots();
    const aiResp = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are the CMX Logic AI assistant texting ${name} from ${business}. They replied: "${messageBody}". You now have enough context. Transition naturally to scheduling their free 30-min audit call.

Offer these two time options:
  Option 1: ${slots[0]}
  Option 2: ${slots[1]}

Ask them to reply "1" or "2". Under 160 chars. Warm but efficient. End with "– CMX Logic"`,
        },
      ],
    });
    responseText = aiResp.content[0].text;
    nextStage = 'scheduling';

  } else if (stage === 'scheduling') {
    const slots = getAvailableSlots();
    const choice = messageBody.trim();
    const pickedSlot = choice.includes('2') && !choice.includes('1') ? slots[1] : slots[0];

    await updateLeadFields(sheets, spreadsheetId, lead._row, { proposed_time: pickedSlot }, headers);

    responseText = `Perfect! I've sent your request to Nick. You'll get a confirmation within the hour. – CMX Logic`;
    nextStage = 'awaiting_approval';

    return { responseText, nextStage, notifyNick: pickedSlot };

  } else {
    responseText = `Thanks ${name}! Nick will be in touch soon. For anything urgent, visit cmxlogic.com. – CMX Logic`;
  }

  return { responseText, nextStage };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Twilio signature validation (enforced in production)
  const isProd = process.env.VERCEL_ENV === 'production';
  if (isProd) {
    const sig = req.headers['x-twilio-signature'];
    const url = `https://${req.headers.host}/api/sms-webhook`;
    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      sig,
      url,
      req.body
    );
    if (!isValid) return res.status(403).send('Forbidden');
  }

  const fromPhone = req.body.From || '';
  const messageBody = (req.body.Body || '').trim();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  try {
    const sheets = await getSheetsClient();
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    // Check if this is Nick replying
    const nickNorm = normalizePhone(process.env.NICK_PHONE || '');
    const fromNorm = normalizePhone(fromPhone);
    if (nickNorm && fromNorm === nickNorm) {
      const reply = await handleNickReply(messageBody, sheets, spreadsheetId, twilioClient);
      return twimlResponse(res, reply);
    }

    // Prospect reply — find their lead record
    const found = await findLeadByPhone(sheets, spreadsheetId, fromPhone);
    if (!found) {
      return twimlResponse(
        res,
        "Hi! I don't have your info on file. Request your free audit at cmxlogic.com – CMX Logic"
      );
    }

    const { lead, headers } = found;
    const result = await handleProspectReply(lead, headers, messageBody, sheets, spreadsheetId);
    const { responseText, nextStage, notifyNick } = result;

    // Update Sheets
    await updateLeadFields(sheets, spreadsheetId, lead._row, {
      stage: nextStage,
      last_ai_message: responseText,
    }, headers);

    // Notify Nick if lead picked a time slot
    if (notifyNick) {
      await twilioClient.messages.create({
        body: `\uD83D\uDCC5 ${lead.name} (${lead.business}) wants to book:\n${notifyNick}\n\uD83D\uDCDE ${lead.phone}\n\nReply YES to confirm or NO to decline.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.NICK_PHONE,
      });
    }

    twimlResponse(res, responseText);
  } catch (err) {
    console.error('[sms-webhook] error:', err);
    twimlResponse(res, "Thanks for reaching out! We'll follow up with you shortly. – CMX Logic");
  }
};
