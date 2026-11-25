// Test data: the real-estate flow (with its Telugu wording) and projects of the live demo business,
// with personal details (phone numbers, keys, photos) removed. Regenerate when the flow changes a lot.
export const TENANT = {
 "_id": "00000000-0000-4000-8000-000000000001",
 "businessName": "Demo Realty",
 "industry": "real_estate",
 "adminNotificationPhone": "919000000000",
 "isActive": true,
 "profile": {
  "displayName": "Demo Realty",
  "about": "",
  "address": "",
  "faq": []
 },
 "flow": {
  "enabled": true,
  "template": "real_estate",
  "steps": [
   {
    "id": "area",
    "type": "question",
    "text": "Welcome to *{business}*! 🏠 Which area are you looking for a home in?\nPick one of our locations, or type your pincode or area name.",
    "field": "area",
    "label": "Preferred area",
    "setStatus": "ENGAGED",
    "input": "location",
    "next": null
   },
   {
    "id": "home",
    "type": "choice",
    "text": "Here are our projects in *{area}*. Which one would you like to see?",
    "field": "project",
    "label": "Project",
    "setStatus": null,
    "forceList": false,
    "options": [
     {
      "id": "OPT_P1_F498D014",
      "title": "Skyline Towers 2 BHK",
      "label": "Skyline Towers 2 BHK",
      "description": "₹95 Lakh",
      "next": null,
      "itemId": "f498d014-69c2-45dd-a680-ee9e3dec9a0a"
     },
     {
      "id": "OPT_P2_C735E1CF",
      "title": "Skyline Towers 3 BHK",
      "label": "Skyline Towers 3 BHK",
      "description": "₹1.45 Cr",
      "next": null,
      "itemId": "c735e1cf-abc8-42bc-8ca7-85d6bad45898"
     },
     {
      "id": "OPT_P3_8BB21395",
      "title": "Palm Villas",
      "label": "Palm Villas",
      "description": "₹3.2 Cr",
      "next": null,
      "itemId": "8bb21395-32fc-481d-a7b6-cfd72ec75c43"
     },
     {
      "id": "OPT_P4_128D0C1A",
      "title": "Lakeview Residency",
      "label": "Lakeview Residency",
      "description": "₹1.8 Cr",
      "next": null,
      "itemId": "128d0c1a-5cb3-48c8-a857-98a6adb49f8a"
     },
     {
      "id": "OPT_P5_AEC11E6A",
      "title": "Green Meadows Plots",
      "label": "Green Meadows Plots",
      "description": "₹45 Lakh",
      "next": null,
      "itemId": "aec11e6a-bee8-4b00-930c-aaf9b1c7527c"
     },
     {
      "id": "OPT_P6_9F497234",
      "title": "Business Bay Offices",
      "label": "Business Bay Offices",
      "description": "₹2.5 Cr",
      "next": null,
      "itemId": "9f497234-338a-4f46-877a-8ab3c19ea268"
     },
     {
      "id": "OPT_P7_709CC0CA",
      "title": "Serene Homes 2 BHK",
      "label": "Serene Homes 2 BHK",
      "description": "₹72 Lakh",
      "next": null,
      "itemId": "709cc0ca-b51d-4049-9a09-50746afa1fd2"
     },
     {
      "id": "OPT_P8_842A291D",
      "title": "Royal Villas",
      "label": "Royal Villas",
      "description": "₹4.5 Cr",
      "next": null,
      "itemId": "842a291d-3f0c-4ea6-be1f-c41230612f7d"
     },
     {
      "id": "OPT_P9_38E72269",
      "title": "Urban Nest 1 BHK",
      "label": "Urban Nest 1 BHK",
      "description": "₹48 Lakh",
      "next": null,
      "itemId": "38e72269-dc84-46ce-8131-fd38cada5b8e"
     },
     {
      "id": "OPT_P10_D533C5FB",
      "title": "Elite Residences 4 BHK",
      "label": "Elite Residences 4 BHK",
      "description": "₹6.5 Cr",
      "next": null,
      "itemId": "d533c5fb-9498-43f4-9910-0ac2232cc8af"
     }
    ],
    "imageItemId": null,
    "listHeader": "Our projects",
    "listButton": "View options",
    "listSection": "Projects",
    "next": null
   },
   {
    "id": "budget",
    "type": "choice",
    "text": "You selected *{project}*. Please select your comfortable investment range:",
    "field": "budget",
    "label": "Budget",
    "setStatus": "QUALIFIED",
    "forceList": true,
    "options": [
     {
      "id": "BUDGET_TIER_1",
      "title": "₹85 Lakh - ₹1.2 Cr",
      "label": "₹85 Lakh - ₹1.2 Cr",
      "description": "Standard Floors",
      "next": null,
      "itemId": null
     },
     {
      "id": "BUDGET_TIER_2",
      "title": "₹1.2 Cr - ₹1.8 Cr",
      "label": "₹1.2 Cr - ₹1.8 Cr",
      "description": "Lake Facing & High Floors",
      "next": null,
      "itemId": null
     },
     {
      "id": "BUDGET_TIER_3",
      "title": "₹1.8 Cr+",
      "label": "₹1.8 Cr+",
      "description": "Corner Units & Penthouses",
      "next": null,
      "itemId": null
     }
    ],
    "imageItemId": null,
    "listHeader": "Select Your Budget",
    "listButton": "View Budget Tiers",
    "listSection": "Investment Bracket",
    "next": null
   },
   {
    "id": "brochure",
    "type": "send",
    "text": "Here is the verified master plan and floor blueprint for *{business}*.",
    "kind": "document",
    "next": null
   },
   {
    "id": "name",
    "type": "question",
    "text": "May I know your name for the visit pass? 😊",
    "field": "name",
    "label": "Name",
    "setStatus": null,
    "input": "name",
    "next": null
   },
   {
    "id": "visit",
    "type": "slots",
    "text": "Early-bird pricing is locked via an in-person Experience Centre visit. Select a convenient time slot:",
    "field": "visit",
    "label": "Site visit",
    "setStatus": null,
    "plan": [
     {
      "day": "TOMORROW",
      "time": "11:00"
     },
     {
      "day": "SAT",
      "time": "16:00"
     },
     {
      "day": "SUN",
      "time": "11:00"
     }
    ],
    "next": null
   },
   {
    "id": "pin",
    "type": "send",
    "text": "",
    "kind": "location",
    "next": null
   },
   {
    "id": "done",
    "type": "finish",
    "text": "✅ *VIP Site Visit Pass Confirmed!*\n\n• *Name:* {name}\n• *Project:* {project}\n• *Area:* {area}\n• *Scheduled Slot:* {visit}\n• *Site Address:* {address}\n\n📞 Our property advisor will call you shortly to confirm your visit.\n\nOur Senior Property Advisor will welcome you at the reception. Show this message at the security gate for reserved parking.",
    "alertTeam": true,
    "setStatus": "CONVERTED",
    "next": null
   }
  ],
  "messages": {
   "completed": "Our Property Consultant is reviewing your visit file for *{business}*. For immediate help, call: +{adminPhone}.",
   "optOut": "Understood. You will not receive further updates from {business}. Have a great day! 🙏",
   "nudge": "Please tap one of the options below so we can help you faster 👇",
   "invalidInput": "Sorry, that doesn't look right. Please try again.",
   "handoff": "No problem! Someone from *{business}* will contact you shortly. You can also call us on +{adminPhone}.",
   "slotPassed": "That time slot has already passed. Here are the next available slots:",
   "error": "We hit a small snag. Please reply *Hi* to restart, or our team will reach out shortly."
  },
  "i18n": {
   "te": {
    "s.area.text": "స్వాగతం *{business}*! 🏠 మీరు ఇంటి కోసం ఏ ప్రాంతంలో చూస్తున్నారు?\nమా స్థలాలలో ఒకదాన్ని ఎంచుకోండి, లేదా మీ పిన్‌కోడ్ లేదా ప్రాంతం పేరును టైప్ చేయండి.",
    "s.home.text": "ఇక్కడ *{area}* లో మా ప్రాజెక్ట్‌లు ఉన్నాయి. ఏది చూడాలనుకుంటున్నారు?",
    "s.home.listHeader": "మా ప్రాజెక్ట్‌లు",
    "s.home.listButton": "ఎంపికలు చూడు",
    "s.home.listSection": "ప్రాజెక్ట్‌లు",
    "o.home.OPT_P1_F498D014.title": "Skyline Towers 2 BHK",
    "o.home.OPT_P1_F498D014.description": "₹95 లక్షలు",
    "o.home.OPT_P2_C735E1CF.title": "Skyline Towers 3 BHK",
    "o.home.OPT_P2_C735E1CF.description": "₹1.45 కోట్లు",
    "o.home.OPT_P3_8BB21395.title": "Palm Villas",
    "o.home.OPT_P3_8BB21395.description": "₹3.2 Cr",
    "o.home.OPT_P4_128D0C1A.title": "Lakeview Residency",
    "o.home.OPT_P4_128D0C1A.description": "₹1.8 Cr",
    "o.home.OPT_P5_AEC11E6A.title": "Green Meadows Plots",
    "o.home.OPT_P5_AEC11E6A.description": "₹45 Lakh",
    "o.home.OPT_P6_9F497234.title": "Business Bay Offices",
    "o.home.OPT_P6_9F497234.description": "₹2.5 Cr",
    "o.home.OPT_P7_709CC0CA.title": "Serene Homes 2 BHK",
    "o.home.OPT_P7_709CC0CA.description": "₹72 Lakh",
    "o.home.OPT_P8_842A291D.title": "Royal Villas",
    "o.home.OPT_P8_842A291D.description": "₹4.5 Cr",
    "o.home.OPT_P9_38E72269.title": "Urban Nest 1 BHK",
    "o.home.OPT_P9_38E72269.description": "₹48 Lakh",
    "o.home.OPT_P10_D533C5FB.title": "Elite Residences 4 BHK",
    "o.home.OPT_P10_D533C5FB.description": "₹6.5 Cr",
    "s.budget.text": "మీరు *{project}* ఎంపిక చేశారు. మీకు సౌకర్యవంతమైన పెట్టుబడి పరిధిని ఎంచుకోండి:",
    "s.budget.listHeader": "మీ బడ్జెట్‌ను ఎంచుకోండి",
    "s.budget.listSection": "పెట్టుబడి బ్రాకెట్",
    "o.budget.BUDGET_TIER_1.title": "₹85 Lakh - ₹1.2 Cr",
    "o.budget.BUDGET_TIER_1.description": "స్టాండర్డ్ ఫ్లోర్స్",
    "o.budget.BUDGET_TIER_2.title": "₹1.2 Cr - ₹1.8 Cr",
    "o.budget.BUDGET_TIER_2.description": "లేక్ ఫేసింగ్ & హై ఫ్లోర్స్",
    "o.budget.BUDGET_TIER_3.title": "₹1.8 Cr+",
    "o.budget.BUDGET_TIER_3.description": "కార్నర్ యూనిట్స్ & పెంట్‌హౌస్‌లు",
    "s.brochure.text": "ఇక్కడ *{business}* కోసం ధృవీకరించబడిన మాస్టర్ ప్లాన్ మరియు ఫ్లోర్ బ్లూప్రింట్ ఉంది.",
    "s.visit.text": "ఎర్లీ-బర్డ్ ధర ఇన్-పర్సన్ ఎక్స్‌పీరియన్స్ సెంటర్ సైట్ విజిట్ ద్వారా లాక్ చేయబడింది. మీకు సౌకర్యవంతమైన సమయం స్లాట్‌ను ఎంచుకోండి:",
    "s.done.text": "✅ *VIP సైట్ విజిట్ పాస్ ధృవీకరించబడింది!*\n\n• *పేరు:* {name}\n• *ప్రాజెక్ట్:* {project}\n• *ప్రాంతం:* {area}\n• *షెడ్యూల్ స్లాట్:* {visit}\n• *సైట్ చిరునామా:* {address}\n\n📞 మీ విజిట్ కన్ఫర్మ్ చేయడానికి మా ప్రాపర్టీ అడ్వైజర్ త్వరలో మీకు కాల్ చేస్తారు.\n\nమా సీనియర్ ప్రాపర్టీ కన్సల్టెంట్ రిసెప్షన్‌లో మిమ్మల్ని స్వాగతిస్తారు. రిజర్వ్డ్ పార్కింగ్ కోసం భద్రతా గేట్‌లో ఈ సందేశాన్ని చూపండి.",
    "m.completed": "*{business}* కోసం మీ సైట్ విజిట్ ఫైల్‌ను మా ప్రాపర్టీ కన్సల్టెంట్ సమీక్షిస్తున్నారు. తక్షణ సహాయం కోసం, +{adminPhone}కి కాల్ చేయండి.",
    "m.optOut": "అర్థం చేసుకున్నాము. {business} నుండి మరిన్ని అప్‌డేట్‌లు మీకు అందవు. మంచి రోజు! 🙏",
    "m.nudge": "దయచేసి దిగువ ఎంపికలలో ఒకదాన్ని టాప్ చేయండి, మేము మీకు వేగంగా సహాయం చేయగలము 👇",
    "m.invalidInput": "దురదృష్టవశాత్తూ, అది సరైనది కాదు. దయచేసి మళ్ళీ ప్రయత్నించండి.",
    "m.handoff": "సమస్యేమీ లేదు! *{business}* నుండి వ్యక్తి త్వరలో మీకు సంప్రదిస్తారు. మీరు +{adminPhone} పై మాకు ఫోన్ చేయవచ్చు.",
    "m.slotPassed": "ఆ టైమ్ స్లాట్ ఇప్పటికే పోయింది. ఇక్కడ తదుపరి అందుబాటులో ఉన్న స్లాట్లు ఉన్నాయి:",
    "m.error": "మనం చిన్న సమస్యను ఎదుర్కొన్నాము. దయచేసి పునఃప్రారంభించడానికి *హాయ్* సమాధానం ఇవ్వండి, లేదా మా బృందం త్వరలో సంప్రదిస్తుంది.",
    "s.budget.listButton": "బడ్జెట్ వివరాలు",
    "s.name.text": "విజిట్ పాస్ కోసం మీ పేరు చెప్పగలరా? 😊"
   }
  }
 },
 "ai": {
  "enabled": true,
  "answerAfterFlow": true,
  "voiceLanguage": "te"
 },
 "templates": {
  "broadcastName": "realestate_offer",
  "broadcastLanguage": "en",
  "adminAlertName": "team_lead_alert",
  "adminAlertLanguage": "en"
 }
};

