// Whole conversations, as customers really have them (many come from the owner's live tests).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, all } from './helpers.js';

let newChat, ai;
before(async () => { ({ newChat, ai } = await setup()); });
const answer = (reply, extra = {}) => async () => ({ action: 'answer', reply, itemIds: [], ...extra });

/** Through area → project → budget → name, ready for a time. */
async function toTimeStep(c, { area = 'Kokapet', project = 'Skyline Towers 2', budget = '85', name = 'Ravi' } = {}) {
  await c.choose(area); await c.choose(project); await c.choose(budget);
  return c.text(name);
}

test('unknown language: "hi" asks English / Telugu once', async () => {
  const c = newChat();
  const r = await c.text('hi');
  assert.match(r[0].text, /choose your language/);
  assert.deepEqual(r[0].options.map((o) => o.id), ['LANG_en', 'LANG_te']);
  const r2 = await c.choose('తెలుగు');
  assert.match(r2[0].text, /ఏ ప్రాంతంలో/);
  assert.equal(c.lead.language, 'te');
});

test('Telugu keyboard: straight into Telugu, full booking with Telugu pass, name and call line', async () => {
  const c = newChat();
  const r = await c.text('నమస్తే');
  assert.match(r[0].text, /ఏ ప్రాంతంలో/);
  const slots = await toTimeStep(c, { name: 'నా పేరు రవి' });
  assert.match(slots.at(-1).text, /సమయం/);
  assert.ok(slots.at(-1).options.some((o) => /రేపు/.test(o.title)), 'Telugu time buttons');
  const offer = await c.text('రేపు మూడు గంటలకి రావచ్చా?');
  assert.match(offer[0].text, /సరిపోతుంది/);
  const pass = all(await c.choose('✅'));
  assert.match(pass, /VIP సైట్ విజిట్ పాస్/);
  assert.match(pass, /పేరు:\* రవి/);
  assert.match(pass, /3:00 PM/);
  assert.match(pass, /📞/);
  assert.equal(c.lead.name, 'రవి');
});

test('English sentence: English straight away; typed time → one-tap booking; name on the pass', async () => {
  const c = newChat();
  assert.match((await c.text('Hello, I am looking for a 3 BHK flat'))[0].text, /Which area/);
  await toTimeStep(c, { name: 'my name is ravi kumar' });
  const offer = await c.text('Is it possible to book tomorrow at 4 o\'clock?');
  assert.match(offer[0].text, /4:00 PM\* works/);
  const pass = all(await c.choose('✅'));
  assert.match(pass, /Name:\* Ravi Kumar/);
  assert.match(pass, /Skyline Towers 2 BHK/);
  assert.equal(c.lead.status, 'CONVERTED');
});

test('Tenglish ("naaku villa kavali") → Telugu', async () => {
  const c = newChat();
  assert.match((await c.text('naaku villa kavali'))[0].text, /ఏ ప్రాంతంలో/);
});

test('a chosen language is locked: an English question keeps the chat in Telugu', async () => {
  const c = newChat();
  await c.text('hi'); await c.choose('తెలుగు');
  ai.decide = answer('మా దగ్గర కోకాపేట్‌లో ప్రాజెక్ట్‌లు ఉన్నాయి.');
  await c.text('Can I get a project near Kokapet or any other location?');
  assert.equal(c.lead.language, 'te');
});

test('"In english" switches language (it was once looked up as a place: "Lucknow")', async () => {
  const c = newChat();
  await c.text('hi'); await c.choose('తెలుగు');
  const r = await c.text('In english');
  assert.match(r[0].text, /Which area/);
  assert.equal(c.lead.language, 'en');
});

test('a typed place far from every project is not accepted as the area', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi');
  ai.geocode = async () => ({ lat: 26.87, lng: 81.02, label: 'Gomti Nagar, Lucknow 226010' });
  ai.decide = async () => null;
  const r = await c.text('Gomti Nagar');
  assert.doesNotMatch(all(r), /Lucknow/);
  assert.equal(c.lead.data.area, undefined);
  ai.geocode = async () => null;
});

