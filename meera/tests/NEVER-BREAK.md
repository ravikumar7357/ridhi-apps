# Meera — never-break checklist

Everything here must still work after every phase of the v2 rebuild (plan section 2, rule 1).
Most of it is checked automatically on every push:

    node meera/tests/never-break.cjs     the list below, on Meera's real code (28 checks)
    node meera/tests/gate.cjs            scores and the 580 golden answers, against the 29 Oct baseline

The items marked **by hand** need a real screen. Check them on the test link (preview/meera) before asking for
"live karo", signed in as an admin and once as a staff account with fewer rights.

| # | What | Automatic | By hand |
|---|---|---|---|
| 1 | First-visit walk-round on a screen: lights each box, **Next / Try it / Skip**, a click outside ends it | every tour box exists in the app; buttons exist | Open a screen you have never opened (or clear its "seen" mark): the walk-round starts, the light sits on the right box, Next / Try it / Skip work, clicking outside ends it |
| 2 | Mistake lessons: the same red line 3 times → dim + explain | 3 strikes, lesson code present | On Job Work, press Issue with the form empty three times: the lesson shows on the box to fix |
| 3 | Round face button bottom-right + menu (Ask Meera / Show me this screen / Helper on-off); **?** opens Ask | button, menu items, ? key | Click the face: menu opens; each item works; press ? outside a box: Ask opens |
| 4 | Ask Meera in English, Hindi, Hinglish; "did you mean" top 3; related questions; 👍👎 | answers in all three; did-you-mean; thumbs; related | Ask one of each; check the buttons under the answer work |
| 5 | Why it didn't work (reads the red line on the form) | reader code present | Make a form go red, ask "save kyu nahi ho raha": she quotes the red line and points to the box |
| 6 | Row reader ("92 Dark Salmon Pin" → that row) | reader code present | On a list, ask about a word from one row: she reads that row back |
| 7 | "Which page am I on" / "here"; off-topic refused; private refused | all | — |
| 8 | Walk-throughs: Show me how / Do it with me / carry on from a half-filled form; fill choices; Same as last time | buttons offered; carry-on code; every walk box exists | "karigar ko kaam kaise de" → Karke dikhaiye runs and saves nothing; Mere saath kijiye waits for each box; half-fill the form and ask "ab kya karu" |
| 9 | Stuck? offer (3 × No thanks = off) | rule present | Leave a half-filled form alone for about a minute: the small offer appears above her button |
| 10 | AI fallback with strict rules; tickets | router address; strict rules in the router | Ask something she does not know: "Asking…" then an answer marked AI, or a ticket number |
| 11 | Access rights (no walk on a screen the person can't open) | checked with a limited account | Sign in as a staff account: no walk-through offered for a screen they don't have |
| 12 | Phone layout | — | On a phone (or the pane's Mobile size): her button sits above the bottom tabs; the Ask box fits the screen |

Known before v2 (not to be "fixed" by accident — only on purpose, with Ravi):
- "परसों की हाज़िरी अब भर सकते हैं क्या, टाइम डालना है" is answered with the current time (she reads "time" as asking the time).
