# Meera — changes accepted into the baseline

Each entry: when, why, and what it changed. Made by `node meera/tests/gate.cjs --accept "why"`.

## 2026-10-29 07:38 — Phase 2: the clock/date answers only when that is all the question asks. The attendance question (टाइम डालना है) no longer gets the time of day and now offers the attendance answers; 5 questions about Date columns no longer get today's date. Also हाज़िरी with the dot is read as attendance.

- answer `eval|shop|परसों की हाज़िरी अब भर सकते हैं क्या, टाइम डालना है`
  - before: - · अभी 10:30 am बजे हैं।
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? कल की हाज़िरी कैसे भरें दो फ़ोन 
- answer `eval2|shop|what's this AMZ-dash-date-dash-01 type number at the top of the form`
  - before: - · Today is Thursday, 29 October 2026 .
  - after: - · I'm not fully sure what you mean. Is it one of these? how to change date Type the order nu
- answer `parts|gdesk|what does Date show`
  - before: - · Today is Thursday, 29 October 2026 .
  - after: - · Your question fits more than one answer. Which one do you mean? Date * Date Date
- answer `parts|shop|Placed today ka kya matlab hota hai`
  - before: - · Aaj Thursday, 29 October 2026 hai.
  - after: c-shop-867 · Placed today — Shopify Orders par option: Aaj aaye order dikhata hai.