test('"ok" while a question waits shows its buttons again (no AI)', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Kokapet'); await c.choose('Skyline Towers 2');
  const calls = ai.calls;
  const r = await c.text('ok');
  assert.match(r[0].text, /choose below/);
  assert.ok(r[0].options.some((o) => /85 Lakh/.test(o.title)));
  assert.equal(ai.calls, calls, 'no AI call for ok');
});

test('the AI never books by itself: a guessed slot is only offered as a ✅ button', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await toTimeStep(c);
  const slotId = c.options()[0].id;
  ai.decide = async () => ({ action: 'select', optionId: slotId, reply: 'ok', itemIds: [] });
  const r = await c.text('तुड़े फोर पीम श्लाट बुक चाही');
  assert.equal(c.lead.status === 'CONVERTED', false, 'not booked');
  assert.match(r[0].text, /works/);
  assert.equal(r[0].options[0].id, slotId);
});

test('a time from older messages is ignored: only a time the customer just said is used', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Kokapet'); await c.choose('Skyline Towers 2');
  ai.decide = answer('Sure.', { requestedTime: '2030-01-01 16:00' });
  await c.text('What amenities does it have?');
  assert.equal(c.state.wantTime ?? null, null);
});

test('"book me tomorrow 4 pm" before the time step is noted, then offered first', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi');
  const r = await c.text('book me the slot tomorrow at 4 pm');
  assert.match(r[0].text, /noted your preferred time/);
  await c.choose('Kokapet'); await c.choose('Skyline Towers 2'); await c.choose('85');
  const offer = await c.text('Ravi');
  assert.match(offer.at(-1).text, /You asked for .*4:00 PM/);
});

test('"too soon" offers the earliest time we can still arrange', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await toTimeStep(c);
  const soon = new Date(Date.now() + 20 * 60000);
  const hh = soon.getUTCHours() + 5 + Math.floor((soon.getUTCMinutes() + 30) / 60); const mm = (soon.getUTCMinutes() + 30) % 60;
  if (hh % 24 < 9 || hh % 24 > 18) return; // only meaningful during visiting hours
  const r = await c.text(`today at ${((hh % 24) % 12) || 12}:${String(mm).padStart(2, '0')} ${hh % 24 < 12 ? 'am' : 'pm'}`);
  assert.match(r[0].text, /too soon/);
  assert.match(r[0].text, /earliest we can arrange/);
});

test('budget: below every price → honest "closest"; within → "within"; a range → picked automatically', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Financial'); await c.choose('Business Bay');
  const low = await c.text('My budget is twenty lakhs');
  assert.match(low[0].text, /don't have a property within \*₹20 Lakh/);
  const fit = await c.text('50 lakh');
  assert.match(fit[0].text, /within your budget of \*₹50 Lakh/);
  assert.deepEqual(fit[0].options.map((o) => o.title).sort(), ['Green Meadows Plots', 'Urban Nest 1 BHK']);
  const pick = await c.text('my budget is one and a half crore');
  assert.match(pick[0].text, /your name/);
  assert.equal(c.lead.data.budget, '₹1.2 Cr - ₹1.8 Cr');
});

test('Telugu budget "రెండు కోట్లు" picks ₹1.8 Cr+ and moves on once (no extra nudge)', async () => {
  const c = newChat();
  await c.text('నమస్తే'); await c.choose('Tellapur'); await c.choose('Palm');
  const r = await c.text('నా బడ్జెట్ రెండు కోట్లు');
  assert.equal(r.length, 1);
  assert.match(r[0].text, /పేరు/);
  assert.equal(c.lead.data.budget, '₹1.8 Cr+');
});

test('names: numbers/symbols asked again; a returning customer is not asked again', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Kokapet'); await c.choose('Skyline Towers 2'); await c.choose('85');
  const bad = await c.text('123');
  assert.match(all(bad), /doesn't look right/);
  await c.text('Sunil garu');
  assert.equal(c.lead.name, 'Sunil');
  await c.choose('Tomorrow');
  // back another day: the name step is skipped
  c.state.updatedAt = Date.now() - 2 * 3600e3;
  await c.text('hi'); await c.choose('Kokapet'); await c.choose('Skyline Towers 3');
  const next = await c.choose('85');
  assert.match(next.at(-1).text, /time slot/);
});

