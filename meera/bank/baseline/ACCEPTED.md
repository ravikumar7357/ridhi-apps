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