- answer `parts|so|what happens if i press Order date`
  - before: - · Today is Thursday, 29 October 2026 .
  - after: c-so-1779 · Order date — box on Sales Orders: The order date; required, and part of the order number (
- answer `parts|flow|what does Date show`
  - before: - · Today is Thursday, 29 October 2026 .
  - after: - · Your question fits more than one answer. Which one do you mean? Date Date Date

## 2026-10-29 08:42 — Phase 2 checks: the baseline now also records spelling set 2 (447, held back, scoring only) and Hindi-script spelling mistakes (114) — with the spell switch off, as everyone has it. No answer changed.

- no score or answer changed (only the record refreshed)

## 2026-11-02 06:54 — R-one test link only: R-one's own answers (name, My work today, Job Work corrections, PPC) are in its bank, so 23 of the 580 recorded answers differ from live

- score: test set 2: right 54→53, offered 66→67, wrong 6→7, not sure 34→33
- score: spelling-mistake questions: right 83→81, offered 116→118, wrong 8→8, not sure 31→31
- score: spelling set 2 (held back, scoring only): right 189→188, offered 165→166, wrong 12→12, not sure 81→81
- score: Hindi-script spelling mistakes: right 50→50, offered 40→39, wrong 0→0, not sure 24→25
- answer `eval|shop|karigar se receive kiya, ab wo piece aage kis screen pe milenge`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? karigar se maal wapas
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? hara button kya karta
- answer `eval|shop|date ke aage 8d laal kyu dikh rha`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? low aur out ka matlab
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? low aur out ka matlab
- answer `eval|shop|customer order line - how do i choose to send it from india stock`
  - before: - · Your question fits more than one answer. Which one do you mean? fulfil customer order from
  - after: - · Your question fits more than one answer. Which one do you mean? fulfil customer order from
- answer `eval|shop|सिकुड़न 5% से ज़्यादा है, अप्रूव कैसे करें`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? करेक्शन रिक्वेस्ट कैसे अप्रूव कर
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? सब एक साथ अप्रूव कैसे करें करेक्
- answer `eval|shop|goods came in, how to close the po as received`
  - before: - · I'm not fully sure what you mean. Is it one of these? how to receive stock in store close 
  - after: - · I'm not fully sure what you mean. Is it one of these? close greige po Close the PO how to 
- answer `eval|shop|कौन सा आर्टिकल मुश्किल है ये लेवल कहाँ भरते हैं`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? शॉपिफाई के कितने ऑर्डर गए आसान/क
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? आसान/कठिन आर्टिकल कैसे तय करें श
- answer `eval|shop|वेंडर की रिक्वेस्ट अप्रूव करनी है, बटन कहाँ है`
  - before: vm-vreq-no-permission · आपके अकाउंट में "Can approve vendor order requests" नहीं है; मंज़ूरी देना आपका काम हो तो ए
  - after: r1-no-vendor-rfd · वेंडर रिक्वेस्ट और RFD requirements न My work today पर हैं न किसी रोल में: उनकी स्क्रीनें 
- answer `eval|shop|rfd requirements screen kha milegi`
  - before: - · I'm not fully sure what you mean. Is it one of these? what is rfd where is rfd requirement
  - after: - · Your question fits more than one answer. Which one do you mean? vendor requests not on my 
- answer `eval|shop|mark rfd cloth as sent to the printer`
  - before: - · Your question fits more than one answer. Which one do you mean? mark rfd sent answering an
  - after: - · Your question fits more than one answer. Which one do you mean? mark rfd sent answering an
- answer `eval|shop|महीने की तनख्वाह की पर्ची निकालनी है`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? सैलरी स्लिप कैसे प्रिंट करें मही
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? सैलरी स्लिप कैसे प्रिंट करें मही
- answer `eval|shop|कल कौन सा ट्रक आएगा`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? Track क्या है Tracking क्या है T
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? चालान पर अब भी Ridhi Home &amp; 
- answer `eval2|shop|karigar matlab darzi hi na? ya koi aur`
  - before: - · Your question fits more than one answer. Which one do you mean? how to filter Karigar Kari
  - after: gn-filters-button · Press Filters in the screen's toolbar, choose what you want in each box, then press Done .
- answer `eval2|shop|fba bolte h wo kaunsa godown h`
  - before: - · I'm not fully sure what you mean. Is it one of these? what is fba pick which one these pie
  - after: - · I'm not fully sure what you mean. Is it one of these? what is fba what is fba dispatch pic
- answer `eval2|shop|ye chhota arrow wala dabba kaise kholte h`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? menu kaise band kare 
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? drop down kya hai men
- answer `eval2|shop|galti se tab band ho gaya, jo bhara tha sab gaya kya`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? tab band karu to data
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? tab band karu to data
- answer `eval2|shop|upar jo bade number wale dabbe h unpe click karne se kya hota h`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? upar ke number kya ha
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? upar ke number kya ha
- answer `eval2|shop|naam aur remark dono hindi me type kar du? chalega`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? kya hindi me likh sak
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? kya hindi me likh sak
- answer `eval2|shop|क्वांटिटी घटाने की रिक्वेस्ट मांगते वक्त ठीक थी, अप्रूव करते समय मना क्यों कर दिया`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? क्वांटिटी बदलाव मना कैसे करें मा
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? क्वांटिटी बदलाव मना कैसे करें रि
- answer `eval2|shop|after freezing a fortnight, if I change a rate does the payout move`
  - before: - · Your question fits more than one answer. Which one do you mean? freeze payout what happens
  - after: - · Your question fits more than one answer. Which one do you mean? freeze payout what happens
- answer `eval2|shop|एक कटिंग एंट्री सेव करने से बाकी किन स्क्रीन पर फर्क पड़ता है`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? कटिंग एंट्री सेव करने से और क्या
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? कटिंग की एंट्री कैसे करें कटिंग 
- answer `eval2|shop|printer typed 100 in his portal but we accepted 92, which one gets paid`
  - before: - · I'm not fully sure what you mean. Is it one of these? print the print order vendor portal 
  - after: - · I'm not fully sure what you mean. Is it one of these? print the print order printer says s
- answer `eval2|shop|maine change maanga tha, ab khud approve kyu nahi kar pa raha`
  - before: dx-no-self-approve · Koi bhi apna correction khud approve nahi kar sakta — kisi aur ko karna hoga — aur jo requ
  - after: r1-jw-correction-no-approve · Approve nahi aata jab request aapki apni ho, ya usme SKU, issue date ya receiving date bad
- answer `eval2|shop|how to change the selling price of a listing on amazon from the erp`
  - before: - · I'm not fully sure what you mean. Is it one of these? amazon order full process from start
  - after: - · I'm not fully sure what you mean. Is it one of these? what is problems on my work today am

