// Ready-made conversation flows per industry. A business picks one and edits it in the Flow Builder.
// Placeholders in texts: {business} {name} {address} {adminPhone} and any step field, e.g. {service} {slot}.

const choice = (id, field, label, text, options, extra = {}) => ({
  id, type: 'choice', field, label, text,
  // [id, button text, saved as, description, next step id (optional branch)]
  options: options.map(([oid, title, saveAs = title, description = '', next = null]) => ({ id: oid, title, label: saveAs, description, next })),
  listHeader: 'Choose an option', listButton: 'View options', listSection: 'Options', ...extra,
});
const question = (id, field, label, text, input = 'text', extra = {}) => ({ id, type: 'question', field, label, text, input, ...extra });
const slots = (id, field, label, text, plan, extra = {}) => ({ id, type: 'slots', field, label, text, plan, ...extra });
const send = (id, kind, text = '', extra = {}) => ({ id, type: 'send', kind, text, ...extra });
const finish = (id, text, extra = {}) => ({ id, type: 'finish', text, alertTeam: true, setStatus: 'CONVERTED', ...extra });

export const DEFAULT_MESSAGES = Object.freeze({
  completed: 'Thanks {name}! Our team at *{business}* has your details and will be in touch. For anything urgent, call +{adminPhone}.',
  optOut: 'Understood. You will not receive further updates from {business}. Have a great day! 🙏',
  nudge: 'Please tap one of the options below so we can help you faster 👇',
  invalidInput: "Sorry, that doesn't look right. Please try again.",
  handoff: "No problem! Someone from *{business}* will contact you shortly. You can also call us on +{adminPhone}.",
  slotPassed: 'That time slot has already passed. Here are the next available slots:',
  error: 'We hit a small snag. Please reply *Hi* to restart, or our team will reach out shortly.',
});

const WEEKEND = [{ day: 'TOMORROW', time: '11:00' }, { day: 'SAT', time: '16:00' }, { day: 'SUN', time: '11:00' }];
const WORKDAYS = [{ day: 'TOMORROW', time: '10:00' }, { day: 'TOMORROW', time: '16:00' }, { day: 'SAT', time: '11:00' }];