export const ITEMS = [
 {
  "_id": "f498d014-69c2-45dd-a680-ee9e3dec9a0a",
  "name": "Skyline Towers 2 BHK",
  "price": "₹95 Lakh",
  "category": "Apartments",
  "description": "Gated community with clubhouse, pool, gym and 24/7 security. 5 minutes from the Outer Ring Road.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "2 BHK",
   "area": "1,250 sq.ft",
   "floor": "14th floor",
   "facing": "East",
   "possession": "Under construction",
   "availability": "Available",
   "address": "Kokapet",
   "pincode": "500075",
   "map": "17.3960, 78.3300",
   "lat": 17.396,
   "lng": 78.33
  }
 },
 {
  "_id": "c735e1cf-abc8-42bc-8ca7-85d6bad45898",
  "name": "Skyline Towers 3 BHK",
  "price": "₹1.45 Cr",
  "category": "Apartments",
  "description": "Spacious 3 BHK with two balconies, modular kitchen and covered car parking for 2 cars.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "3 BHK",
   "area": "1,850 sq.ft",
   "floor": "18th floor",
   "facing": "North-East",
   "possession": "Under construction",
   "availability": "Few left",
   "address": "Kokapet",
   "pincode": "500075",
   "map": "17.3960, 78.3300",
   "lat": 17.396,
   "lng": 78.33
  }
 },
 {
  "_id": "8bb21395-32fc-481d-a7b6-cfd72ec75c43",
  "name": "Palm Villas",
  "price": "₹3.2 Cr",
  "category": "Villas",
  "description": "Luxury 4 BHK villas with private pool, home theatre and landscaped garden in a gated villa community.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "Villa",
   "area": "4,200 sq.ft",
   "floor": "G+2",
   "facing": "East",
   "possession": "Ready to move",
   "availability": "Few left",
   "address": "Tellapur",
   "pincode": "502032",
   "map": "17.4650, 78.2780",
   "lat": 17.465,
   "lng": 78.278
  }
 },
 {
  "_id": "128d0c1a-5cb3-48c8-a857-98a6adb49f8a",
  "name": "Lakeview Residency",
  "price": "₹1.8 Cr",
  "category": "Apartments",
  "description": "Lake-facing 3 BHK homes near the IT corridor with sky lounge, jogging track and kids play area.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "3 BHK",
   "area": "2,100 sq.ft",
   "floor": "10th floor",
   "facing": "West",
   "possession": "Ready to move",
   "availability": "Available",
   "address": "Gachibowli",
   "pincode": "500032",
   "map": "17.4401, 78.3489",
   "lat": 17.4401,
   "lng": 78.3489
  }
 },
 {
  "_id": "aec11e6a-bee8-4b00-930c-aaf9b1c7527c",
  "name": "Green Meadows Plots",
  "price": "₹45 Lakh",
  "category": "Plots",
  "description": "HMDA-approved open plots with 40 ft roads, underground drainage and avenue plantation. Clear title.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "Plot",
   "area": "1,800 sq.ft",
   "facing": "North",
   "possession": "Ready to move",
   "availability": "Available",
   "address": "Shadnagar",
   "pincode": "509216",
   "map": "17.0710, 78.2050",
   "lat": 17.071,
   "lng": 78.205
  }
 },
 {
  "_id": "9f497234-338a-4f46-877a-8ab3c19ea268",
  "name": "Business Bay Offices",
  "price": "₹2.5 Cr",
  "category": "Commercial",
  "description": "Grade-A office space with power backup, high-speed lifts and ample parking. Ideal for IT and startups.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "Commercial",
   "area": "3,000 sq.ft",
   "floor": "7th floor",
   "facing": "North",
   "possession": "New launch",
   "availability": "Available",
   "address": "Financial District",
   "pincode": "500032",
   "map": "17.4140, 78.3420",
   "lat": 17.414,
   "lng": 78.342
  }
 },
 {
  "_id": "709cc0ca-b51d-4049-9a09-50746afa1fd2",
  "name": "Serene Homes 2 BHK",
  "price": "₹72 Lakh",
  "category": "Apartments",
  "description": "Bright, airy 2 BHK homes close to schools, hospitals and the metro. Great for young families.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "2 BHK",
   "area": "1,150 sq.ft",
   "floor": "5th floor",
   "facing": "East",
   "possession": "Ready to move",
   "availability": "Available",
   "address": "Kompally",
   "pincode": "500014",
   "map": "17.5360, 78.4860",
   "lat": 17.536,
   "lng": 78.486
  }
 },
 {
  "_id": "842a291d-3f0c-4ea6-be1f-c41230612f7d",
  "name": "Royal Villas",
  "price": "₹4.5 Cr",
  "category": "Villas",
  "description": "Premium 5 BHK villas with rooftop terrace, private pool and smart-home automation near the airport.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "Villa",
   "area": "5,500 sq.ft",
   "floor": "G+2",
   "facing": "North-East",
   "possession": "Under construction",
   "availability": "Available",
   "address": "Shamshabad",
   "pincode": "501218",
   "map": "17.2550, 78.4040",
   "lat": 17.255,
   "lng": 78.404
  }
 },
 {
  "_id": "38e72269-dc84-46ce-8131-fd38cada5b8e",
  "name": "Urban Nest 1 BHK",
  "price": "₹48 Lakh",
  "category": "Apartments",
  "description": "Smart 1 BHK homes, 2 minutes from Miyapur metro. Perfect first home or rental investment.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "1 BHK",
   "area": "650 sq.ft",
   "floor": "9th floor",
   "facing": "South-East",
   "possession": "New launch",
   "availability": "Available",
   "address": "Miyapur",
   "pincode": "500049",
   "map": "17.4960, 78.3570",
   "lat": 17.496,
   "lng": 78.357
  }
 },
 {
  "_id": "d533c5fb-9498-43f4-9910-0ac2232cc8af",
  "name": "Elite Residences 4 BHK",
  "price": "₹6.5 Cr",
  "category": "Luxury homes",
  "description": "Ultra-luxury 4 BHK independent homes with private garden, double-height living room and staff quarters.",
  "layout": "real_estate",
  "isActive": false,
  "details": {
   "config": "4 BHK",
   "area": "6,000 sq.ft",
   "floor": "G+1",
   "facing": "East",
   "possession": "Ready to move",
   "availability": "Few left",
   "address": "Jubilee Hills",
   "pincode": "500033",
   "map": "17.4300, 78.4100",
   "lat": 17.43,
   "lng": 78.41
  }
 }
];