test('after booking: reschedule (team alert "Visit rescheduled") and cancel (confirm, alert)', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await toTimeStep(c); await c.choose('Tomorrow');
  const r = await c.text('can I reschedule to saturday 11 am');
  assert.match(r[0].text, /Saturday, .* at 11:00 AM\* works/);
  await c.choose('✅');
  assert.ok(c.sent.some((m) => m.who === 'admin' && /rescheduled/i.test(JSON.stringify(m.args))));
  const ask = await c.text('cancel my visit');
  assert.match(ask[0].text, /cancel your site visit on Saturday/);
  const done = await c.tap('BOOKING_CANCEL');
  assert.match(done[0].text, /is cancelled/);
  assert.equal(c.lead.bookedAt, null);
  assert.ok(c.sent.some((m) => m.who === 'admin' && /Visit cancelled|VISIT CANCELLED/.test(JSON.stringify(m.args))));
});

test('unknown question: team alerted, bot keeps going; "talk to a person" pauses it', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Kokapet');
  ai.decide = async () => ({ action: 'handoff', reply: 'Our team will confirm that for you.', itemIds: [] });
  const r = await c.text('Is there a school nearby?');
  assert.match(all(r), /team will confirm/);
  assert.match(all(r), /choose below/);
  assert.ok(!c.lead.botPaused);
  await c.text('I want to talk to a person');
  assert.ok(c.lead.botPaused);
});

test('voice: unclear → please type/resend (never a hand-over)', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi');
  const r1 = await c.unclearVoice();
  assert.match(r1[0].text, /couldn't hear that voice note/);
  const r2 = await c.unclearVoice();
  assert.match(r2[0].text, /please type your message/i);
  assert.ok(!c.lead.botPaused);
});

test('clear Telugu voice note with English meaning books from it', async () => {
  const c = newChat({ language: 'te' });
  await c.text('hi'); await toTimeStep(c, { name: 'రవి' });
  const r = await c.voice("రేపు మూడు గంటలకి షెడ్యూల్ చేయగలవా.\n(English: Can you schedule it for tomorrow at 3 o'clock?)");
  assert.match(r[0].text, /3:00 PM/);
});

test('team alert: a template Meta refuses falls back to a normal message', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await toTimeStep(c); await c.choose('Tomorrow');
  assert.ok(c.sent.some((m) => m.who === 'admin' && m.kind === 'text'));
  assert.equal(c.lead.adminAlertStatus, 'SENT');
});

test('photo then question: the photo is sent before the budget list', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Kokapet');
  const r = await c.choose('Skyline Towers 2');
  assert.equal(r[0].kind, 'image');
  assert.equal(r[1].kind, 'list');
});

test('greeting mid-flow repeats the full question; after a long pause it starts over', async () => {
  const c = newChat({ language: 'en' });
  await c.text('hi'); await c.choose('Kokapet');
  const again = await c.text('hello');
  assert.match(again[0].text, /projects in \*Kokapet\*/);
  c.state.updatedAt = Date.now() - 40 * 60000;
  const fresh = await c.text('hi');
  assert.match(fresh[0].text, /Which area/);
});

test('team alert: a template still waiting for Meta falls back to the approved one, then to a normal message', async () => {
  const c = newChat({ language: 'en', templates: { adminAlertName: 'team_booking_alert,team_lead_alert' }, refuse: ['team_booking_alert'] });
  await c.text('hi'); await toTimeStep(c); await c.choose('Tomorrow');
  const sentAlert = c.sent.filter((m) => m.who === 'admin');
  assert.equal(sentAlert.length, 1);
  assert.equal(sentAlert[0].kind, 'template');
  assert.equal(sentAlert[0].args[0], 'team_lead_alert');
  assert.equal(c.lead.adminAlertStatus, 'SENT');
  const d = newChat({ language: 'en', templates: { adminAlertName: 'team_booking_alert,team_lead_alert' }, refuse: [] });
  await d.text('hi'); await toTimeStep(d); await d.choose('Tomorrow');
  assert.equal(d.sent.find((m) => m.who === 'admin').args[0], 'team_booking_alert', 'once approved, the Utility one is used');
});