export const TEMPLATES = [
  {
    key: 'real_estate', name: 'Real estate', icon: 'building',
    description: 'Location or pincode, that area\'s projects, budget, brochure, site visit booking.',
    flow: {
      steps: [
        question('area', 'area', 'Preferred area', 'Welcome to *{business}*! 🏠 Which area are you looking for a home in?\nPick one of our locations, or type your pincode or area name.', 'location', { setStatus: 'ENGAGED' }),
        choice('home', 'project', 'Project', 'Here are our projects in *{area}*. Which one would you like to see?', [
          ['PRJ_1', 'Lake View Towers'], ['PRJ_2', 'Green Meadows'], ['PRJ_3', 'Skyline Villas'],
        ], { listHeader: 'Our projects', listSection: 'Projects' }),
        choice('budget', 'budget', 'Budget', 'You selected *{project}*. Please select your comfortable investment range:', [
          ['BUDGET_TIER_1', '₹85 Lakh - ₹1.2 Cr', '₹85 Lakh - ₹1.2 Cr', 'Standard Floors'],
          ['BUDGET_TIER_2', '₹1.2 Cr - ₹1.8 Cr', '₹1.2 Cr - ₹1.8 Cr', 'Lake Facing & High Floors'],
          ['BUDGET_TIER_3', '₹1.8 Cr+', '₹1.8 Cr+', 'Corner Units & Penthouses'],
        ], { setStatus: 'QUALIFIED', forceList: true, listHeader: 'Select Your Budget', listButton: 'View Budget Tiers', listSection: 'Investment Bracket' }),
        send('brochure', 'document', 'Here is the verified master plan and floor blueprint for *{business}*.'),
        slots('visit', 'visit', 'Site visit', 'Early-bird pricing is locked via an in-person Experience Centre visit. Select a convenient time slot:', WEEKEND),
        send('pin', 'location'),
        finish('done', '✅ *VIP Site Visit Pass Confirmed!*\n\n• *Project:* {project}\n• *Area:* {area}\n• *Scheduled Slot:* {visit}\n• *Site Address:* {address}\n\nOur Senior Property Advisor will welcome you at the reception. Show this message at the security gate for reserved parking.'),
      ],
      messages: { ...DEFAULT_MESSAGES, completed: 'Our Property Consultant is reviewing your visit file for *{business}*. For immediate help, call: +{adminPhone}.' },
    },
  },
  {
    key: 'clinic', name: 'Clinic / doctor', icon: 'heart',
    description: 'Department, patient name, appointment slot, location.',
    flow: {
      steps: [
        choice('dept', 'department', 'Department', 'Hello! 👋 Welcome to *{business}*. Which department would you like to book?', [
          ['OPT_GENERAL', 'General physician'], ['OPT_DENTAL', 'Dental'], ['OPT_SKIN', 'Skin & hair'], ['OPT_KIDS', 'Child specialist'],
        ], { setStatus: 'ENGAGED' }),
        question('patient', 'patient', 'Patient name', 'Please type the *patient’s full name*.', 'name'),
        question('age', 'age', 'Age', 'What is the patient’s age?', 'number', { setStatus: 'QUALIFIED' }),
        slots('appt', 'appointment', 'Appointment', 'Choose a convenient appointment time:', WORKDAYS),
        send('pin', 'location'),
        finish('done', '✅ *Appointment confirmed*\n\n• *Patient:* {patient}\n• *Department:* {department}\n• *Time:* {appointment}\n• *Address:* {address}\n\nPlease arrive 10 minutes early and bring any previous prescriptions.'),
      ],
      messages: { ...DEFAULT_MESSAGES },
    },
  },
  {
    key: 'salon', name: 'Salon / spa', icon: 'sparkle',
    description: 'Service, stylist preference, booking slot.',
    flow: {
      steps: [
        choice('service', 'service', 'Service', 'Hi! 💇 Welcome to *{business}*. What would you like to book?', [
          ['OPT_HAIRCUT', 'Haircut & styling'], ['OPT_COLOUR', 'Hair colour'], ['OPT_FACIAL', 'Facial & skin'], ['OPT_SPA', 'Spa & massage'], ['OPT_BRIDAL', 'Bridal package'],
        ], { setStatus: 'ENGAGED' }),
        choice('stylist', 'stylist', 'Stylist', 'Any preference for your stylist?', [['OPT_SENIOR', 'Senior stylist'], ['OPT_ANY', 'Anyone available']], { setStatus: 'QUALIFIED' }),
        slots('slot', 'slot', 'Booking', 'Pick a time that suits you:', WORKDAYS),
        finish('done', '✅ *Booking confirmed!*\n\n• *Service:* {service}\n• *Stylist:* {stylist}\n• *Time:* {slot}\n• *Where:* {address}\n\nSee you soon! Reply here if you need to reschedule.'),
      ],
      messages: { ...DEFAULT_MESSAGES },
    },
  },
  {
    key: 'restaurant', name: 'Restaurant', icon: 'food',
    description: 'Table booking: guests, time, name; or menu PDF.',
    flow: {
      steps: [
        choice('want', 'request', 'Request', 'Welcome to *{business}*! 🍽️ How can we help you today?', [['OPT_TABLE', 'Book a table'], ['OPT_MENU', 'See the menu', 'Menu', '', 'menu'], ['OPT_PARTY', 'Party / event']], { setStatus: 'ENGAGED' }),
        choice('guests', 'guests', 'Guests', 'How many guests?', [['OPT_2', '2 people', '2'], ['OPT_4', '3–4 people', '3–4'], ['OPT_6', '5–8 people', '5–8'], ['OPT_9', '9 or more', '9+']], { setStatus: 'QUALIFIED' }),
        slots('time', 'booking', 'Booking time', 'When would you like to come?', [{ day: 'TOMORROW', time: '13:00' }, { day: 'TOMORROW', time: '20:00' }, { day: 'SAT', time: '20:00' }]),
        question('who', 'guest_name', 'Name on booking', 'Whose name should we put the table under?', 'name'),
        finish('done', '✅ *Table booked!*\n\n• *Name:* {guest_name}\n• *Guests:* {guests}\n• *Time:* {booking}\n• *Address:* {address}\n\nWe look forward to hosting you!'),
        send('menu', 'document', 'Here is our menu 📖. Reply *Hi* any time to book a table.', { next: 'END' }),
      ],
      messages: { ...DEFAULT_MESSAGES },
    },
  },
  {
    key: 'coaching', name: 'Coaching / education', icon: 'book',
    description: 'Course, student details, free demo class.',
    flow: {
      steps: [
        choice('course', 'course', 'Course', 'Hello! 🎓 Thanks for your interest in *{business}*. Which course are you looking for?', [
          ['OPT_C1', 'Foundation (Class 8-10)', 'Foundation'], ['OPT_C2', 'JEE / NEET', 'JEE / NEET'], ['OPT_C3', 'Spoken English'], ['OPT_C4', 'Coding for kids'],
        ], { setStatus: 'ENGAGED' }),
        question('student', 'student', 'Student name', 'Please type the *student’s name*.', 'name'),
        choice('mode', 'mode', 'Mode', 'Which mode do you prefer?', [['OPT_ONLINE', 'Online'], ['OPT_OFFLINE', 'At the centre', 'Offline']], { setStatus: 'QUALIFIED' }),
        send('brochure', 'document', 'Here is our course brochure with fees and schedule.'),
        slots('demo', 'demo', 'Demo class', 'Book a *free demo class*:', WORKDAYS),
        finish('done', '✅ *Demo class booked!*\n\n• *Student:* {student}\n• *Course:* {course}\n• *Mode:* {mode}\n• *Time:* {demo}\n\nOur counsellor will call you before the class.'),
      ],
      messages: { ...DEFAULT_MESSAGES },
    },
  },
  {
    key: 'retail', name: 'Shop / e-commerce', icon: 'bag',
    description: 'Product category, budget, callback or catalogue.',
    flow: {
      steps: [
        choice('category', 'category', 'Category', 'Hi! 🛍️ Welcome to *{business}*. What are you shopping for?', [
          ['OPT_A', 'New arrivals'], ['OPT_B', 'Offers & sale', 'Offers'], ['OPT_C', 'Bulk / wholesale', 'Wholesale'], ['OPT_D', 'Order status'],
        ], { setStatus: 'ENGAGED' }),
        send('catalog', 'document', 'Here is our latest catalogue 📒'),
        choice('budget', 'budget', 'Budget', 'What is your budget?', [['OPT_B1', 'Under ₹1,000'], ['OPT_B2', '₹1,000 – ₹5,000'], ['OPT_B3', 'Above ₹5,000']], { setStatus: 'QUALIFIED' }),
        question('city', 'city', 'City', 'Which city should we deliver to?', 'text'),
        finish('done', '🙌 Thanks! Our team will share the best options for *{category}* in your budget (*{budget}*) and delivery to *{city}* shortly.'),
      ],
      messages: { ...DEFAULT_MESSAGES },
    },
  },
  {
    key: 'general', name: 'General enquiry', icon: 'chat',
    description: 'Name, what they need, best time to call.',
    flow: {
      steps: [
        question('name', 'name', 'Name', 'Hello! 👋 Welcome to *{business}*. May I know your name?', 'name', { setStatus: 'ENGAGED' }),
        question('need', 'need', 'Requirement', 'Thanks {name}! How can we help you? Please describe what you need.', 'text', { setStatus: 'QUALIFIED' }),
        choice('callback', 'callback', 'Call time', 'When is a good time for us to call you?', [['OPT_MORNING', 'Morning'], ['OPT_AFTERNOON', 'Afternoon'], ['OPT_EVENING', 'Evening']]),
        finish('done', '✅ Thank you, {name}! Our team will call you in the *{callback}*.'),
      ],
      messages: { ...DEFAULT_MESSAGES },
    },
  },
];

