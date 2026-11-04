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

## 2026-11-02 09:49 — 2 Nov: four close answer pairs reworded (Cutting not-issued vs used/unused, Job Work filters vs SKU-not-in-master, Sales Orders approve vs locked, Order Console quantity approve) — 2 questions now answered right outright, 1 'did you mean' list changed; no score worse

- answer `eval|shop|apna sales order edit nhi ho rha approve hone ke baad`
  - before: - · Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain? sales order e
  - after: or-so-locked · Apna order tabhi badal sakte hain jab woh Draft ya Returned ho. Place ya approve hone ke b
- answer `eval|shop|kitna cut pada hai jo abhi karigar ko nhi gaya`
  - before: - · Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain? used partly u
  - after: pr-cut-not-issued · Pehle box mein Cut, not yet issued chuniye. Har order line par kate, issue hue aur baaki p
- answer `eval2|shop|embroidery line got cut but never went to any karigar, where are those pieces now`
  - before: - · I'm not fully sure what you mean. Is it one of these? embroidery cutting goes where how to
  - after: - · I'm not fully sure what you mean. Is it one of these? embroidery cutting goes where cut no

## 2026-11-04 10:27 — Choices with the same words carry their screen and open that answer (Ravi, 4 Nov: "CPC-002" looped on four "CPC" buttons)

- answer `eval|shop|order console kis kaam aata hai`
  - before: - · Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain? Order Console
  - after: - · Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain? Order Console
- answer `eval|shop|स्टेटस में 25 to make का मतलब क्या है`
  - before: - · आपका सवाल एक से ज़्यादा जवाबों से मिलता है। आप कौन-सा पूछ रहे हैं? Pending, In Progress, C
  - after: - · आपका सवाल एक से ज़्यादा जवाबों से मिलता है। आप कौन-सा पूछ रहे हैं? Pending, In Progress, C
- answer `eval2|shop|sab log sku sku bolte rehte h, iska matlab kya hua`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? SKU kya hai sku kya h
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? SKU kya hai · Shopify
- answer `eval2|shop|karigar matlab darzi hi na? ya koi aur`
  - before: - · Your question fits more than one answer. Which one do you mean? how to filter Karigar Kari
  - after: - · Your question fits more than one answer. Which one do you mean? how to filter Karigar · Ma
- answer `eval2|shop|what's the difference between article type and subtype`
  - before: - · Your question fits more than one answer. Which one do you mean? -- Article type -- what is
  - after: - · Your question fits more than one answer. Which one do you mean? -- Article type -- · Quali
- answer `eval2|shop|master database aur masters dono alag h kya`
  - before: - · Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain? master databa
  - after: - · Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain? master databa
- answer `eval2|shop|mark sent dabaya to bol raha pehle row select karo`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? Mark sent kya hai Mar
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? Mark sent kya hai · A
- answer `eval2|shop|is there a way to see more info about a number without clicking on it`
  - before: - · I'm not fully sure what you mean. Is it one of these? Click to see only these Click to see
  - after: - · I'm not fully sure what you mean. Is it one of these? Click to see only these · In Product
- answer `eval2|shop|it won't let me type 10.5 pieces`
  - before: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? box me akshar nahi ja
  - after: - · Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain? box me akshar nahi ja
- answer `parts|mst|Cut किसलिए है`
  - before: - · आपका सवाल एक से ज़्यादा जवाबों से मिलता है। आप कौन-सा पूछ रहे हैं? Cut क्या है Cut क्या है
  - after: - · आपका सवाल एक से ज़्यादा जवाबों से मिलता है। आप कौन-सा पूछ रहे हैं? Cut क्या है · Masters (
- answer `parts|gdesk|what does Date show`
  - before: - · Your question fits more than one answer. Which one do you mean? Date * Date Date
  - after: - · Your question fits more than one answer. Which one do you mean? Date * Date · Greige Desk 
- answer `parts|pack|what does Invoice # show`
  - before: - · Your question fits more than one answer. Which one do you mean? Invoice # Invoice # Invoic
  - after: - · Your question fits more than one answer. Which one do you mean? Invoice # · Packing List (
- answer `parts|flow|what does Printer show`
  - before: - · Your question fits more than one answer. Which one do you mean? Printer Printer + Printer
  - after: - · Your question fits more than one answer. Which one do you mean? Printer · Production flow 
- answer `parts|flow|what does Date show`
  - before: - · Your question fits more than one answer. Which one do you mean? Date Date Date
  - after: - · Your question fits more than one answer. Which one do you mean? Date · Production flow (bo
- answer `parts|adj|what does Low show`
  - before: - · Your question fits more than one answer. Which one do you mean? Low Low when does status s
  - after: - · Your question fits more than one answer. Which one do you mean? Low · Adjustments Low · Fi

## 2026-11-04 11:24 — check means looking, not QC; Shopify Orders answers for this bucket, No stock, checking an order (Ravi, 4 Nov)

- answer `eval|shop|चेक हो गए पीस ठीक हैं, क्यूसी में ओके कैसे करूं`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? Checks फ़ॉर्म में available कैसे
  - after: - · आपका सवाल एक से ज़्यादा जवाबों से मिलता है। आप कौन-सा पूछ रहे हैं? QC क्या है QC कितने पीस
- answer `eval|shop|प्रिंटर ने जो भेजा वो पोर्टल में कहाँ दिखेगा`
  - before: or-shop-bucket · फ़िल्टर के पास Bucket आइकन दबाएँ, Needs production में लाइनें टिक करें और Open ticked prod
  - after: or-shop-bucket · Bucket में वे Shopify लाइनें रहती हैं जिन्हें बनाना है — वे उसके Needs production टैब पर ह
- answer `eval2|shop|वेटिंग फॉर क्यूसी में 30 है पर चेक्स फॉर्म 120 बचे बता रहा, कौन सही है`
  - before: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? QC में पीस पास कैसे करें QC में 
  - after: - · मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं? QC चेक एडिट क्यों नहीं हो रहा QC

