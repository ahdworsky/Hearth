// Reads Hearth's chores + members from Firestore, figures out what's due
// today, and emails (or emails-as-text, via carrier gateways) whoever it's
// assigned to. Runs once a day via the GitHub Actions workflow in
// .github/workflows/chore-reminders.yml.

import admin from 'firebase-admin';
import nodemailer from 'nodemailer';

const TIMEZONE = 'America/New_York'; // change if your family isn't in Eastern time

const CARRIERS = {
  'AT&T': 'txt.att.net',
  'Verizon': 'vtext.com',
  'T-Mobile': 'tmomail.net',
  'Boost Mobile': 'sms.myboostmobile.com',
  'Cricket': 'sms.cricketwireless.net',
  'US Cellular': 'email.uscc.net',
  'Google Fi': 'msg.fi.google.com',
  'Metro by T-Mobile': 'mymetropcs.com',
  'Visible': 'vtext.com',
};

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

    if ((member.notify === 'text' || member.notify === 'both') && member.phone && member.carrier && CARRIERS[member.carrier]) {
      const digits = member.phone.replace(/\D/g, '');
      const gatewayAddress = `${digits}@${CARRIERS[member.carrier]}`;
      await transporter.sendMail({
        from: `Hearth <${process.env.GMAIL_USER}>`,
        to: gatewayAddress,
        subject: '',
        text: `Hearth chores today: ${plainList}`,
      });
      console.log(`Texted ${member.name} via ${member.carrier}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