export const getTemplate = (key) => TEMPLATES.find((t) => t.key === key) || TEMPLATES.find((t) => t.key === 'general');

/** A fresh copy of a template's flow, ready to save on a business. */
export const flowFromTemplate = (key) => ({ enabled: true, template: getTemplate(key).key, ...JSON.parse(JSON.stringify(getTemplate(key).flow)) });

// The question in each template that lists what the business sells; filled from Products & Services.
const PRODUCT_STEP = { real_estate: 'home', clinic: 'dept', salon: 'service', coaching: 'course', retail: 'category' };

/** Fits a name into a WhatsApp button/list title, cutting at a word: "JEE Crash Course with…". */
const shorten = (name, max) => {
  const s = String(name).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1); const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trim()}…`;
};

/** Options for a question, one per product/service (max 10), each sending its photo when picked. */
export function optionsFromCatalog(items, forceList = false) {
  const list = items.slice(0, 10);
  const max = list.length > 3 || forceList ? 24 : 20;
  return list.map((it, i) => ({
    id: `OPT_P${i + 1}_${String(it._id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    title: shorten(it.name, max), label: it.name.slice(0, 80), description: (it.price || '').slice(0, 72), next: null, itemId: it._id,
  }));
}

/**
 * A template's flow made for this business: its "what are you looking for" question lists the
 * business's own products/services instead of the samples. Unchanged if it has none.
 */
export function personalizeFlow(flow, key, catalog = []) {
  const items = catalog.filter((x) => x.active !== false);
  if (!items.length) return flow;
  const f = JSON.parse(JSON.stringify(flow));
  const stepId = PRODUCT_STEP[key];
  const step = stepId && f.steps.find((s) => s.id === stepId && s.type === 'choice');
  if (step) {
    step.options = optionsFromCatalog(items, step.forceList);
    // Sample bullet lists in the question text would no longer match.
    step.text = step.text.split('\n').filter((l) => !/^\s*[•\-*]\s/.test(l)).join('\n').trim();
  } else if (key === 'restaurant') {
    // "See the menu" also shows the dishes with photos before the menu PDF.
    const want = f.steps.find((s) => s.id === 'want');
    const menuOpt = want?.options.find((o) => o.next === 'menu');
    if (menuOpt) {
      menuOpt.next = 'dishes';
      f.steps.splice(f.steps.findIndex((s) => s.id === 'menu'), 0, send('dishes', 'catalog', 'Here are some of our favourites 😋', { itemIds: items.slice(0, 10).map((x) => x._id), next: 'menu' }));
    }
  } else if (key === 'general') {
    const at = f.steps.findIndex((s) => s.id === 'need');
    if (at >= 0) {
      f.steps.splice(at, 0, choice('interest', 'interest', 'Interested in', 'Thanks {name}! Which of these are you interested in?', [], { setStatus: 'ENGAGED' }));
      f.steps[at].options = optionsFromCatalog(items);
      f.steps[at + 1].text = 'Anything else you would like us to know? Please describe what you need.';
    }
  }
  return f;
}
