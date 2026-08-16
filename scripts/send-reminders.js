// Reads Hearth's chores + members from Firestore, figures out what's due
// today, and emails and/or texts (via Twilio) whoever it's assigned to.
// Runs once a day via the GitHub Actions workflow in
// .github/workflows/chore-reminders.yml.

import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import twilio from 'twilio';

const TIMEZONE = 'America/New_York'; // change if your family isn't in Eastern time
const DEFAULT_COUNTRY_CODE = '1'; // US — prefixed onto 10-digit numbers for Twilio's E.164 format

function toE164(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`; // best effort for anything already including a country code
}

function todayKeyInTz(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`; // en-CA gives YYYY-MM-DD
}

function weekdayInTz(tz) {
  // 0=Sun..6=Sat, matching the app's Date.getDay()
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[fmt.format(new Date())];
}

function isChoreDueToday(chore, weekday) {
  return !chore.days || chore.days.length === 0 || chore.days.includes(weekday);
}

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const [membersSnap, choresSnap] = await Promise.all([
    db.collection('hearth').doc('hearth-members-v1').get(),
    db.collection('hearth').doc('hearth-chores-v1').get(),
  ]);
  const members = membersSnap.exists ? membersSnap.data().value || [] : [];
  const chores = choresSnap.exists ? choresSnap.data().value || [] : [];

  if (members.length === 0 || chores.length === 0) {
    console.log('No members or no chores yet — nothing to send.');
    return;
  }

  const tKey = todayKeyInTz(TIMEZONE);
  const weekday = weekdayInTz(TIMEZONE);

  const dueByMember = {};
  for (const chore of chores) {
    const done = !!(chore.completed && chore.completed[tKey]);
    if (done) continue;
    if (!isChoreDueToday(chore, weekday)) continue;
    (dueByMember[chore.memberId] = dueByMember[chore.memberId] || []).push(chore.title);
  }

  const membersWithChores = members.filter((m) => dueByMember[m.id] && dueByMember[m.id].length > 0 && m.notify && m.notify !== 'off');
  if (membersWithChores.length === 0) {
    console.log('Nobody has chores due today (or nobody has reminders turned on).');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  for (const member of membersWithChores) {
    const list = dueByMember[member.id];
    const plainList = list.join(', ');

    if ((member.notify === 'email' || member.notify === 'both') && member.email) {
      await transporter.sendMail({
        from: `Hearth <${process.env.GMAIL_USER}>`,
        to: member.email,
        subject: `Hearth: ${list.length} chore${list.length > 1 ? 's' : ''} due today`,
        text: `Hi ${member.name},\n\nToday's chores:\n- ${list.join('\n- ')}\n\n— Hearth`,
      });
      console.log(`Emailed ${member.name} at ${member.email}`);
    }

    if ((member.notify === 'text' || member.notify === 'both') && member.phone) {
      try {
        await twilioClient.messages.create({
          body: `DWORSKY chores today: ${plainList}. Reply STOP to opt out.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: toE164(member.phone),
        });
        console.log(`Texted ${member.name} via Twilio`);
      } catch (err) {
        console.error(`Failed to text ${member.name}: ${err.message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
