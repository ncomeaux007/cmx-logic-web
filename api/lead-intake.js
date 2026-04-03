/**
 * POST /api/lead-intake
 *
 * Receives CMX Logic audit form submissions. For each submission:
 *   1. Adds the lead to the "Audit Leads" Google Sheet
 *   2. SMS's Nick immediately with lead details
 *   3. Sends an AI-generated intro SMS to the prospect
 *
 * Required env vars (set in Vercel dashboard):
 *   ANTHROPIC_API_KEY
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   NICK_PHONE
 *   GOOGLE_SHEETS_SPREADSHEET_ID
 *   GOOGLE_SERVICE_ACCOUNT_JSON  (full JSON string of the service account key)
 */

const { google } = require('googleapis');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');

const SHEET_NAME = 'Audit Leads';
const HEADERS = [
  'id', 'name', 'business', 'phone', 'email',
  'pain_point', 'stage', 'last_ai_message', 'proposed_time', 'created_at',
];

function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return digits ? `+${digits}` : '';
}

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureAuditLeadsTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map((s) => s.properties.title);
  if (existing.includes(SHEET_NAME)) return;

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
  } catch (e) {
    if (!e.message.toLowerCase().includes('already exists')) throw e;
  }

  const endCol = String.fromCharCode(64 + HEADERS.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:${endCol}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });
}

async function appendLead(sheets, spreadsheetId, data) {
  const row = HEADERS.map((h) => data[h] || '');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

async function updateLeadField(sheets, spreadsheetId, phone, field, value) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:Z`,
  });
  const values = result.data.values || [];
  if (values.length < 2) return;

  const headers = values[0];
  const phoneIdx = headers.indexOf('phone');
  const fieldIdx = headers.indexOf(field);
  if (fieldIdx < 0) return;

  for (let i = 1; i < values.length; i++) {
    const rowPhone = (values[i][phoneIdx] || '').replace(/\D/g, '');
    const targetPhone = phone.replace(/\D/g, '');
    if (rowPhone === targetPhone) {
      const col = String.fromCharCode(65 + fieldIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_NAME}'!${col}${i + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[value]] },
      });
      break;
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { gymName, memberName, phone, email, painPoint } = req.body;

    const formattedPhone = formatPhone(phone);
    const id = uuidv4().slice(0, 8);
    const now = new Date().toISOString();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    // 1. Store lead in Google Sheets
    const sheets = await getSheetsClient();
    await ensureAuditLeadsTab(sheets, spreadsheetId);
    await appendLead(sheets, spreadsheetId, {
      id,
      name: memberName,
      business: gymName,
      phone: formattedPhone,
      email,
      pain_point: painPoint,
      stage: 'new',
      created_at: now,
    });

    // 2. Notify Nick via SMS
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilioClient.messages.create({
      body: `\uD83D\uDD14 New audit request!\n${memberName} \u2014 ${gymName}\n\uD83D\uDCDE ${formattedPhone}\nPain: ${painPoint}\n\nSending AI intro now...`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.NICK_PHONE,
    });

    // 3. Generate AI intro SMS for the prospect
    const claude = new Anthropic();
    const aiResp = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are the CMX Logic AI assistant (a business automation agency in Huntsville, AL). A business owner named ${memberName} runs ${gymName} and just requested a free operations audit. Their biggest pain point is: "${painPoint}".

Write a short, warm SMS (under 160 chars) that:
- Introduces yourself as the CMX Logic assistant
- Acknowledges their specific pain point briefly
- Asks ONE specific qualifying follow-up question about HOW they're currently handling that problem
- Ends with "– CMX Logic"

Be conversational and human, not robotic or salesy. No generic phrases like "I understand your frustration."`,
        },
      ],
    });

    const aiMessage = aiResp.content[0].text;

    // 4. Send the AI intro SMS to the prospect
    await twilioClient.messages.create({
      body: aiMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone,
    });

    // 5. Update stage in Sheets
    await updateLeadField(sheets, spreadsheetId, formattedPhone, 'stage', 'intro_sent');
    await updateLeadField(sheets, spreadsheetId, formattedPhone, 'last_ai_message', aiMessage);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[lead-intake] error:', err);
    // Return success to the form regardless — we don't want the user to see an error
    // Nick's email via Web3Forms still fires as a fallback
    res.status(200).json({ success: true, warning: 'automation error logged' });
  }
};
