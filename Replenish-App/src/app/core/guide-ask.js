/* ================= ASK MEERA, AND STEP-BY-STEP TASK GUIDES (2026-10-22) =================
 *
 * Ravi: "Ask Meera" and step-by-step task guides, and "accept the Hinglish language and it can also answer some random
 * questions or inconvenience questions that they are having regarding the site".
 *
 * ASK MEERA: a small chat box (the "Ask Meera" button, or the ? key). People type the way they talk — English, Hindi, or
 * Hinglish ("karigar ko kaam kaise de", "screen bahut slow hai", "galat entry ho gayi"). The question is cut into words,
 * each word is turned into one plain meaning (GUIDE_SYN: kaise / kese / कैसे → how), and the meanings are matched against:
 *   - GUIDE_TASKS   a whole job, start to finish, across screens ("Guide me step by step")
 *   - GUIDE_FAQ     everyday trouble with the site: slow, blank, sign-in, access, wrong entry, print, camera…
 *   - GUIDE_TALK    hello, thanks, who are you, the time, the date
 *   - GUIDE_SCREENS what a screen is for, with Open and Show me
 *   - the written guide (/guide/, 181 steps in English and Hindi), read once when the box is first opened
 * The answer comes back in the language asked in: Hindi script gets Hindi, Hinglish gets Hinglish where it is written
 * (else English), English gets English. Nothing leaves the page and nothing is saved: no question is sent anywhere.
 *
 * TASK GUIDES: a tour whose steps wait for the person to do the step on the real screen (guide.js: `wait`), and which
 * open the right screen first (`tab`). Pressing Save in a guide saves for real — the steps say so.
 */

/* ---------- the words people use, each turned into one meaning ---------- */
const GUIDE_SYN = (() => {
  const m = {}, add = (canon, words) => words.split(/\s+/).forEach(w => { if (w) m[w] = canon; });
  add('how', 'how kaise kese kaisay kaisa kaise kesy kaisi kese kis tarika tarike method process steps कैसे कैसा किस तरीका');
  add('what', 'what kya kyaa kia matlab meaning means mtlb क्या मतलब');
  add('where', 'where kahan kaha kahaan kidhar kaha kidar कहाँ कहां किधर');
  add('why', 'why kyu kyun kyon kyo क्यों क्यूँ');
  add('not', 'not no nahi nahin nhi nai ni na nhn cant cannot unable isnt doesnt dont wont didnt nahi नहीं नही ना');
  add('open', 'open opens khol kholna kholo khul khulna khulta khulti khule खोल खोलना खुल खुलता खुलती');
  add('slow', 'slow slowly dheere dheere dheema dhima dhime lag lagging hang hanging hangs atak atka atki atakta atakti stuck freeze freezing jam धीमा धीरे अटक अटका हैंग');
  add('load', 'load loading loads laod lod लोड');
  add('see', 'see show showing shows visible dikh dikhta dikhti dikhai dikha dikhe dikhna dekh dekhna dekhu दिख दिखता दिखती दिखाई देख');
  add('blank', 'blank khali empty white safed safaid kora खाली सफेद');
  add('login', 'login log signin sign logon लॉगिन लॉग साइन');
  add('password', 'password pwd passwrd pasword pin पासवर्ड पिन');
  add('forgot', 'forgot forget forgotten bhool bhul bhula bhuli yaad भूल भूला याद');
  add('order', 'order orders ordr oder ordar odr ऑर्डर आर्डर');
  add('karigar', 'karigar karigars kaarigar karighar karigr worker workers tailor darzi employee emp कारीगर दर्जी');
  add('job', 'job jobwork kaam kam work काम');
  add('issue', 'issue issued dena dene dedo de diya bhejna bhej bhejo send give giving देना दे भेज भेजना');
  add('receive', 'receive received recieve recive receiving wapas vapas waapas wapis lena lelo aaya aya aaye receipt वापस लेना आया');
  add('pack', 'pack packing paking pak packed box boxes carton dibba पैक पैकिंग डिब्बा बॉक्स');
  add('scan', 'scan scanner scanning skan scaner barcode fnsku label labels स्कैन स्कैनर बारकोड लेबल');
  add('camera', 'camera cam kamra कैमरा');
  add('print', 'print printing prnt printout प्रिंट');
  add('excel', 'excel xl xls xlsx csv sheet download downloading export dwnld डाउनलोड एक्सेल');
  add('upload', 'upload uploading import aplod अपलोड इम्पोर्ट');
  add('stock', 'stock stok inventory maal mal store godown स्टॉक माल गोदाम');
  add('shopify', 'shopify shopfy shopifi शॉपिफाई website etsy');
  add('amazon', 'amazon amzon fba अमेज़न');
  add('qc', 'qc quality check checking checked alteration alter चेक क्वालिटी');
  add('attendance', 'attendance attendence hajri haziri hazri haajri punch present हाजिरी');
  add('wrong', 'wrong mistake mistakes galat galti glt error errors गलत गलती');
  add('delete', 'delete deleted hatana hatao hata remove mitana mitao cancel हटा हटाना मिटा');
  add('correct', 'correct correction edit change badalna badal badlo sahi theek thik fix सही ठीक बदल');
  add('phone', 'phone mobile fone mobail फ़ोन फोन मोबाइल');
  add('size', 'small chhota chota tiny zoom bada big fit छोटा बड़ा ज़ूम');
  add('language', 'language bhasha hindi english angrezi भाषा हिंदी इंग्लिश');
  add('help', 'help madad sahayata guide sikhao sikha samjhao samjha batao bata bataiye मदद सिखाओ समझाओ बताओ');
  add('screen', 'screen page tab section स्क्रीन पेज');
  add('access', 'access permission allowed allow ijazat अनुमति एक्सेस');
  add('install', 'install');
  add('internet', 'internet net wifi network offline online नेट इंटरनेट');
  add('refresh', 'refresh reload reset update version नया');
  add('save', 'save saved saving sev सेव');
  add('off', 'off band bandh disable बंद');
  add('show', 'dikhao dikhana dikhaiye tour दिखाओ');
  add('time', 'time samay baje टाइम समय');
  add('date', 'date tareekh tarikh tarik today aaj तारीख आज');
  add('hello', 'hi hii hiii hello helo hlo hey namaste namaskar namskar hy salaam ram नमस्ते नमस्कार हेलो');
  add('morning', 'morning subah सुबह');
  add('thanks', 'thanks thank thx thanku tnx shukriya dhanyavad dhanyawad dhanywad धन्यवाद शुक्रिया');
  add('who', 'who kaun kon कौन');
  add('you', 'you u tum aap tu tumhara aapka आप तुम');
  add('name', 'name naam नाम');
  add('bye', 'bye goodbye alvida tata अलविदा');
  add('joke', 'joke jokes mazak mazaak chutkula चुटकुला मज़ाक');
  add('pay', 'pay payment payout salary paisa paise पैसा पेमेंट');
  add('fabric', 'fabric kapda kapra kapde cloth greige rfd कपड़ा');
  add('cut', 'cut cutting katai कटिंग');
  add('sales', 'sales sale bulk b2b');
  add('admin', 'admin boss manager contact कौन');
  add('first', 'first pehla pehli start shuru शुरू');
  add('fast', 'fast jaldi quick quickly जल्दी');
  add('find', 'find search dhoondh dhundh dhundo khoj khojna ढूँढ खोज');
  add('button', 'button btn बटन');
  add('ok', 'ok okay thik ठीक');
  add('make', 'make making create creating new naya nayi banana banao banaye banaen banau banate lagana lagao lagaye lagaen लगाना लगाएँ लगाएं लगाओ बनाना बनाएँ बनाएं बनाओ नया नई');
  add('courier', 'courier curier kuriar courior dhl fedex shiprocket delhivery कूरियर');
  add('excel', 'file files फ़ाइल फाइल');
  add('attendance', 'अटेंडेंस अटेंडन्स');
  add('slow', 'धीमी धीमे स्लो');
  add('stock', 'स्टॉक');
  add('shipment', 'shipment shipments shipping शिपमेंट');
  add('what', 'which');
  add('issue', 'दें दो दीजिए दीजिये दिया');
  add('opening', 'opening openings');
  add('count', 'kitna kitne kitni quantity qty count counting कितना कितने');
  add('make', 'record recording add adding');
  add('complete', 'complete completed complet finish finished pura poora puri poori aage badh badhna proceed continue stuck पूरा आगे');
  add('wrong', 'error errors eror err problem problems dikkat dikat pareshani दिक्कत एरर');
  add('pieces', 'piece pieces piec pcs pc peace nag nang पीस नग');
  add('can', 'can sakti sakte sakta सकती सकते');
  add('down', 'down crash crashed crashing server servers 500 503 maintenance डाउन सर्वर');
  add('make', 'dale dalna daalna dalo daalo daale enter entry entries karni एंट्री डालना डालें चढ़ाना चढ़ाएं चढ़ाएँ चढ़ाऊं chadhana chadhaye chadhau chadhaun');
  /* English letters as they are written in Hindi, and everyday Hindi for ERP words */
  add('sku', 'sku एसकेयू skus'); add('qc', 'क्यूसी'); add('fba', 'एफबीए'); add('ppc', 'ppc पीपीसी'); add('rfd', 'rfd आरएफडी');
  add('karigar', 'दर्ज़ी दर्जी darzi tailor'); add('pay', 'तनख्वाह तनखा तनख़्वाह tankhwah tankha salary वेतन');
  add('missing', 'missing gayab gaayab गायब lost');
  add('yesterday', 'yesterday kal कल parso परसों');
  add('week', 'week weekly hafta hafte haftey हफ्ता हफ्ते हफ़्ते');
  add('weather', 'weather mausam mosam barish baarish rain garmi sardi मौसम बारिश गर्मी सर्दी');
  add('last', 'last pichla pichle pichhle पिछला पिछले');
  return m;
})();
/* Words that carry no meaning of their own, in all three languages. */
const GUIDE_STOP = new Set(('a an the is are was were be to of in on at for by it this that these my me i we our your and or but so if ' +
  'hai h ha he hain ho hoga hogi tha thi the ka ki ke ko se me mein mai main mera meri mere mujhe muje mujhko hum ham ye yeh wo woh ' +
  'kar karna karu karun kare karo karte karta karti krna kr kro kiya kiye raha rahi rahe rha rhi rhe hota hoti hote hua hui gaya gayi gya gyi gaye gye ab ' +
  'do does did get want need use using kindly just aa aata aati aate rha ' +
  'please plz pls sir ji bhai yaar aur ya par pe bhi abhi kuch koi ek sab toh to sakta sakti sakte skta chahiye chahta chahti ' +
  'है हैं था थी का की के को से में मैं मुझे यह वह कर करना करें करो रहा रही हो गया गई भी और या कुछ कोई ' +
  'here am yahan yaha yahaan idhar idar यहाँ यहां इधर').split(/\s+/));
/* A question about the screen in front: "filter here", "is page pe", "yahan ka button". Its answers lean to that screen. */
const GA_HERE_RE = /\b(here|yahan|yaha|yahaan|idhar|idar|(this|is|ye|yeh|iss) (screen|page|pej)|is pe|is par|isme|is me)\b|यहाँ|यहां|इधर|इस (स्क्रीन|पेज)|इसमें/i;
/* "Which page am I on?" — answered with the screen's name, never with a guess from the bank. */
const GA_WHEREAMI_RE = /\b(which|what|kaun ?s[ia]|kaunsi|konsi|kis)\s+(page|screen|pej)\b.*\b(am i|i am|i'?m|hoon|hu|hun|hai|h|on)\b|\b(page|screen)\s+(i am|i'?m|im)\s+on\b|\bwhere am i\b|\b(main|mai|me)\s+(kahan|kaha|kidhar)\s+(hoon|hu|hun)\b|मैं कहाँ हूँ|कौन सी (स्क्रीन|पेज)|किस (स्क्रीन|पेज) पर/i;
/* Hinglish is told from English by these: a question with one of them in Latin letters is answered in Hinglish. */
const GUIDE_HG = new Set('kaise kese kya kyu kyun nahi nahin nhi hai ho karna kar ko ka ki ke mein me kahan kaha raha rahi de dena wapas vapas bata batao mujhe kaun kon aap tum ji bhai yaar galat galti theek thik dikh dikhta khul khulta band karu kare hota hua gaya gayi dhanyavad dhanyawad shukriya banaye banana lagana sakti hoon hu hun kis par pe kahan kaha kaunsi konsi kaise kese'.split(' '));

/* ---------- everyday trouble with the site ---------- */
const GUIDE_FAQ = [
  { id: 'slow', need: ['slow'], k: ['slow', 'load', 'screen', 'open', 'fast'],
    en: 'Sorry about that. Try these, in order:<ul><li>The first open of a screen reads its data — give it 10–15 seconds.</li><li>Check the internet (open any other website).</li><li>If a bar at the top says a <b>new version</b> is out, press its reload button.</li><li>Close extra browser tabs, then press <b>Ctrl + F5</b> (on a phone, close the app and open it again).</li></ul>Still slow? Tell your admin the screen name and the time it happened.',
    hi: 'असुविधा के लिए माफ़ी। ये क्रम से करें:<ul><li>स्क्रीन पहली बार खुलने पर डेटा पढ़ती है — 10–15 सेकंड रुकें।</li><li>इंटरनेट चेक करें (कोई और वेबसाइट खोलकर देखें)।</li><li>ऊपर <b>नया वर्शन</b> वाली पट्टी दिखे तो उसका reload बटन दबाएँ।</li><li>फालतू टैब बंद करें, फिर <b>Ctrl + F5</b> दबाएँ (फ़ोन पर ऐप बंद करके दोबारा खोलें)।</li></ul>फिर भी धीमा है? एडमिन को स्क्रीन का नाम और समय बताएँ।',
    hg: 'Sorry, ye try karein, ek ek karke:<ul><li>Screen pehli baar khulne par data padhti hai — 10–15 second rukiye.</li><li>Internet check kijiye (koi aur website khol ke dekhiye).</li><li>Upar <b>new version</b> wali patti dikhe to uska reload button dabaiye.</li><li>Faltu tabs band kijiye, phir <b>Ctrl + F5</b> dabaiye (phone par app band karke dobara kholiye).</li></ul>Phir bhi slow hai? Admin ko screen ka naam aur time bataiye.' },
  { id: 'blank', need: ['blank', 'not'], all: [], k: ['blank', 'see', 'not', 'load', 'screen', 'order', 'stock', 'data'],
    en: 'If a screen is empty or your data is not showing:<ul><li>Look at the filters and dates at the top — a filter left on hides rows. Press <b>Clear</b> / <b>Clear filters</b>.</li><li>Press the screen\'s <b>Refresh</b> or <b>Fetch</b> button.</li><li>Read the message line: a red line says what went wrong (often no internet, or no access).</li><li>Still blank: press <b>Ctrl + F5</b>, or close and reopen the app.</li></ul>',
    hi: 'स्क्रीन खाली है या डेटा नहीं दिख रहा:<ul><li>ऊपर फ़िल्टर और तारीख देखें — लगा हुआ फ़िल्टर लाइनें छुपा देता है। <b>Clear</b> / <b>Clear filters</b> दबाएँ।</li><li>स्क्रीन का <b>Refresh</b> या <b>Fetch</b> बटन दबाएँ।</li><li>मैसेज लाइन पढ़ें: लाल लाइन बताती है क्या गलत हुआ (अक्सर इंटरनेट या अनुमति)।</li><li>फिर भी खाली: <b>Ctrl + F5</b> दबाएँ, या ऐप बंद करके खोलें।</li></ul>',
    hg: 'Screen khali hai ya data nahi dikh raha:<ul><li>Upar filters aur dates dekhiye — laga hua filter rows chhupa deta hai. <b>Clear</b> / <b>Clear filters</b> dabaiye.</li><li>Screen ka <b>Refresh</b> ya <b>Fetch</b> button dabaiye.</li><li>Message line padhiye: laal line batati hai kya galat hua (aksar internet ya access).</li><li>Phir bhi khali: <b>Ctrl + F5</b> dabaiye, ya app band karke kholiye.</li></ul>' },
  { id: 'forgot', need: ['forgot'], k: ['forgot', 'password', 'login'],
    en: 'On the sign-in page press <b>Forgot password?</b> under the password box — a reset link goes to your email. If you sign in with <b>cellphone and PIN</b> and forgot the PIN, ask your admin to set a new one.',
    hi: 'साइन-इन पेज पर पासवर्ड बॉक्स के नीचे <b>Forgot password?</b> दबाएँ — आपके ईमेल पर नया पासवर्ड बनाने का लिंक आएगा। अगर आप <b>मोबाइल और PIN</b> से लॉगिन करते हैं और PIN भूल गए, तो एडमिन से नया PIN लगवाएँ।',
    hg: 'Sign-in page par password box ke neeche <b>Forgot password?</b> dabaiye — email par reset link aayega. Agar aap <b>mobile aur PIN</b> se login karte hain aur PIN bhool gaye, to admin se naya PIN lagwaiye.' },
  { id: 'login', need: ['login', 'password'], k: ['login', 'password', 'not', 'open'],
    en: 'Two ways to sign in: <b>email and password</b>, or <b>Sign in with cellphone and PIN</b> (the link under the form). Check caps lock and spaces. If it says your email is not confirmed, use <b>Send me the link</b> and open the email. Still stuck? Your admin can check your account.',
    hi: 'लॉगिन के दो तरीके: <b>ईमेल और पासवर्ड</b>, या <b>Sign in with cellphone and PIN</b> (फ़ॉर्म के नीचे लिंक)। Caps lock और स्पेस चेक करें। अगर लिखा आए कि ईमेल कन्फ़र्म नहीं है, तो <b>Send me the link</b> दबाकर ईमेल खोलें। फिर भी दिक्कत? एडमिन आपका अकाउंट चेक कर सकते हैं।',
    hg: 'Login ke do tarike: <b>email aur password</b>, ya <b>Sign in with cellphone and PIN</b> (form ke neeche link). Caps lock aur space check kijiye. Agar likha aaye email confirm nahi hai, to <b>Send me the link</b> dabaiye aur email kholiye. Phir bhi dikkat? Admin aapka account check kar sakte hain.' },
  { id: 'access', need: ['access', 'screen'], k: ['access', 'screen', 'see', 'not', 'open', 'button', 'where'],
    en: 'You only see the screens and buttons your admin has given you. If a screen is missing from your menu, or a button says you cannot, ask your admin to add it to your account — I can\'t change access.',
    hi: 'आपको वही स्क्रीन और बटन दिखते हैं जो एडमिन ने आपको दिए हैं। मेनू में कोई स्क्रीन नहीं है, या बटन मना करता है, तो एडमिन से अपने अकाउंट में जुड़वाएँ — अनुमति मैं नहीं बदल सकती।',
    hg: 'Aapko wahi screens aur buttons dikhte hain jo admin ne aapko diye hain. Menu me koi screen nahi hai, ya button mana karta hai, to admin se apne account me add karwaiye — access main nahi badal sakti.' },
  { id: 'wrong', need: ['wrong', 'correct', 'delete'], k: ['wrong', 'correct', 'delete', 'job', 'stock', 'order', 'save'],
    en: 'Made a wrong entry? Don\'t enter it again to cancel it out. On the row press <b>Correction</b> (on Finished Goods: <b>Request correction</b>), or <b>Ask to delete</b> — an admin checks and approves it, and the register is put right. SKU and date changes are approved by an admin only.',
    hi: 'गलत एंट्री हो गई? उसे काटने के लिए दोबारा एंट्री न करें। लाइन पर <b>Correction</b> दबाएँ (Finished Goods में <b>Request correction</b>), या <b>Ask to delete</b> — एडमिन देखकर मंज़ूर करेंगे और रजिस्टर ठीक हो जाएगा। SKU और तारीख सिर्फ़ एडमिन बदल सकते हैं।',
    hg: 'Galat entry ho gayi? Usko cancel karne ke liye dobara entry mat kijiye. Row par <b>Correction</b> dabaiye (Finished Goods me <b>Request correction</b>), ya <b>Ask to delete</b> — admin check karke approve karenge aur register theek ho jayega. SKU aur date sirf admin badal sakte hain.',
    task: 'correction' },
  { id: 'print', need: ['print'], k: ['print', 'not', 'open'],
    en: 'Printing opens a new window. If nothing opens, the browser blocked it: click the small icon at the right of the address bar and choose <b>Always allow pop-ups</b>, then press Print again. In the print window, pick the right printer and paper size.',
    hi: 'प्रिंट एक नई विंडो में खुलता है। कुछ न खुले तो ब्राउज़र ने रोका है: एड्रेस बार के दाईं ओर छोटे आइकन पर क्लिक करके <b>Always allow pop-ups</b> चुनें, फिर दोबारा Print दबाएँ। प्रिंट विंडो में सही प्रिंटर और पेपर साइज़ चुनें।',
    hg: 'Print nayi window me khulta hai. Kuch na khule to browser ne roka hai: address bar ke right me chhote icon par click karke <b>Always allow pop-ups</b> chuniye, phir Print dobara dabaiye. Print window me sahi printer aur paper size chuniye.' },
  { id: 'excel', need: ['excel', 'upload'], k: ['excel', 'upload', 'not', 'open', 'where'],
    en: 'Downloaded files go to your <b>Downloads</b> folder (press Ctrl + J to see them). If the browser asks to allow several downloads, press Allow. To upload, always start from the screen\'s own <b>template</b> and don\'t rename its column headings.',
    hi: 'डाउनलोड हुई फ़ाइल <b>Downloads</b> फ़ोल्डर में जाती है (देखने के लिए Ctrl + J)। ब्राउज़र कई डाउनलोड की अनुमति माँगे तो Allow दबाएँ। अपलोड के लिए हमेशा स्क्रीन का अपना <b>template</b> लें और कॉलम के नाम न बदलें।',
    hg: 'Download hui file <b>Downloads</b> folder me jaati hai (dekhne ke liye Ctrl + J). Browser kai downloads ki permission maange to Allow dabaiye. Upload ke liye hamesha screen ka apna <b>template</b> lo aur column ke naam mat badlo.' },
  { id: 'camera', need: ['camera', 'scan'], k: ['camera', 'scan', 'not', 'open', 'slow'],
    en: 'For scanning:<ul><li>Allow the camera when the browser asks (or in the site settings by the address bar).</li><li>Good light; hold the label flat, in the middle of the box, a hand\'s width away.</li><li>A hand scanner works too, and you can type the code into the box.</li><li>A label that is not on this list is stopped on purpose — put that piece aside.</li></ul>',
    hi: 'स्कैन के लिए:<ul><li>ब्राउज़र पूछे तो कैमरा Allow करें (या एड्रेस बार के पास साइट सेटिंग में)।</li><li>अच्छी रोशनी; लेबल सीधा, बॉक्स के बीच में, एक हथेली की दूरी पर रखें।</li><li>हैंड स्कैनर भी चलता है, और कोड बॉक्स में टाइप भी कर सकते हैं।</li><li>जो लेबल इस लिस्ट का नहीं है वो जानबूझकर रुकता है — वो पीस अलग रखें।</li></ul>',
    hg: 'Scan ke liye:<ul><li>Browser pooche to camera Allow kijiye (ya address bar ke paas site settings me).</li><li>Achhi roshni; label seedha, box ke beech me, ek haath ki doori par rakhiye.</li><li>Hand scanner bhi chalta hai, aur code box me type bhi kar sakte hain.</li><li>Jo label is list ka nahi hai wo jaanbujh kar rukta hai — wo piece alag rakhiye.</li></ul>' },
  { id: 'phone', need: ['phone', 'size'], k: ['phone', 'size', 'see', 'screen'],
    en: 'On a phone, lists show as cards. Press <b>Table view</b> to see the full table and pinch with two fingers to zoom. For the computer layout, open <b>More</b> at the bottom and choose <b>Desktop view</b>.',
    hi: 'फ़ोन पर लिस्ट कार्ड में दिखती है। पूरी टेबल के लिए <b>Table view</b> दबाएँ और दो उँगलियों से ज़ूम करें। कंप्यूटर वाला लेआउट चाहिए तो नीचे <b>More</b> खोलकर <b>Desktop view</b> चुनें।',
    hg: 'Phone par list cards me dikhti hai. Poori table ke liye <b>Table view</b> dabaiye aur do ungliyon se zoom kijiye. Computer wala layout chahiye to neeche <b>More</b> khol ke <b>Desktop view</b> chuniye.' },
  { id: 'internet', need: ['internet'], k: ['internet', 'not', 'save', 'slow'],
    en: 'The ERP needs the internet to save. If it drops, wait for it to come back before you press Save again, and check the message line says it saved. Don\'t close the page in the middle of a save.',
    hi: 'सेव करने के लिए ERP को इंटरनेट चाहिए। इंटरनेट जाए तो वापस आने तक रुकें, फिर Save दबाएँ, और मैसेज लाइन में देखें कि सेव हुआ। सेव होते समय पेज बंद न करें।',
    hg: 'Save karne ke liye ERP ko internet chahiye. Net chala jaaye to wapas aane tak rukiye, phir Save dabaiye, aur message line me dekhiye ki save hua. Save ke beech me page band mat kijiye.' },
  { id: 'save', need: ['save'], k: ['save', 'not', 'button', 'wrong'],
    en: 'If Save does nothing, read the message line next to it — a red line names the box that is missing or wrong. Fix that box and press Save once. Pressing it many times can save the same entry twice.',
    hi: 'Save दबाने पर कुछ न हो, तो पास की मैसेज लाइन पढ़ें — लाल लाइन बताती है कौन सा बॉक्स छूटा या गलत है। वो ठीक करके Save एक बार दबाएँ। बार-बार दबाने से एक ही एंट्री दो बार सेव हो सकती है।',
    hg: 'Save dabane par kuch na ho, to paas ki message line padhiye — laal line batati hai kaunsa box chhuta ya galat hai. Use theek karke Save ek baar dabaiye. Baar baar dabane se ek hi entry do baar save ho sakti hai.' },
  { id: 'down', need: ['down'], k: ['down', 'wrong', 'not', 'open', 'load'],
    en: 'If the site shows an error or will not open:<ul><li>Check the internet first.</li><li>Press <b>Ctrl + F5</b> (on a phone, close the app and open it again).</li><li>Wait two minutes and try again — an update may be going out.</li><li>If it is still down, or everyone sees it, tell your admin with the time and the message.</li></ul>Nothing you entered and saved is lost.',
    hi: 'साइट एरर दिखाए या न खुले:<ul><li>पहले इंटरनेट चेक करें।</li><li><b>Ctrl + F5</b> दबाएँ (फ़ोन पर ऐप बंद करके दोबारा खोलें)।</li><li>दो मिनट रुककर फिर कोशिश करें — शायद अपडेट चल रहा है।</li><li>फिर भी बंद है, या सबको दिख रहा है, तो समय और मैसेज के साथ एडमिन को बताएँ।</li></ul>जो आपने सेव किया था, वो नहीं जाता।',
    hg: 'Site error dikhaye ya na khule:<ul><li>Pehle internet check kijiye.</li><li><b>Ctrl + F5</b> dabaiye (phone par app band karke dobara kholiye).</li><li>Do minute ruk ke phir try kijiye — shayad update chal raha hai.</li><li>Phir bhi band hai, ya sabko dikh raha hai, to time aur message ke saath admin ko bataiye.</li></ul>Jo aapne save kiya tha, wo nahi jaata.' },
  { id: 'jobreceive', need: ['receive'], all: [], k: ['receive', 'karigar', 'job', 'stock', 'make'], also: ['karigar', 'job'],
    en: 'Open <b>Job Work Register</b>, find the karigar\'s line with the search box, press <b>Receive</b> on it and fill in what came back (received and rejected).',
    hi: '<b>जॉब वर्क रजिस्टर</b> खोलें, सर्च बॉक्स से कारीगर की लाइन ढूँढें, उस पर <b>Receive</b> दबाएँ और जो वापस आया (आया और रिजेक्ट) भरें।',
    hg: '<b>Job Work Register</b> kholiye, search box se karigar ki line dhoondhiye, us par <b>Receive</b> dabaiye aur jo wapas aaya (received aur rejected) bhariye.' },
  { id: 'stockcheck', need: ['stock'], all: [], also: ['count', 'see', 'where', 'find'], avoid: ['not', 'scan', 'karigar', 'job'], k: ['stock', 'count', 'see', 'where', 'find'],
    en: 'To see how much is in stock: open <b>Finished Goods</b>, keep the view on <b>India Store</b>, and type the SKU, colour or size in the search box. For Amazon FBA stock, see <b>Replenishment</b>; for Shopify, <b>Shopify Stock</b>.',
    hi: 'स्टॉक कितना है देखने के लिए: <b>Finished Goods</b> खोलें, व्यू <b>India Store</b> पर रखें, और सर्च में SKU, रंग या साइज़ लिखें। Amazon FBA का स्टॉक <b>Replenishment</b> में, Shopify का <b>Shopify Stock</b> में।',
    hg: 'Stock kitna hai dekhne ke liye: <b>Finished Goods</b> kholiye, view <b>India Store</b> par rakhiye, aur search me SKU, colour ya size likhiye. Amazon FBA ka stock <b>Replenishment</b> me, Shopify ka <b>Shopify Stock</b> me.' },
  { id: 'markdone', need: ['complete'], all: ['order'], avoid: ['not', 'why'], k: ['complete', 'order', 'mark', 'how', 'job'],
    en: 'Open <b>Order Console</b>, tick the finished lines (or whole orders), then press <b>Completed</b> — they go to shipping.',
    hi: '<b>Order Console</b> खोलें, तैयार लाइनें (या पूरे ऑर्डर) टिक करें, फिर <b>Completed</b> दबाएँ — वो शिपिंग को चली जाती हैं।',
    hg: '<b>Order Console</b> kholiye, taiyar lines (ya poore orders) tick kijiye, phir <b>Completed</b> dabaiye — wo shipping ko chali jaati hain.' },
  { id: 'refresh', need: ['refresh'], k: ['refresh', 'screen', 'old'],
    en: 'When the ERP is updated, a bar appears at the top saying a new version is out — press its reload button. Or press <b>Ctrl + F5</b> any time to load the latest version.',
    hi: 'ERP अपडेट होने पर ऊपर एक पट्टी आती है कि नया वर्शन आया है — उसका reload बटन दबाएँ। या कभी भी <b>Ctrl + F5</b> दबाकर नया वर्शन लोड करें।',
    hg: 'ERP update hone par upar ek patti aati hai ki naya version aaya hai — uska reload button dabaiye. Ya kabhi bhi <b>Ctrl + F5</b> dabakar naya version load kijiye.' },
  { id: 'language', need: ['language'], k: ['language', 'help', 'what', 'can'],
    en: 'Switch my language with <b>EN · हिं</b> in my bubble. You can ask me in English, Hindi or Hinglish. The full written guide (<b>Guide · गाइड</b> in the menu) has every step in both languages.',
    hi: 'मेरी भाषा मेरे बबल में <b>EN · हिं</b> से बदलें। आप मुझसे इंग्लिश, हिंदी या हिंग्लिश में पूछ सकते हैं। पूरी लिखी गाइड (मेनू में <b>Guide · गाइड</b>) में हर स्टेप दोनों भाषाओं में है।',
    hg: 'Meri language mere bubble me <b>EN · हिं</b> se badlo. Aap mujhse English, Hindi ya Hinglish me pooch sakte ho. Poori likhi guide (menu me <b>Guide · गाइड</b>) me har step dono languages me hai.' },
  { id: 'off', need: ['off'], k: ['off', 'help', 'you', 'show'],
    en: 'Use the <b>Helper On/Off</b> switch at the top. Off means no tours on first visits and no help after repeated mistakes. You can still ask me here, and <b>Show me</b> still works.',
    hi: 'ऊपर <b>Helper On/Off</b> स्विच इस्तेमाल करें। Off करने पर पहली बार वाले टूर और बार-बार गलती पर मदद बंद हो जाती है। यहाँ मुझसे पूछ सकते हैं, और <b>Show me</b> चलता रहेगा।',
    hg: 'Upar <b>Helper On/Off</b> switch use kijiye. Off karne par pehli baar wale tours aur baar baar galti par help band ho jaati hai. Yahan mujhse pooch sakte hain, aur <b>Show me</b> chalta rahega.' },
  { id: 'install', need: ['install'], k: ['install', 'phone', 'app'],
    en: 'To put the ERP on your phone\'s home screen, open <b>More</b> at the bottom and press <b>Install app</b> (on an iPhone it shows you the Share → Add to Home Screen steps).',
    hi: 'ERP को फ़ोन की होम स्क्रीन पर रखने के लिए नीचे <b>More</b> खोलें और <b>Install app</b> दबाएँ (iPhone पर Share → Add to Home Screen के स्टेप दिखते हैं)।',
    hg: 'ERP ko phone ki home screen par rakhne ke liye neeche <b>More</b> kholiye aur <b>Install app</b> dabaiye (iPhone par Share → Add to Home Screen ke steps dikhte hain).' },
  { id: 'admin', need: ['admin'], k: ['admin', 'help', 'who'],
    en: 'For access, new screens, approvals or anything I can\'t fix, ask your admin or supervisor. Tell them the screen name, what you pressed, and what the red message said.',
    hi: 'अनुमति, नई स्क्रीन, मंज़ूरी या जो मैं ठीक न कर सकूँ — उसके लिए अपने एडमिन या सुपरवाइज़र से पूछें। उन्हें स्क्रीन का नाम, आपने क्या दबाया, और लाल मैसेज में क्या लिखा था, बताएँ।',
    hg: 'Access, nayi screen, approval ya jo main theek na kar sakun — uske liye apne admin ya supervisor se poochiye. Unko screen ka naam, aapne kya dabaya, aur laal message me kya likha tha, bataiye.' }
];

/* ---------- small talk ---------- */
const GUIDE_TALK = [
  { id: 'hello', need: ['hello', 'morning'], k: ['hello', 'morning'],
    en: 'Hello! 👋 I\'m Meera. Ask me how to do anything in the ERP, or tell me what\'s not working.',
    hi: 'नमस्ते! 👋 मैं मीरा हूँ। ERP में कुछ भी कैसे करना है पूछें, या बताएँ क्या नहीं चल रहा।',
    hg: 'Namaste! 👋 Main Meera hoon. ERP me kuch bhi kaise karna hai poochiye, ya bataiye kya nahi chal raha.' },
  { id: 'thanks', need: ['thanks'], k: ['thanks', 'ok'],
    en: 'You\'re welcome! Ask me any time — the <b>Ask Meera</b> button, or press <b>?</b>.',
    hi: 'आपका स्वागत है! कभी भी पूछें — <b>Ask Meera</b> बटन, या <b>?</b> दबाएँ।',
    hg: 'Koi baat nahi! Kabhi bhi poochiye — <b>Ask Meera</b> button, ya <b>?</b> dabaiye.' },
  { id: 'who', need: ['who', 'name'], k: ['who', 'you', 'name'],
    en: 'I\'m <b>Meera</b>, the R-one ERP assistant. I show you round each screen, guide you through jobs step by step, and help when something goes wrong.',
    hi: 'मैं <b>मीरा</b> हूँ, R-one ERP की असिस्टेंट। मैं हर स्क्रीन समझाती हूँ, हर काम स्टेप-बाय-स्टेप करवाती हूँ, और कुछ गलत हो तो मदद करती हूँ।',
    hg: 'Main <b>Meera</b> hoon, R-one ERP ki assistant. Main har screen samjhati hoon, har kaam step by step karwati hoon, aur kuch galat ho to help karti hoon.' },
  { id: 'how-you', need: ['you'], all: ['how', 'you'], k: ['how', 'you'],
    en: 'I\'m good, thank you! Ready to help. What are you working on?',
    hi: 'मैं ठीक हूँ, धन्यवाद! मदद के लिए तैयार। आप किस काम पर हैं?',
    hg: 'Main theek hoon, thank you! Help ke liye ready. Aap kis kaam par ho?' },
  { id: 'can', need: ['help', 'can'], all: ['you'], k: ['help', 'what', 'you', 'can'],
    en: 'I can:<ul><li>explain any screen — try "what is Finished Goods"</li><li>guide you through a job — try "karigar ko kaam kaise de"</li><li>help when the site gives trouble — try "screen slow hai"</li></ul>',
    hi: 'मैं ये कर सकती हूँ:<ul><li>कोई भी स्क्रीन समझाना — पूछें "Finished Goods क्या है"</li><li>कोई काम स्टेप-बाय-स्टेप करवाना — पूछें "कारीगर को काम कैसे दें"</li><li>साइट में दिक्कत हो तो मदद — पूछें "स्क्रीन धीमी है"</li></ul>',
    hg: 'Main ye kar sakti hoon:<ul><li>koi bhi screen samjhana — poochiye "Finished Goods kya hai"</li><li>koi kaam step by step karwana — poochiye "karigar ko kaam kaise de"</li><li>site me dikkat ho to help — poochiye "screen slow hai"</li></ul>' },
  { id: 'weather', need: ['weather'], k: ['weather'],
    en: 'I cannot see the weather — I only know this ERP. Ask me about any screen or job.',
    hi: 'मौसम मैं नहीं देख सकती — मुझे सिर्फ़ यह ERP आता है। किसी भी स्क्रीन या काम के बारे में पूछें।',
    hg: 'Mausam main nahi dekh sakti — mujhe sirf ye ERP aata hai. Kisi bhi screen ya kaam ke baare me poochiye.' },
  { id: 'time', need: ['time'], k: ['time', 'what'], fn: 'time' },
  { id: 'date', need: ['date'], k: ['date', 'what'], fn: 'date' },
  { id: 'joke', need: ['joke'], k: ['joke'],
    en: 'Why did the tablecloth never get lost? Because it always had its SKU on it. 😄 Now — what can I help you with?',
    hi: 'मेज़पोश कभी खोता क्यों नहीं? क्योंकि उस पर हमेशा उसका SKU लगा रहता है। 😄 अब बताइए — क्या मदद करूँ?',
    hg: 'Tablecloth kabhi khota kyun nahi? Kyunki us par hamesha uska SKU laga rehta hai. 😄 Ab bataiye — kya help karun?' },
  { id: 'bye', need: ['bye'], k: ['bye'],
    en: 'Bye! I\'m here whenever you need me.', hi: 'अलविदा! जब ज़रूरत हो, मैं यहीं हूँ।', hg: 'Bye! Jab zaroorat ho, main yahin hoon.' }
];

/* ---------- the screens, by the names people call them ---------- */
const GUIDE_SCREENS = [
  ['shop', 'shopify order orders website etsy shipping'], ['ord', 'order console orders production line'], ['pack', 'packing list pack box amazon shipment scan'],
  ['fgi', 'finished goods stock store maal ready'], ['pbase', 'job work register karigar issue receive'], ['flow', 'production flow ppc po stage'],
  ['qc', 'quality control qc check alteration'], ['fba', 'fba dispatch amazon'], ['pmdb', 'master database sku master'], ['att', 'attendance hajri punch'],
  ['rep', 'reports report'], ['so', 'sales orders sales bulk b2b'], ['cx', 'customer orders customer'], ['top', 'top asin bestseller'],
  ['fab', 'fabric inventory fabric greige rfd kapda'], ['repl', 'replenishment reorder forecast'], ['dash', 'dashboard home summary'],
  ['pcut', 'cutting data cutting'], ['hr', 'finance hr salary payout'], ['vord', 'vendor orders vendor printer'], ['acc', 'accessories']
];

/* ---------- jobs, start to finish ---------- */
const GUIDE_TASKS = [
  { id: 'jobwork', k: ['issue', 'job', 'karigar', 'order', 'make', 'pieces'], need: ['karigar', 'job'], all: ['issue'], avoid: ['receive'],
    title: { en: 'Give job work to a karigar', hi: 'कारीगर को काम देना', hg: 'Karigar ko kaam dena' },
    steps: [
      { tab: 'pbase', en: 'Let\'s give work to a karigar. I\'ll light up each box — you fill it in, and I move on when it\'s done.', hi: 'चलिए कारीगर को काम देते हैं। मैं हर बॉक्स दिखाऊँगी — आप भरें, भरते ही मैं आगे बढ़ूँगी।' },
      { tab: 'pbase', sel: '#bwToggle', wait: 'click', skip: '#bwBox', en: 'Press <b>+ New Job Work</b> to open the form.', hi: 'फ़ॉर्म खोलने के लिए <b>+ New Job Work</b> दबाएँ।' },
      { tab: 'pbase', sel: '#bwOrd', wait: 'value', en: 'Pick the <b>Order ID</b> these pieces are for.', hi: 'जिस ऑर्डर के ये पीस हैं, वो <b>Order ID</b> चुनें।' },
      { tab: 'pbase', sel: '#bwType', wait: 'value', en: 'Choose the <b>worker type</b>.', hi: 'कारीगर का <b>टाइप</b> चुनें।' },
      { tab: 'pbase', sel: '#bwEmp', wait: 'value', en: 'Type or pick the <b>karigar\'s name</b> from the list.', hi: 'लिस्ट से <b>कारीगर का नाम</b> लिखें या चुनें।' },
      { tab: 'pbase', sel: '#bwAt', wait: 'value', en: 'Choose the <b>article</b> — or type the SKU in the SKU box.', hi: '<b>आर्टिकल</b> चुनें — या SKU बॉक्स में SKU लिखें।' },
      { tab: 'pbase', sel: '#bwSub', wait: 'value', en: 'Choose the <b>subtype</b>. If this article has none, press Skip.', hi: '<b>सबटाइप</b> चुनें। इस आर्टिकल का न हो तो Skip दबाएँ।' },
      { tab: 'pbase', sel: '#bwCol', wait: 'value', en: 'Choose the <b>colour</b>.', hi: '<b>रंग</b> चुनें।' },
      { tab: 'pbase', sel: '#bwSz', wait: 'value', en: 'Choose the <b>size</b>. The SKU box then fills itself.', hi: '<b>साइज़</b> चुनें। फिर SKU बॉक्स अपने आप भर जाता है।' },
      { tab: 'pbase', sel: '#bwPcs', wait: 'value', en: 'How many <b>pieces</b> are you giving?', hi: 'कितने <b>पीस</b> दे रहे हैं?' },
      { tab: 'pbase', sel: '#bwDate', en: 'Today\'s date is filled in. Change it only if the work went out on another day.', hi: 'आज की तारीख भरी है। काम किसी और दिन दिया हो तभी बदलें।' },
      { tab: 'pbase', sel: '#bwSave', wait: 'click', save: true, en: 'Check it all, then press <b>Issue</b>. This saves it for real.', hi: 'सब चेक करें, फिर <b>Issue</b> दबाएँ। यह असली में सेव होता है।' },
      { tab: 'pbase', sel: '#bwMsg', en: 'If this line is red, it says what to fix — fix it and press Issue again. Otherwise it\'s done: the entry is in the register below. 🎉', hi: 'यह लाइन लाल हो तो उसमें लिखा है क्या ठीक करना है — ठीक करके फिर Issue दबाएँ। वरना हो गया: एंट्री नीचे रजिस्टर में है। 🎉' }
    ] },
  { id: 'qccheck', k: ['qc', 'check', 'alteration'], need: ['qc'],
    title: { en: 'Record a QC check', hi: 'QC चेक दर्ज करना', hg: 'QC check record karna' },
    steps: [
      { tab: 'qc', en: 'Let\'s record a quality check. I\'ll light up each box in turn.', hi: 'चलिए क्वालिटी चेक दर्ज करते हैं। मैं एक-एक बॉक्स दिखाऊँगी।' },
      { tab: 'qc', sel: '#qcwToggle', wait: 'click', skip: '#qcwBox', en: 'Press <b>+ Record a check</b>.', hi: '<b>+ Record a check</b> दबाएँ।' },
      { tab: 'qc', sel: '#qcwAt', wait: 'value', en: 'Choose the <b>article</b>, then its subtype, colour and size.', hi: '<b>आर्टिकल</b> चुनें, फिर सबटाइप, रंग और साइज़।' },
      { tab: 'qc', sel: '#qcwSz', wait: 'value', en: 'Choose the <b>size</b>.', hi: '<b>साइज़</b> चुनें।' },
      { tab: 'qc', sel: '#qcwBy', wait: 'value', en: 'Who <b>checked</b> the pieces?', hi: 'पीस किसने <b>चेक</b> किए?' },
      { tab: 'qc', sel: '#qcwChecked', wait: 'value', en: 'How many pieces were <b>checked</b>?', hi: 'कितने पीस <b>चेक</b> हुए?' },
      { tab: 'qc', sel: '#qcwAlt', en: 'How many need <b>alteration</b>? Leave empty if none.', hi: 'कितने पीस <b>ऑल्टरेशन</b> में जाएँगे? कोई नहीं तो खाली छोड़ें।' },
      { tab: 'qc', sel: '#qcwRej', en: 'How many are <b>rejected</b>? Leave empty if none.', hi: 'कितने <b>रिजेक्ट</b> हुए? कोई नहीं तो खाली छोड़ें।' },
      { tab: 'qc', sel: '#qcwSave', wait: 'click', save: true, en: 'Press <b>Save check</b>. This saves it for real.', hi: '<b>Save check</b> दबाएँ। यह असली में सेव होता है।' },
      { tab: 'qc', sel: '#qcwMsg', en: 'A red line here says what to fix. Otherwise — done! 🎉', hi: 'यहाँ लाल लाइन बताएगी क्या ठीक करना है। वरना — हो गया! 🎉' }
    ] },
  { id: 'scanpack', k: ['pack', 'scan', 'amazon', 'box', 'shipment'], need: ['pack'],
    title: { en: 'Pack a shipment with Scan to pack', hi: 'Scan to pack से शिपमेंट पैक करना', hg: 'Scan to pack se shipment pack karna' },
    steps: [
      { tab: 'pack', en: 'Let\'s pack with the scanner. Every piece you scan goes into the open box, with its picture.', hi: 'चलिए स्कैनर से पैक करते हैं। हर स्कैन किया पीस खुले बॉक्स में जाता है, फ़ोटो के साथ।' },
      { tab: 'pack', sel: '#pkScanBtn', wait: 'click', en: 'Press <b>Scan to pack</b>, then choose how you are packing.', hi: '<b>Scan to pack</b> दबाएँ, फिर चुनें कैसे पैक कर रहे हैं।' },
      { en: 'Now scan each piece\'s label. A wrong article is stopped — put it aside. When a box is full press <b>Box done</b>, and <b>Done</b> at the end. Ask me if anything goes wrong!', hi: 'अब हर पीस का लेबल स्कैन करें। गलत आर्टिकल रुक जाएगा — उसे अलग रखें। बॉक्स भरने पर <b>Box done</b>, और आखिर में <b>Done</b> दबाएँ। कुछ गड़बड़ हो तो मुझसे पूछें!' }
    ] },
  { id: 'courier', k: ['shopify', 'excel', 'order', 'courier', 'make'], need: ['courier', 'shopify', 'excel'],
    title: { en: 'Make the courier file for Shopify orders', hi: 'Shopify ऑर्डर की कूरियर फ़ाइल बनाना', hg: 'Shopify orders ki courier file banana' },
    steps: [
      { tab: 'shop', en: 'Let\'s make the courier upload file. First get the right orders on screen.', hi: 'चलिए कूरियर फ़ाइल बनाते हैं। पहले सही ऑर्डर स्क्रीन पर लाएँ।' },
      { tab: 'shop', sel: '#soFrom', en: 'Check the <b>dates</b> — they decide which orders are loaded.', hi: '<b>तारीखें</b> चेक करें — इनसे तय होता है कौन से ऑर्डर आएँगे।' },
      { tab: 'shop', sel: '#soLanes', en: 'Click the stage you want (e.g. ready to ship), and tick the orders in the first column. Nothing ticked = everything on screen.', hi: 'जो स्टेज चाहिए उस पर क्लिक करें, और पहले कॉलम में ऑर्डर टिक करें। कुछ टिक नहीं = स्क्रीन के सारे।' },
      { tab: 'shop', sel: '#soMoreMenu > summary || #soMoreMenu', wait: 'click', skip: '#soTmpl', en: 'Open <b>More</b>.', hi: '<b>More</b> खोलें।' },
      { tab: 'shop', sel: '#soTmpl', wait: 'value', en: 'Pick the <b>courier template</b> (MCF, DHL, FedEx…).', hi: '<b>कूरियर टेम्पलेट</b> चुनें (MCF, DHL, FedEx…)।' },
      { tab: 'shop', sel: '#soExport', wait: 'click', en: 'Press <b>Export</b>. The file goes to your Downloads folder.', hi: '<b>Export</b> दबाएँ। फ़ाइल Downloads फ़ोल्डर में जाएगी।' }
    ] },
  { id: 'findorder', k: ['find', 'order', 'shopify', 'where'], need: ['find', 'where'],
    title: { en: 'Find a Shopify order', hi: 'Shopify ऑर्डर ढूँढना', hg: 'Shopify order dhoondhna' },
    steps: [
      { tab: 'shop', sel: '#soFilter', wait: 'value', en: 'Type the <b>order number</b>, a SKU or the customer\'s name here.', hi: 'यहाँ <b>ऑर्डर नंबर</b>, SKU या ग्राहक का नाम लिखें।' },
      { tab: 'shop', sel: '#soTable', en: 'Matching orders show here. Not there? Widen the dates at the top and press <b>Fetch orders</b>. Click an order to open it.', hi: 'मिलते ऑर्डर यहाँ दिखेंगे। नहीं दिखा? ऊपर तारीखें बढ़ाएँ और <b>Fetch orders</b> दबाएँ। खोलने के लिए ऑर्डर पर क्लिक करें।' }
    ] },
  { id: 'stockin', k: ['stock', 'scan', 'receive'], need: ['stock'], avoid: ['karigar', 'job'],
    title: { en: 'Scan stock into the store', hi: 'स्टोर में स्टॉक स्कैन करना', hg: 'Store me stock scan karna' },
    steps: [
      { tab: 'fgi', en: 'Let\'s scan pieces into the India store.', hi: 'चलिए पीस इंडिया स्टोर में स्कैन करते हैं।' },
      { tab: 'fgi', sel: '#fgScan', wait: 'click', en: 'Press <b>Scan in / out</b>.', hi: '<b>Scan in / out</b> दबाएँ।' },
      { en: 'Choose <b>in</b> or <b>out</b>, then scan each piece. The count goes up with every scan; save when you\'re done.', hi: '<b>in</b> या <b>out</b> चुनें, फिर हर पीस स्कैन करें। हर स्कैन पर गिनती बढ़ेगी; पूरा होने पर सेव करें।' }
    ] },
  { id: 'punch', k: ['attendance', 'karigar', 'make'], need: ['attendance'],
    title: { en: 'Punch attendance', hi: 'हाजिरी लगाना', hg: 'Attendance lagana' },
    steps: [
      { tab: 'att', sel: '#attDay', en: 'Check the <b>day</b> — press Today if it\'s not today.', hi: '<b>दिन</b> चेक करें — आज नहीं है तो Today दबाएँ।' },
      { tab: 'att', sel: '#attQ', wait: 'value', en: 'Type the person\'s <b>name</b>.', hi: 'व्यक्ति का <b>नाम</b> लिखें।' },
      { tab: 'att', sel: '#attTable', wait: 'click', en: 'Press <b>In</b> on their row (or <b>Out</b> at the end of the day).', hi: 'उनकी लाइन पर <b>In</b> दबाएँ (या दिन के आखिर में <b>Out</b>)।' },
      { tab: 'att', sel: '#attMsg', en: 'Done! A red line here would say why it didn\'t work — like already punched in.', hi: 'हो गया! न हुआ हो तो यहाँ लाल लाइन वजह बताएगी — जैसे पहले से In है।' }
    ] },
  { id: 'correction', k: ['wrong', 'correct', 'job', 'delete', 'make'], need: ['wrong', 'correct'],
    title: { en: 'Ask to correct a job work entry', hi: 'जॉब वर्क एंट्री सही करवाना', hg: 'Job work entry correct karwana' },
    steps: [
      { tab: 'pbase', sel: '#pbQ', wait: 'value', en: 'Find the entry: type the karigar, SKU or order number.', hi: 'एंट्री ढूँढें: कारीगर, SKU या ऑर्डर नंबर लिखें।' },
      { tab: 'pbase', sel: '#pbTable', en: 'On the wrong row press <b>Correction</b>, put the right numbers in and press <b>Send for approval</b> — an admin approves it and the register is fixed. Don\'t make a new entry to cancel the old one.', hi: 'गलत लाइन पर <b>Correction</b> दबाएँ, सही नंबर भरें और <b>Send for approval</b> दबाएँ — एडमिन मंज़ूर करेंगे और रजिस्टर ठीक हो जाएगा। पुरानी काटने के लिए नई एंट्री न करें।' }
    ] }
];

/* ---------- what she does not discuss (Ravi, 22 Oct) ----------
 * Anything about the site is answered, except: how the site is built (its code, database, servers, hosting), what
 * model or AI is behind her, and the company's privacy policy. Those get a polite no and a pointer to the admin. */
const GUIDE_PRIVATE = [
  /\b(source\s*code|coding|programming|programmed|javascript|java\s*script|html|css|react|firebase|firestore|backend|back\s*end|hosting|api\s*key|tech\s*stack|algorithm|architecture|database\s+(structure|design|schema))\b/i,
  /\b(code|server|database)\s+(of|for|behind)\s+(the\s+|this\s+)?(site|app|website|erp|software)\b/i,
  /\b(site|app|website|erp|software)\s+(ka|ki|ke)\s+(code|server|database)\b/i,
  /\b(site|app|website|erp|software|meera|you|tum|aap)\b.{0,25}\b(built|made|bana|bani|banaya|banai|developed|likha|written)\b.{0,15}\b(with|in|me|mein|using|se|kaise|how)\b/i,
  /\b(how|kaise)\s+(is|was|hai|hui|hua)?\s*(this|the|ye|yeh)?\s*(site|app|website|erp|software)\s+(built|made|developed|bana|bani|banaya|banai)\b/i,
  /\b(site|app|website|erp|software)\s+(kaise|kis\s*se|kisse)\s+(bani|bana|banaya|banai|banti)\b/i,
  /\b(language|technology|tech)\s+(me|mein|in|se)\s+(bana|bani|built|made|likha|written)\b/i,
  /\b(chatgpt|gpt|openai|claude|anthropic|gemini|llm|language\s*model|neural|machine\s*learning)\b/i,
  /\b(which|what|kaun\s*s[aei]|kauns[aei]|kons[aei]|kon\s*s[aei]|kis)\s+(ai|a\.i\.|model|engine|bot)\b/i,
  /\b(are\s*you|kya\s*(tum|aap))\s+(an?\s+)?(ai|a\.i\.|bot|robot|real|insaan|human)\b/i,
  /\b(model|engine)\b.{0,20}\b(use|used|chal|chalti|based|behind|peeche)\b/i,
  /\b(trained|training\s*data)\b/i,
  /\b(privacy|gdpr|personal\s*data)\b/i,
  /\b(company|data|privacy)\s+polic(y|ies)\b/i,
  /\bdata\b.{0,20}\b(kahan|kaha|where)\b.{0,15}\b(store|stored|save|saved|rakha|jata|jaata)\b/i,
  /(प्राइवेसी|पॉलिसी|किस भाषा में बना|कैसे बनी|कैसे बना|सोर्स कोड)/
];
function gaPrivate(q) { return GUIDE_PRIVATE.some(re => re.test(q)); }

/* ---------- why something did not work ----------
 * The ERP has 576 error messages (guide-errors.js). They come in a few kinds; each kind has one plain explanation. The
 * message itself says what — this says why, and what to do about it. First match wins. */
const GUIDE_WHY = [
  { cat: 'gone', re: /\b(is gone|already gone|not here|press refresh|somebody else saved|someone else|read again)\b/i,
    en: 'Someone else changed or removed this record while you had the screen open, so what you see is out of date.<br><b>Fix:</b> press the screen\'s <b>Refresh</b>, look again, and do it once more if it is still needed.',
    hi: 'आपके स्क्रीन खुली रहते किसी और ने यह रिकॉर्ड बदल या हटा दिया, इसलिए जो दिख रहा है वो पुराना है।<br><b>ठीक करें:</b> स्क्रीन का <b>Refresh</b> दबाएँ, फिर देखें, और ज़रूरत हो तो दोबारा करें।',
    hg: 'Aapke screen khuli rehte kisi aur ne ye record badal ya hata diya, isliye jo dikh raha hai wo purana hai.<br><b>Fix:</b> screen ka <b>Refresh</b> dabaiye, phir dekhiye, aur zaroorat ho to dobara kijiye.' },
  { cat: 'access', re: /\b(permission|not allowed|only an? admin|ask an admin|not open to this account|no access|cannot (edit|change)|can't (edit|change)|is an admin's|admin's to)\b/i,
    en: 'Your account does not have the right to do this. It is not something you can fix on the screen.<br><b>Fix:</b> ask your admin to give your account this right, or to do it for you.',
    hi: 'आपके अकाउंट को यह करने की अनुमति नहीं है। यह स्क्रीन पर ठीक नहीं होगा।<br><b>ठीक करें:</b> एडमिन से यह अनुमति लें, या उनसे यह काम करवाएँ।',
    hg: 'Aapke account ko ye karne ki permission nahi hai. Ye screen par theek nahi hoga.<br><b>Fix:</b> admin se ye permission lo, ya unse ye kaam karwaiye.' },
  { cat: 'locked', re: /\b(frozen|locked|is closed|month is closed|already (done|shipped|completed|approved|decided|received|restored|accepted)|has been (shipped|closed|completed))\b/i,
    en: 'That record or month is closed, so the ERP will not change it any more.<br><b>Fix:</b> use an open date, or ask an admin if it really has to change.',
    hi: 'वो रिकॉर्ड या महीना बंद हो चुका है, इसलिए ERP अब उसे नहीं बदलेगा।<br><b>ठीक करें:</b> खुली तारीख डालें, या सच में बदलना हो तो एडमिन से पूछें।',
    hg: 'Wo record ya mahina band ho chuka hai, isliye ERP ab use nahi badlega.<br><b>Fix:</b> khuli date daalo, ya sach me badalna ho to admin se poochiye.' },
  { cat: 'duplicate', re: /\b(already (saved|exists|there|on|in|entered|used|waiting|in the)|duplicate|twice|a moment ago)\b/i,
    en: 'It is already in the ERP — saving again would count it twice.<br><b>Fix:</b> look for it in the list below. If the existing one is wrong, ask for a correction instead of entering it again.',
    hi: 'यह ERP में पहले से है — दोबारा सेव करने से दो बार गिना जाएगा।<br><b>ठीक करें:</b> नीचे लिस्ट में ढूँढें। पुरानी गलत है तो दोबारा एंट्री न करें, correction माँगें।',
    hg: 'Ye ERP me pehle se hai — dobara save karne se do baar gina jayega.<br><b>Fix:</b> neeche list me dhoondhiye. Purani galat hai to dobara entry mat kijiye, correction maango.' },
  { cat: 'toomany', re: /\b(more than|less than|only \S+ (piece|pcs|available|left)|exceed|cannot be more|can't be more|over the|not enough|must equal|must be at least|has to be zero or more|must be more than zero|at least 1)\b/i,
    en: 'A number does not fit the ERP\'s limits — for example more pieces than are left on the order, or more than were checked or received.<br><b>Fix:</b> correct the number in the box I light up. The red message says what the limit is.',
    hi: 'कोई संख्या ERP की सीमा से बाहर है — जैसे ऑर्डर में बचे पीस से ज़्यादा, या चेक/आए पीस से ज़्यादा।<br><b>ठीक करें:</b> जो बॉक्स मैं दिखाऊँ उसमें सही संख्या डालें। लाल मैसेज में सीमा लिखी है।',
    hg: 'Koi number ERP ki limit se bahar hai — jaise order me bache piece se zyada, ya check/aaye piece se zyada.<br><b>Fix:</b> jo box main dikhaun usme sahi number daalo. Laal message me limit likhi hai.' },
  { cat: 'notfound', re: /\b(not in the|not on the|not found|doesn't exist|does not exist|unknown|no such|isn't on|is not on|not active|has no line|no line for)\b/i,
    en: 'What is typed or chosen is not in the ERP\'s own lists — the master database, the names list, or that order.<br><b>Fix:</b> pick it from the drop-down instead of typing, check the spelling letter by letter, and if it is really new, an admin has to add it to the master first.',
    hi: 'जो लिखा या चुना है वो ERP की अपनी लिस्ट में नहीं है — मास्टर डेटाबेस, नामों की लिस्ट, या उस ऑर्डर में।<br><b>ठीक करें:</b> टाइप करने की बजाय ड्रॉपडाउन से चुनें, स्पेलिंग अक्षर-अक्षर देखें, और सच में नया है तो पहले एडमिन मास्टर में जोड़ें।',
    hg: 'Jo likha ya chuna hai wo ERP ki apni list me nahi hai — master database, naamon ki list, ya us order me.<br><b>Fix:</b> type karne ki jagah dropdown se chuniye, spelling dhyan se dekhiye, aur sach me naya hai to pehle admin master me add kare.' },
  { cat: 'system', re: /\b(could not|couldn't|failed|timed? ?out|network|offline|try again|not configured|blocked the|allow pop-?ups)\b/i,
    en: 'The ERP could not finish talking to the server or the browser — usually the internet, or a blocked pop-up.<br><b>Fix:</b> check the internet, allow pop-ups if it says so, then try once more. If it keeps happening, tell your admin the message and the time.',
    hi: 'ERP सर्वर या ब्राउज़र से बात पूरी नहीं कर पाया — अक्सर इंटरनेट, या रुका हुआ पॉप-अप।<br><b>ठीक करें:</b> इंटरनेट देखें, लिखा हो तो पॉप-अप allow करें, फिर एक बार और कोशिश करें। बार-बार हो तो एडमिन को मैसेज और समय बताएँ।',
    hg: 'ERP server ya browser se baat poori nahi kar paaya — aksar internet, ya ruka hua pop-up.<br><b>Fix:</b> internet dekhiye, likha ho to pop-up allow kijiye, phir ek baar aur try kijiye. Baar baar ho to admin ko message aur time bataiye.' },
  { cat: 'file', re: /\b(file|column|template|sheet|csv|excel|headings?)\b/i,
    en: 'The file is not in the shape the ERP reads.<br><b>Fix:</b> download the screen\'s own template, fill it without renaming the headings, and upload that file.',
    hi: 'फ़ाइल उस ढाँचे में नहीं है जो ERP पढ़ता है।<br><b>ठीक करें:</b> स्क्रीन का अपना template डाउनलोड करें, हेडिंग बदले बिना भरें, और वही फ़ाइल अपलोड करें।',
    hg: 'File us shape me nahi hai jo ERP padhta hai.<br><b>Fix:</b> screen ka apna template download kijiye, headings badle bina bhariye, aur wahi file upload kijiye.' },
  { cat: 'nothing', re: /^(no |nothing |none |there is nothing)|\b(tick at least|tick some|nothing to|none selected|select (some|at least))\b/i,
    en: 'There is nothing for the button to work on yet.<br><b>Fix:</b> tick or pick the lines first, or widen the filters and dates so they show.',
    hi: 'बटन के पास अभी करने को कुछ नहीं है।<br><b>ठीक करें:</b> पहले लाइनें टिक करें या चुनें, या फ़िल्टर और तारीख बढ़ाएँ ताकि वो दिखें।',
    hg: 'Button ke paas abhi karne ko kuch nahi hai.<br><b>Fix:</b> pehle lines tick kijiye ya chuniye, ya filters aur dates badhao taaki wo dikhen.' },
  { cat: 'date', re: /\bdate\b/i,
    en: 'The date is missing or not one the ERP accepts.<br><b>Fix:</b> pick the date from the calendar box.',
    hi: 'तारीख नहीं भरी या ERP उसे नहीं मानता।<br><b>ठीक करें:</b> कैलेंडर बॉक्स से तारीख चुनें।',
    hg: 'Date nahi bhari ya ERP use nahi maanta.<br><b>Fix:</b> calendar box se date chuniye.' },
  { cat: 'missing', re: /^(select|pick|choose|enter|type|fill|give|add|put|scan|write|say|tell|which|who|whom|how many|how much|what|where)\b|\b(required|is empty|cannot be empty|missing|give it one|is needed|needs a|first\.?$)\b/i,
    en: 'A box the ERP needs is still empty or not chosen — it will not save half an entry.<br><b>Fix:</b> fill the box the message names (I light it up), then press the button again.',
    hi: 'ERP को जो बॉक्स चाहिए वो अभी खाली है या चुना नहीं गया — आधी एंट्री सेव नहीं होती।<br><b>ठीक करें:</b> मैसेज में जिस बॉक्स का नाम है उसे भरें (मैं दिखाती हूँ), फिर बटन दोबारा दबाएँ।',
    hg: 'ERP ko jo box chahiye wo abhi khali hai ya chuna nahi gaya — aadhi entry save nahi hoti.<br><b>Fix:</b> message me jis box ka naam hai use bhariye (main dikhati hoon), phir button dobara dabaiye.' }
];
const GUIDE_WHY_ANY = { cat: 'rule',
  en: 'The ERP stopped because one of its rules was not met — the red message says which one.<br><b>Fix:</b> do what the message asks, then press the button again. If it is not clear, tell your admin the message.',
  hi: 'ERP इसलिए रुका क्योंकि उसका कोई नियम पूरा नहीं हुआ — लाल मैसेज बताता है कौन सा।<br><b>ठीक करें:</b> मैसेज जो कहे वो करें, फिर बटन दोबारा दबाएँ। समझ न आए तो एडमिन को मैसेज बताएँ।',
  hg: 'ERP isliye ruka kyunki uska koi rule poora nahi hua — laal message batata hai kaunsa.<br><b>Fix:</b> message jo kahe wo kijiye, phir button dobara dabaiye. Samajh na aaye to admin ko message bataiye.' };
/** Why a message happened: the hand-written fix when there is one (GUIDE_FIX), else the explanation for its kind. */
function gaWhy(text) {
  const fx = GUIDE_FIX.find(x => x.re.test(text));
  const kind = GUIDE_WHY.find(w => w.re.test(text)) || GUIDE_WHY_ANY;
  return { kind, fx };
}
/** Which screen a message comes from, by the ERP's own list of messages. */
function gaErrTab(text) {
  const t = String(text || '').toLowerCase();
  const hit = (typeof GUIDE_ERRS !== 'undefined' ? GUIDE_ERRS : []).find(([k]) => t.includes(k));
  return hit ? hit[1] : '';
}
/** The red lines on the screen now: a form's own first, then newest first. */
function gaRedLines() {
  const els = [...document.querySelectorAll('.err[id], .pks-say-bad[id]')].filter(el => guideVisible(el) && (el.textContent || '').trim());
  const at = el => ((GUIDE.seenErr.get(el.id) || {}).at) || 0;
  /* the line of the form being filled in comes first: a list that could not load is not why Save did nothing */
  const inForm = el => (el.closest('.ptmodal, .modal, [id$="Box"]:not(.hide), form') ? 1 : 0);
  return els.sort((a, b) => (inForm(b) - inForm(a)) || (at(b) - at(a)));
}
/** The boxes a form still has empty: what is needed, not remarks, searches or filters. */
function gaEmptyBoxes(scope) {
  if (!scope) return [];
  return [...scope.querySelectorAll('input, select, textarea')].filter(el => {
    if (!guideVisible(el) || el.disabled || el.readOnly) return false;   // the form is the scope already; its rows may be laid out as toolbars
    if (/^(hidden|checkbox|radio|file|button|submit|search)$/i.test(el.type || '')) return false;
    const hint = (el.id + ' ' + (el.placeholder || '') + ' ' + (el.title || '')).toLowerCase();
    if (/remark|note|optional|search|filter|auto|txt$|\bq$/.test(hint) || /Q$/.test(el.id || '')) return false;
    return String(el.value || '').trim() === '';
  });
}
/** A box's name, the way the screen shows it. */
function gaBoxName(el) {
  const lab = el.id && document.querySelector('label[for="' + el.id + '"]');
  const opt = el.tagName === 'SELECT' && el.options && el.options[0] && !el.options[0].value ? el.options[0].textContent : '';
  const n = (el.getAttribute('aria-label') || (lab && lab.textContent) || el.placeholder || opt || el.title || el.id || '').replace(/^[\s—–-]+|[\s—–-]+$/g, '').trim();
  return n.length > 40 ? n.slice(0, 38) + '…' : n;
}
/** The form a red line belongs to: its window, its open box, its card. */
function gaFormOf(el) {
  return el && el.closest && el.closest('.ptmodal, .modal, [id$="Box"]:not(.hide), form, .card');
}
/** "Why isn't this working?" — read the screen: the newest red line, what it means, and the boxes still empty. */
function gaDiagnose(lang, L) {
  GA.fix = [];
  const red = gaRedLines()[0];
  const open = red ? gaFormOf(red) : [...document.querySelectorAll('.ptmodal, [id$="Box"]')].find(b => !b.classList.contains('hide') && guideVisible(b) && gaEmptyBoxes(b).length);
  const empty = gaEmptyBoxes(open).slice(0, 4);
  const tab = typeof TAB_NOW !== 'undefined' ? TAB_NOW : '';
  const acts = [];
  let html = '';
  if (red) {
    const text = red.textContent.trim();
    const { kind, fx } = gaWhy(text);
    html = L('Here is why it stopped:', 'यह रुकने की वजह:', 'Ye rukne ki wajah:') + `<div class="ga-quote">“${esc(text.length > 220 ? text.slice(0, 217) + '…' : text)}”</div>`
      + (fx ? (lang === 'hi' ? fx.hi : fx.en) + '<br>' : '') + gaPick(kind, lang);
    const target = (fx && fx.sel && guideTarget({ sel: fx.sel })) || (kind.cat === 'missing' || kind.cat === 'toomany' || kind.cat === 'notfound' || kind.cat === 'date' ? empty[0] || guideWorkedIn(red) : null);
    if (target) { GA.fix.push(target); acts.push({ t: 'fixel', id: '0', label: L(`Show me: ${gaBoxName(target)}`, `दिखाएँ: ${gaBoxName(target)}`, `Dikhaiye: ${gaBoxName(target)}`) }); }
  } else if (empty.length) {
    html = L('Nothing has gone red yet, but this form still has empty boxes:', 'अभी कुछ लाल नहीं हुआ, पर इस फ़ॉर्म में ये बॉक्स खाली हैं:', 'Abhi kuch laal nahi hua, par is form me ye box khali hain:');
    GA.fix.push(empty[0]);
    acts.push({ t: 'fixel', id: '0', label: L(`Show me: ${gaBoxName(empty[0])}`, `दिखाएँ: ${gaBoxName(empty[0])}`, `Dikhaiye: ${gaBoxName(empty[0])}`) });
  } else {
    return null;   // nothing on the screen to read: the question is answered the usual way
  }
  if (empty.length) html += `<div class="ga-empty">${L('Still empty:', 'अभी खाली:', 'Abhi khali:')} ${empty.map(e => '<b>' + esc(gaBoxName(e)) + '</b>').join(', ')}</div>`;
  const task = GUIDE_TASKS.find(t => t.steps.some(st => st.tab === tab) && t.steps.some(st => st.sel && open && (() => { const el = guideTarget(st); return el && open.contains(el); })()));
  const half = typeof gaWalkHere === 'function' ? gaWalkHere() : null;   // the form is part done: carry on from its first empty box
  if (half) acts.push({ t: 'wresume', id: half.t.id, label: L('Carry on with me', 'मेरे साथ आगे करें', 'Mere saath aage kijiye') });
  else if (task) acts.push({ t: 'task', id: task.id, label: L('Guide me through it', 'स्टेप-बाय-स्टेप करवाएँ', 'Step-by-step karwaiye') });
  return { html, acts };
}
/** A message typed or pasted into Ask Meera: what it means, and where it comes from. */
function gaExplainMsg(q, lang, L) {
  const tab = gaErrTab(q);
  if (!tab && !GUIDE_WHY.some(w => w.cat !== 'missing' && w.cat !== 'date' && w.re.test(q))) return null;
  const { kind, fx } = gaWhy(q);
  const acts = tab && guideMayOpen(tab) ? [{ t: 'open', tab, label: L(`Open ${gaTabName(tab)}`, `${gaTabName(tab)} खोलें`, `${gaTabName(tab)} kholiye`) }] : [];
  return { html: L('If you see that message:', 'अगर यह मैसेज दिखे:', 'Agar ye message dikhe:') + `<div class="ga-quote">${fx ? (lang === 'hi' ? fx.hi : fx.en) + '<br>' : ''}${gaPick(kind, lang)}</div>`
    + (tab ? L(` It comes from <b>${esc(gaTabName(tab))}</b>.`, ` यह <b>${esc(gaTabName(tab))}</b> का मैसेज है।`, ` Ye <b>${esc(gaTabName(tab))}</b> ka message hai.`) : ''), acts };
}

/* ---------- reading a question ---------- */
function gaWords(q) {
  return String(q || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
}
function gaLev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
let GA_KEYS = null;
/** One meaning per word: the word list, a near spelling of a word on it ("shopfiy", "karigr"), or the word itself. */
/* Each word's meaning is worked out once: the written guide repeats the same words thousands of times, and the near-spelling
 * check below is the costly part (it made the first question take a second). */
const GA_MEAN = new Map();
function gaMean(w) {
  let m = GA_MEAN.get(w);
  if (m === undefined) { m = gaMeanOf(w); GA_MEAN.set(w, m); }
  return m;
}
/* Hindi letters to their sounds, consonants only: "प्रिंटर" and "printer" both read "prntr". */
const GA_DEV = { 'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'च': 'c', 'छ': 'c', 'ज': 'j', 'झ': 'j', 'ट': 't', 'ठ': 't', 'ड': 'd', 'ढ': 'd', 'ण': 'n', 'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n',
  'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'b', 'म': 'm', 'य': '', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 's', 'ष': 's', 'स': 's', 'ह': '', 'ं': 'n', 'ड़': 'r', 'ढ़': 'r', 'ज़': 'j', 'फ़': 'f', 'क़': 'k', 'ख़': 'k', 'ग़': 'g' };
function gaSkel(w) {
  let t = '';
  if (/[ऀ-ॿ]/.test(w)) { for (const ch of w.normalize('NFC')) t += GA_DEV[ch] !== undefined ? GA_DEV[ch] : ''; }
  else t = w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?!h)/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/z/g, 'j').replace(/[aeiouyh]/g, '');
  return t.replace(/(.)\1+/g, '$1');
}
/* English and Hinglish words by their sounds — the bank's own words, filled in when it loads. */
const GA_SKEL = new Map();
function gaSkelAdd(words) {
  words.forEach(w => { if (!/^[a-z]{3,}$/.test(w)) return; const k = gaSkel(w); if (k.length < 3) return;
    const c = GA_SKEL.get(k) || new Map(); c.set(w, (c.get(w) || 0) + 1); GA_SKEL.set(k, c); });
}
function gaMeanOf(w) {
  if (GUIDE_SYN[w]) return GUIDE_SYN[w];
  if (/[ऀ-ॿ]/.test(w) && GA_SKEL.size) {
    const c = GA_SKEL.get(gaSkel(w));
    if (c) { const best = [...c].sort((a, b) => b[1] - a[1])[0][0]; return gaMean(best); }
  }
  if (w.length >= 5 && /^[a-z]+$/.test(w)) {
    const stem = w.replace(/(ing|ed|es|e|s)$/, '');
    if (stem.length >= 4 && GUIDE_SYN[stem]) return GUIDE_SYN[stem];
  }
  if (w.length >= 6 && /^[a-z]+$/.test(w)) {
    /* compared only with words that start with the same letter and are about as long: a typo rarely changes the first letter */
    if (!GA_KEYS) {
      GA_KEYS = new Map();
      Object.keys(GUIDE_SYN).filter(k => k.length >= 4 && /^[a-z]+$/.test(k)).forEach(k => { if (!GA_KEYS.has(k[0])) GA_KEYS.set(k[0], []); GA_KEYS.get(k[0]).push(k); });
    }
    let best = null, bd = 9;
    for (const k of GA_KEYS.get(w[0]) || []) { if (Math.abs(k.length - w.length) > 2) continue; const d = gaLev(w, k); if (d < bd) { bd = d; best = k; } }
    if (best && bd <= (w.length >= 9 ? 2 : 1)) return GUIDE_SYN[best];
  }
  return /^[a-z]{5,}$/.test(w) ? w.replace(/(ing|ed|es|e|s)$/, '') : w;
}
function gaRead(q) {
  const words = gaWords(q);
  const lang = /[ऀ-ॿ]/.test(q) ? 'hi' : words.some(w => GUIDE_HG.has(w)) ? 'hg' : 'en';
  const people = gaPeople();
  let means = [...new Set(words.filter(w => !GUIDE_STOP.has(w) && !/^\d+$/.test(w)).map(w => people.has(w) ? 'karigar' : gaMean(w)))];
  /* "maal aa gaya", "आ गया": it came in — a receipt (both words are fillers on their own) */
  const came = /\b(aa|a)\s+(gaya|gya|gayi|gyi|gaye|gye|chuka|chuki|chuke)\b|आ\s*(गया|गई|गए|चुका|चुकी)/i.test(q);
  if (came && !means.includes('receive')) means.push('receive');
  /* both ways in one question ("jo kaam diya tha uska maal wapas aa gaya"): coming back wins — unless it is sent back TO
   * someone ("karigar ko wapas dena", "send it back to the karigar") */
  const toThem = /\bko\b[^,.?]*\b(wapas|vapas|waapas|wapis)\s+(de|dena|dene|dedo|bhej)|को[^,.?]*वापस\s*(दे|भेज)|\b(send|give)\b[^,.?]*\bback\b|\bback\s+to\b/i.test(q);
  if (means.includes('receive') && means.includes('issue') && (came || /wapas|vapas|waapas|wapis|वापस|\bback\b|\breturn/i.test(q)) && !toThem)
    means = means.filter(m => m !== 'issue');
  /* sent back to them: giving, though it says "wapas" */
  if (toThem && means.includes('issue')) means = means.filter(m => m !== 'receive');
  return { lang, means, words };
}
/** The karigars' names, from the ERP's own list: "Ramesh ko…" is about a karigar. */
function gaPeople() {
  try { return new Set((PTE.emp || []).flatMap(e => String(e[1] || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3))); }
  catch (e) { return new Set(); }
}
/** How well an entry fits: its key meanings found in the question, a must-have meaning, and words left over. */
function gaScore(e, means) {
  const has = new Set(means);
  if (e.need && !e.need.some(n => has.has(n))) return 0;
  if (e.all && e.all.length && !e.all.every(n => has.has(n))) return 0;
  if (e.avoid && e.avoid.some(n => has.has(n))) return 0;
  if (e.also && !e.also.some(n => has.has(n))) return 0;
  const hit = (e.k || []).filter(k => has.has(k)).length;
  const left = means.filter(m => !(e.k || []).includes(m)).length;
  return hit * 2 - left * 0.25;
}
const gaPick = (e, lang) => (lang === 'hi' ? e.hi : lang === 'hg' ? (e.hg || e.en) : e.en) || e.en;

/* The written guide (/guide/), read once: every step of every screen, in both languages. */
let GA_GUIDE = null;
const gaMeans = t => new Set(gaWords(t).filter(w => !GUIDE_STOP.has(w)).map(gaMean));
const gaPlain = h => String(h || '').replace(/<[^>]+>/g, ' ');
/** Her own words, always there: every step of every screen tour, and every error she knows the fix for. */
function gaOwnIndex() {
  const out = [];
  Object.keys(GUIDE_TOURS).forEach(tab => GUIDE_TOURS[tab].forEach(st => {
    const name = gaTabName(tab);
    out.push({ sec: tab, title: name, tEn: '', tHi: '', en: st.en, hi: st.hi, kind: 'tour',
      means: gaMeans(name + ' ' + gaPlain(st.en) + ' ' + gaPlain(st.hi)), head: gaMeans(name) });
  }));
  GUIDE_FIX.forEach(fx => {
    const said = fx.re.source.replace(/\\[a-z]|[\\^$.*+?()[\]{}|]/gi, ' ');
    out.push({ sec: '', title: 'When the red line says', tEn: '', tHi: '', en: fx.en, hi: fx.hi, kind: 'fix', sel: fx.sel,
      means: gaMeans(said + ' ' + gaPlain(fx.en) + ' wrong not'), head: gaMeans(said) });
  });
  return out;
}
async function gaGuideLoad() {
  if (GA_GUIDE) return GA_GUIDE;
  GA_GUIDE = gaOwnIndex();
  try {
    const html = await (await fetch('/guide/', { cache: 'force-cache' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('section.sec').forEach(sec => {
      const title = (sec.querySelector('h2 .en') || {}).textContent || '';
      const intro = sec.querySelector(':scope > .pair');
      if (intro) {
        const ie = intro.querySelector('.en'), ih = intro.querySelector('.hi');
        GA_GUIDE.push({ sec: sec.id, title, tEn: '', tHi: '', en: ie ? ie.innerHTML : '', hi: ih ? ih.innerHTML : '', kind: 'intro',
          means: gaMeans(title + ' ' + intro.textContent), head: gaMeans(title) });
      }
      sec.querySelectorAll(':scope > .note').forEach(nt => {
        const ne = nt.querySelector('.en'), nh = nt.querySelector('.hi');
        GA_GUIDE.push({ sec: sec.id, title, tEn: 'Good to know', tHi: 'ध्यान दें', en: ne ? ne.innerHTML : '', hi: nh ? nh.innerHTML : '', kind: 'step',
          means: gaMeans(title + ' ' + nt.textContent), head: gaMeans(title) });
      });
      sec.querySelectorAll('.step').forEach(st => {
        const t = st.querySelector('.t'), p = st.querySelector('.pair');
        const en = p && p.querySelector('.en'), hi = p && p.querySelector('.hi');
        const tEn = (t && t.querySelector('.en') || {}).textContent || '', tHi = (t && t.querySelector('.hi') || {}).textContent || '';
        const body = ((en && en.textContent) || '') + ' ' + ((hi && hi.textContent) || '');
        GA_GUIDE.push({ sec: sec.id, title, tEn, tHi, en: en ? en.innerHTML : '', hi: hi ? hi.innerHTML : '', kind: 'step',
          means: gaMeans(tEn + ' ' + tHi + ' ' + title + ' ' + body), head: gaMeans(tEn + ' ' + tHi + ' ' + title) });
      });
    });
  } catch (e) { /* no guide page here (an offline copy): her own words still answer */ }
  return GA_GUIDE;
}
const GA_ASKWORDS = new Set(['what', 'how', 'where', 'why', 'not', 'screen', 'show', 'help', 'can', 'find', 'see', 'button', 'open', 'ok']);
let GA_DF = null;
function gaGuideFind(means) {
  const list = GA_GUIDE || [];
  if (!GA_DF || GA_DF.n !== list.length) {
    GA_DF = { n: list.length, df: new Map() };
    list.forEach(g => g.means.forEach(m => GA_DF.df.set(m, (GA_DF.df.get(m) || 0) + 1)));
  }
  const w = m => Math.log(1 + list.length / (GA_DF.df.get(m) || 1));
  const content = means.filter(m => !GA_ASKWORDS.has(m));
  if (!content.length) return null;
  let best = null, bs = 0;
  for (const g of list) {
    let sc = 0;
    for (const m of content) { if (g.head.has(m)) sc += 2 * w(m); else if (g.means.has(m)) sc += w(m); }
    if (sc && typeof TAB_NOW !== 'undefined' && g.sec === TAB_NOW) sc += 1;
    if (sc > bs) { bs = sc; best = g; }
  }
  /* enough: the question's own words carry it, not one common word */
  const need = Math.max(4, Math.min(9, content.reduce((a, m) => a + w(m), 0) * 0.55));
  return bs >= need ? best : null;
}

/** The answer to one question: { html, acts: [{t:'task'|'tour'|'open'|'guide', id|tab, label}] }. */
/* ---------- a line on the screen ("what is this 92 Dark Salmon Pink", "ye RQL354-K wali line kya hai") ----------
 * Only what the person already sees: the visible rows of the screen in front. A row is taken when the question's own
 * words — the ones that are not everyday ERP words — are found in it, a number exactly, a word by its start ("pin" in
 * "Pink"), and they make up most of what was asked. */
const GA_ROW_SKIP = new Set(['line', 'row', 'item', 'entry', 'wali', 'wala', 'vala', 'wale', 'ye', 'yeh', 'this', 'that', 'is', 'kya', 'what', 'matlab', 'mean', 'meaning', 'about', 'batao', 'bataiye', 'tell', 'me', 'hai', 'h', 'ka', 'ki', 'ke', 'here', 'yahan', 'yaha', 'screen', 'page']);
function gaRowFind(q) {
  const here = gaHere();
  const root = (here === 'mywork' && $('frHome')) || (typeof guidePane === 'function' && guidePane(here)) || null;
  if (!root) return null;
  const B = GA_BANK;
  const words = gaWords(q).filter(w => !GUIDE_STOP.has(w) && !GA_ROW_SKIP.has(w) && w.length >= 2);
  if (!words.length) return null;
  /* at least one word that names a thing, not the ERP: a number, or a word the answers hardly use */
  const own = w => /\d/.test(w) || !B || (B.df.get(gaMean(w)) || 0) <= 3;
  if (!words.some(own)) return null;
  const rows = [...root.querySelectorAll('tbody tr, .ml-row')].filter(x => x.offsetParent !== null).slice(0, 4000);
  let best = null, bs = 0, bown = 0, ties = [];
  for (const row of rows) {
    const t = ' ' + (row.textContent || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ') + ' ';
    let hit = 0, hitOwn = 0;
    for (const w of words) if (/^\d+$/.test(w) ? t.includes(' ' + w + ' ') : t.includes(' ' + w)) { hit++; if (own(w)) hitOwn++; }
    if (hit > bs || (hit === bs && hitOwn > bown)) { bs = hit; bown = hitOwn; best = row; ties = [row]; }
    else if (hit && hit === bs && hitOwn === bown) ties.push(row);
  }
  if (!best || !bown || bs < Math.min(2, words.length) || bs / words.length < 0.6) return null;
  best.gaTies = ties;
  return best;
}
function gaRowAnswer(row, lang, L) {
  const name = esc(gaTabName(gaHere()));
  const ties = row.gaTies || [row];
  if (ties.length > 1) {
    const first = x => ((x.tagName === 'TR' ? x.children[0] : x) || x).textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    const names = [...new Set(ties.map(first))];
    if (names.length > 1) return { html: L(`${ties.length} lines on <b>${name}</b> fit that. Which one do you mean? Ask again with its full name, for example:`, `<b>${name}</b> की ${ties.length} लाइनें इससे मिलती हैं। कौन-सी? उसका पूरा नाम लिखकर फिर पूछें, जैसे:`, `<b>${name}</b> ki ${ties.length} lines isse milti hain. Kaunsi? Uska poora naam likh kar phir poochiye, jaise:`)
      + gaNearHtml(names.slice(0, 4).map(n => ({ e: { q: { en: [n], hi: [n], hg: [n] } } })), lang, ''), acts: [], row: true };
  }
  const table = row.closest('table');
  const heads = table ? [...table.querySelectorAll('thead th')].map(th => th.textContent.replace(/\s+/g, ' ').trim()) : [];
  const cells = row.tagName === 'TR' ? [...row.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()) : [row.textContent.replace(/\s+/g, ' ').trim()];
  const lead = cells.find(c => c && !/^[\d\s.,—–-]*$/.test(c)) || cells[0] || '';
  const parts = cells.map((c, i) => (c && c !== lead ? (heads[i] ? `<li><b>${esc(heads[i])}</b>: ${esc(c)}</li>` : `<li>${esc(c)}</li>`) : '')).filter(Boolean);
  const tour = GUIDE_TOURS[gaHere()], intro = tour && tour[0] && !tour[0].sel ? (lang === 'hi' ? tour[0].hi : tour[0].en) : '';
  GA.fix = [row];
  return { html: L(`That is a line on <b>${name}</b>: <b>${esc(lead)}</b>.`, `यह <b>${name}</b> की एक लाइन है: <b>${esc(lead)}</b>।`, `Ye <b>${name}</b> ki ek line hai: <b>${esc(lead)}</b>.`)
      + (parts.length ? `<div class="ga-do"><b>${L('What it shows', 'इसमें क्या है', 'Isme kya hai')}</b><ul>${parts.slice(0, 10).join('')}</ul></div>` : '')
      + (intro ? `<div class="ga-why"><b>${L('This screen', 'यह स्क्रीन', 'Ye screen')}</b>${intro}</div>` : ''),
    acts: [{ t: 'fixel', id: '0', label: L('Show me the line', 'लाइन दिखाएँ', 'Line dikhaiye') }], row: true };
}
async function gaAnswer(q) {
  const { lang, means, words } = gaRead(q);
  const L = (en, hi, hg) => (lang === 'hi' ? hi : lang === 'hg' ? (hg || en) : en);
  if (gaPrivate(q)) return { html: L('Sorry, I can\'t talk about how the site or I am built, or about company policies like privacy. For those, please ask your admin or management. I\'m happy to help with using the ERP — any screen, any job, any problem.',
    'माफ़ कीजिए, साइट या मैं कैसे बनी हूँ, या कंपनी की पॉलिसी (जैसे प्राइवेसी) के बारे में मैं बात नहीं कर सकती। इसके लिए एडमिन या मैनेजमेंट से पूछें। ERP चलाने में — कोई भी स्क्रीन, कोई भी काम, कोई भी दिक्कत — मैं खुशी से मदद करूँगी।',
    'Sorry, site ya main kaise bani hoon, ya company ki policy (jaise privacy) ke baare me main baat nahi kar sakti. Iske liye admin ya management se poochiye. ERP chalane me — koi bhi screen, koi bhi kaam, koi bhi dikkat — main khushi se help karungi.'), acts: [] };
  if (/^(meera\s+)?(unanswered|missed|miss)(\s+(questions|list))?\s*$/i.test(q.trim())) return gaMissList(L);
  await gaBankLoad();
  { const row = gaRowFind(q); if (row) return gaRowAnswer(row, lang, L); }
  /* "ab kya karu", "what next", "atak gaya" with a form half filled in: its next box */
  if (typeof GA_NEXT_RE !== 'undefined' && GA_NEXT_RE.test(q)) { const n = gaWalkNext(lang, L); if (n) return n; }
  /* Not about the ERP at all (Ravi, 27 Oct: "unrelated to erp ... khud hi bolde"): said at once — no AI, no ticket. */
  if (gaOffTopic(means)) return { html: L('Sorry, I can\'t answer that — it isn\'t about the ERP. Ask me about any screen, job or problem in the ERP.',
    'माफ़ कीजिए, इसका जवाब मैं नहीं दे सकती — यह ERP के बारे में नहीं है। ERP की किसी भी स्क्रीन, काम या दिक्कत के बारे में पूछें।',
    'Sorry, iska jawaab main nahi de sakti — ye ERP ke baare me nahi hai. ERP ki kisi bhi screen, kaam ya dikkat ke baare me poochiye.'), acts: [], miss: 'offtopic', off: true };
  if (!means.length) return { html: L('Tell me a little more — what are you trying to do?', 'थोड़ा और बताइए — आप क्या करना चाहते हैं?', 'Thoda aur bataiye — aap kya karna chahte hain?'), acts: [] };
  /* "why isn't it saving / error kyu / kaam pura nahi ho raha": the screen itself is the best answer */
  /* Only a question that names no topic of its own reads the screen ("error kyu", "problem hai", "save nahi ho raha"):
   * "galat entry", "HS code error" or "server error" have answers of their own. */
  const topic = means.filter(m => !['wrong', 'why', 'what', 'how', 'not', 'can', 'help', 'ok', 'complete', 'save', 'button', 'job', 'work', 'screen', 'issue', 'see', 'open'].includes(m));
  const stuck = !topic.length && (means.includes('why') || means.includes('complete') || means.includes('wrong')
    || (means.includes('not') && ['save', 'issue', 'job', 'button', 'work'].some(m => means.includes(m))));
  if (stuck) { const d = gaDiagnose(lang, L); if (d) return d; }
  const fx = GUIDE_FIX.find(x => { const m = x.re.exec(q); return m && m[0].length >= 12; });
  if (fx) {
    const acts = fx.sel && guideTarget({ sel: fx.sel }) ? [{ t: 'fix', id: fx.sel, label: L('Show me the box', 'बॉक्स दिखाएँ', 'Box dikhaiye') }] : [];
    return { html: L('If you see that red message:', 'अगर यह लाल मैसेज दिखे:', 'Agar ye laal message dikhe:') + `<div class="ga-quote">${lang === 'hi' ? fx.hi : fx.en}</div>`, acts };
  }
  /* a message from the ERP, pasted or typed: its own explanation */
  if (q.length >= 18 && gaErrTab(q)) { const m = gaExplainMsg(q, lang, L); if (m) return m; }
  const cands = [];
  GUIDE_TASKS.forEach(e => { const sc = gaScore(e, means); cands.push({ kind: 'task', e, s: sc + (sc > 0 && (means.includes('how') || means.includes('make')) ? 1 : 0) }); });
  GUIDE_FAQ.forEach(e => cands.push({ kind: 'faq', e, s: gaScore(e, means) + (means.includes('not') ? 0.5 : 0) }));
  GUIDE_TALK.forEach(e => cands.push({ kind: 'talk', e, s: gaScore(e, means) }));
  GUIDE_SCREENS.forEach(([tab, names]) => {
    const k = [...new Set(gaWords(names).map(gaMean))];
    const hit = k.filter(x => means.includes(x)).length;
    if (hit) cands.push({ kind: 'screen', tab, s: hit * 1.6 + (means.includes('what') || means.includes('where') || means.includes('open') ? 0.6 : 0) - means.filter(m => !k.includes(m) && !['what', 'where', 'open', 'screen', 'show'].includes(m)).length * 0.4 });
  });
  cands.sort((a, b) => b.s - a.s);
  const top = cands[0];
  await gaBankLoad();
  /* the first question waits for the meaning file (about 3 MB; on the live site it can take 2–3 s): answered on words
   * alone, "maal wapas aa gaya" got a QC answer (27 Oct). Up to 4 s, once — after that it is in. */
  if (GA_W === null) await Promise.race([gaWordsLoad(), new Promise(ok => setTimeout(ok, 4000))]);
  const hits = gaBankFind(means, words, q);
  if (!(top && top.kind === 'talk' && top.s >= 1.4) && hits[0] && hits[0].s >= (GA_W ? GA_BANK_SURE_SEM : GA_BANK_SURE)) {
    /* two answers fit almost equally ("short by kya hai": the screen, or its Short by column): ask which, never guess */
    if (hits[1] && hits[0].s - hits[1].s < GA_BANK_GAP && hits[1].e.id !== hits[0].e.id)
      return { html: L('Your question fits more than one answer. Which one do you mean?', 'आपका सवाल एक से ज़्यादा जवाबों से मिलता है। आप कौन-सा पूछ रहे हैं?', 'Aapka sawaal ek se zyada jawaabon se milta hai. Aap kaunsa poochh rahe hain?')
        + gaNearHtml(hits.slice(0, 3).filter(h => h.s >= GA_BANK_NEAR), lang, ''), acts: [] };
    return gaBankAnswer(hits[0].e, lang, L, hits.slice(1, 3).filter(h => h.s >= GA_BANK_NEAR));
  }
  /* Close, but not sure enough: the bank's nearest answers are offered before the older word lists and the written guide,
   * which lag behind the screens (24 Oct: they answered "Vendor Orders" and "+recv" questions with retired steps). */
  if (!(top && top.kind === 'talk' && top.s >= 1.4) && hits[0] && hits[0].s >= GA_BANK_ASK)
    return { html: L('I\'m not fully sure what you mean. Is it one of these?', 'मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं?', 'Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain?')
      + gaNearHtml(hits.slice(0, 3).filter(h => h.s >= GA_BANK_NEAR), lang, ''), acts: [], miss: 'near' };
  if (top && top.s >= 1.4 && (top.kind === 'task' || top.kind === 'faq')) {
    const covered = new Set([...(top.e.k || []), ...(top.e.need || []), ...GA_ASKWORDS]);
    const extra = means.filter(m => !covered.has(m));
    if (extra.length) {
      await gaGuideLoad();
      const g = gaGuideFind(means);
      if (g && extra.every(m => g.means.has(m))) return gaGuideAnswer(g, lang, L);
    }
  }
  if (top && top.s >= 1.4) {
    if (top.kind === 'task') {
      const t = top.e;
      return { html: L(`I can walk you through <b>${t.title.en}</b>, one step at a time on the real screen.`, `मैं आपको <b>${t.title.hi}</b> असली स्क्रीन पर एक-एक स्टेप करवा सकती हूँ।`, `Main aapko <b>${t.title.hg}</b> real screen par ek ek step karwa sakti hoon.`),
        acts: [{ t: 'task', id: t.id, label: L('Guide me step by step', 'स्टेप-बाय-स्टेप करवाएँ', 'Step-by-step karwaiye') }] };
    }
    if (top.kind === 'faq') {
      if (top.e.guide) {
        await gaGuideLoad();
        const g = (GA_GUIDE || []).find(x => x.sec === top.e.guide.sec && top.e.guide.step.test(x.tEn || ''));
        if (g) return gaGuideAnswer(g, lang, L);
      }
      const acts = top.e.task ? [{ t: 'task', id: top.e.task, label: L('Show me how', 'करके दिखाएँ', 'Karke dikhaiye') }] : [];
      return { html: gaPick(top.e, lang), acts };
    }
    if (top.kind === 'talk') {
      if (top.e.fn === 'time') { const s = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); return { html: L(`It's <b>${s}</b>.`, `अभी <b>${s}</b> बजे हैं।`, `Abhi <b>${s}</b> baje hain.`), acts: [] }; }
      if (top.e.fn === 'date') { const s = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return { html: L(`Today is <b>${s}</b>.`, `आज <b>${s}</b> है।`, `Aaj <b>${s}</b> hai.`), acts: [] }; }
      return { html: gaPick(top.e, lang), acts: [] };
    }
    if (top.kind === 'screen') {
      /* "fetch orders kya karta hai": a word beyond the screen's name means a part of it — a step says it better. */
      const named = new Set([...gaWords(GUIDE_SCREENS.find(x => x[0] === top.tab)[1]).map(gaMean), 'what', 'where', 'open', 'screen', 'show', 'how']);
      if (means.some(m => !named.has(m))) { await gaGuideLoad(); const g = gaGuideFind(means); if (g) return gaGuideAnswer(g, lang, L); }
      return gaScreenAnswer(top.tab, lang, L);
    }
  }
  await gaGuideLoad();
  const g = gaGuideFind(means);
  if (g) return gaGuideAnswer(g, lang, L);
  /* Close, but not sure enough to answer: ask which one they mean. */
  if (hits[0] && hits[0].s >= GA_BANK_NEAR) return { html: L('I\'m not fully sure what you mean. Is it one of these?', 'मैं पक्का नहीं समझ पाई। क्या आप इनमें से कुछ पूछ रहे हैं?', 'Main pakka nahi samajh paayi. Kya aap inme se kuch poochh rahe hain?')
    + gaNearHtml(hits.slice(0, 3), lang, ''), acts: [], miss: 'near' };
  /* Not about the ERP, or not understood: say so plainly, and offer what she can do. */
  return { html: L('Sorry, I didn\'t get that. I only know this ERP — ask me how to do a job, what a screen is for, or tell me what\'s not working. You can also write in Hindi or Hinglish.',
    'माफ़ कीजिए, मैं समझ नहीं पाई। मुझे सिर्फ़ यह ERP आता है — कोई काम कैसे करें, कोई स्क्रीन किस लिए है, या क्या नहीं चल रहा, पूछें।',
    'Sorry, main samajh nahi paayi. Mujhe sirf ye ERP aata hai — koi kaam kaise kare, koi screen kis liye hai, ya kya nahi chal raha, poochiye.'), acts: [], miss: true };
}
function gaGuideAnswer(g, lang, L) {
  {
    const body = (lang === 'hi' ? g.hi : g.en) || g.en;
    const head = g.kind === 'fix' ? L('If you see that red message:', 'अगर यह लाल मैसेज दिखे:', 'Agar ye laal message dikhe:')
      : g.kind === 'tour' || g.kind === 'intro' ? L(`On <b>${esc(g.title)}</b>:`, `<b>${esc(g.title)}</b> में:`, `<b>${esc(g.title)}</b> me:`)
      : L(`From the written guide — <b>${esc(g.title)} · ${esc(g.tEn)}</b>:`, `लिखी गाइड से — <b>${esc(g.title)} · ${esc(g.tHi || g.tEn)}</b>:`, `Likhi guide se — <b>${esc(g.title)} · ${esc(g.tEn)}</b>:`);
    const acts = [];
    if (g.sec && guideMayOpen(g.sec)) acts.push({ t: 'tour', tab: g.sec, label: L('Show me on the screen', 'स्क्रीन पर दिखाएँ', 'Screen par dikhaiye') });
    if (g.sec && g.kind !== 'tour') acts.push({ t: 'guide', tab: g.sec, label: L('Full guide', 'पूरी गाइड', 'Poori guide') });
    return { html: head + `<div class="ga-quote">${body}</div>`, acts };
  }
}
function gaScreenAnswer(tab, lang, L) {
  const tour = GUIDE_TOURS[tab], name = gaTabName(tab);
  const intro = tour && tour[0] && !tour[0].sel ? (lang === 'hi' ? tour[0].hi : tour[0].en) : L(`<b>${esc(name)}</b> is one of your screens.`, `<b>${esc(name)}</b> आपकी एक स्क्रीन है।`, `<b>${esc(name)}</b> aapki ek screen hai.`);
  const acts = [];
  if (guideMayOpen(tab) && tab !== gaHere()) acts.push({ t: 'open', tab, label: L(`Open ${name}`, `${name} खोलें`, `${name} kholiye`) });
  if (guideMayOpen(tab)) acts.push({ t: 'tour', tab, label: L('Show me round it', 'घुमाकर दिखाएँ', 'Ghuma ke dikhaiye') });
  const tasks = GUIDE_TASKS.filter(t => t.steps.some(s => s.tab === tab)).slice(0, 2);
  tasks.forEach(t => acts.push({ t: 'task', id: t.id, label: lang === 'hi' ? t.title.hi : lang === 'hg' ? t.title.hg : t.title.en }));
  return { html: intro + (guideMayOpen(tab) ? '' : L(' You don\'t have this screen — ask your admin if you need it.', ' यह स्क्रीन आपके पास नहीं है — ज़रूरत हो तो एडमिन से पूछें।', ' Ye screen aapke paas nahi hai — zaroorat ho to admin se poochiye.')), acts };
}
function gaTabName(tab) {
  const n = { shop: 'Shopify Orders', ord: 'Order Console', pack: 'Packing List', fgi: 'Finished Goods', pbase: 'Job Work Register', flow: 'Production flow', qc: 'Quality Control', fba: 'FBA Dispatch', pmdb: 'Master Database', att: 'Attendance', rep: 'Reports', so: 'Sales Orders', cx: 'Customer Orders', top: 'Top ASIN Status', fab: 'Fabric Inventory', repl: 'Replenishment', dash: 'Dashboard', pcut: 'Cutting Data', hr: 'Finance & HR', vord: 'Vendor Orders', acc: 'Accessories', mywork: 'My work today' };
  return n[tab] || tab;
}

/* ---------- the answer bank (/guide/meera-bank.json) ----------
 * Several hundred written answers, each with the ways staff ask it, in English, Hindi and Hinglish. Fetched the first
 * time Ask Meera opens — never with the page — and kept by the browser after that. An answer is a direct line, the
 * reason behind it, the steps, and buttons. A question it does not fit well is never forced onto it: close ones are
 * offered as "did you mean", and the question is kept (on this device only) so the bank can learn it. */
let GA_BANK = null, GA_BANK_P = null;
function gaBankLoad() {
  if (GA_BANK) return Promise.resolve(GA_BANK);
  if (!GA_BANK_P) GA_BANK_P = fetch('/guide/meera-bank.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(list => { if (!Array.isArray(list)) { GA_BANK_P = null; throw new Error('bank not loaded'); } return list; })   // tried again next time
    .then(list => (typeof gaAiLearned === 'function' ? gaAiLearned(Array.isArray(list) ? list : []) : list))
    .then(list => (typeof gaWalksLoad === 'function' ? gaWalksLoad().then(() => list, () => list) : list))   // the walk-throughs (guide-walks.js)
    .then(list => (GA_BANK = gaBankIndex(Array.isArray(list) ? list : [])))
    .then(b => { gaWordsLoad().then(() => setTimeout(gaSemIndex, 0)); return b; });
  /* a question asked while it failed is answered from the short built-in lists, as without the bank */
  return GA_BANK_P.catch(() => (GA_BANK || gaBankIndex([])));
}
/* ---------- meaning search (/guide/meera-words.bin) ----------
 * The bank above matches words. This matches MEANING: every word Meera's answers use (and the 3,000 commonest others) has a
 * 256-number meaning from Model2Vec potion-multilingual-128M (made from BGE-M3, 101 languages), so "maal karigar ko bhejna"
 * lands near "give job work to a karigar" though they share no word. A sentence's meaning is the average of its words'.
 * About 2 MB, fetched after the bank the first time Ask Meera opens, kept by the browser; nothing runs on page load, and
 * without the file the word search alone answers, as before. */
let GA_W = null, GA_W_P = null, GA_SEM = null;
/* How much meaning counts next to the word match, and whether filler words ("ko", "hai", "the") are left out of a
 * sentence's meaning. Both set on 220 test questions (half to set, half to check). */
let GA_SEM_W = 0.5, GA_SEM_SKIP = true;
function gaWordsLoad() {
  if (GA_W !== null) return Promise.resolve(GA_W);
  if (!GA_W_P) GA_W_P = fetch('/guide/meera-words.bin', { cache: 'no-cache' })
    .then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
    .then(buf => { if (!buf) { GA_W_P = null; return null; } try { GA_W = gaWordsParse(buf); } catch (e) { GA_W = false; } return GA_W; });
  return GA_W_P;
}
/** The file: a header (the words), each word's 256 numbers as small whole numbers, each row's scale, and its piece count. */
function gaWordsParse(buf) {
  const H = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, H)));
  const N = head.words.length, D = head.dim, o = 4 + H, end = o + N * D, so = end + ((4 - (end % 4)) % 4);
  return { N, D, rows: new Int8Array(buf, o, N * D), scale: new Float32Array(buf.slice(so, so + 4 * N)),
    cnt: new Uint8Array(buf, so + 4 * N, N), at: new Map(head.words.map((w, i) => [w, i])) };
}
/** A sentence's meaning, length 1. A word not in the table is tried as its known spelling ("karigr" → karigar). */
function gaVec(text) {
  const W = GA_W;
  if (!W) return null;
  const v = new Float32Array(W.D);
  let n = 0;
  for (const w of gaWords(text)) {
    if (GA_SEM_SKIP && GUIDE_STOP.has(w)) continue;
    let i = W.at.get(w);
    if (i === undefined) i = W.at.get(gaMean(w));
    if (i === undefined) continue;
    const c = W.cnt[i], k = W.scale[i] * c, base = i * W.D;
    for (let d = 0; d < W.D; d++) v[d] += W.rows[base + d] * k;
    n += c;
  }
  if (!n) return null;
  let len = 0;
  for (let d = 0; d < W.D; d++) len += v[d] * v[d];
  len = Math.sqrt(len) || 1;
  for (let d = 0; d < W.D; d++) v[d] /= len;
  return v;
}
/** Every way of asking in the bank, as a meaning (kept small: whole numbers, 3–4 MB), worked out once both files are in. */
function gaSemIndex() {
  if (GA_SEM || !GA_BANK || !GA_W) return GA_SEM;
  const D = GA_W.D, vecs = [], own = [];
  GA_BANK.list.forEach((e, ei) => { const q = e.q || {}; [].concat(q.en || [], q.hi || [], q.hg || []).forEach(t => { const v = gaVec(t); if (v) { vecs.push(v); own.push(ei); } }); });
  const P = new Int8Array(vecs.length * D);
  vecs.forEach((v, j) => { for (let d = 0; d < D; d++) P[j * D + d] = Math.round(v[d] * 127); });
  GA_SEM = { P, own: Int32Array.from(own), n: vecs.length, D };
  return GA_SEM;
}
/** How close in meaning each answer is to the question (its closest way of asking), 0–1; null without the table. */
function gaSemScores(q) {
  const S = gaSemIndex(), v = S && gaVec(q);
  if (!v) return null;
  const D = S.D, best = new Float32Array(GA_BANK.list.length);
  for (let j = 0; j < S.n; j++) {
    let dot = 0;
    const base = j * D;
    for (let d = 0; d < D; d++) dot += S.P[base + d] * v[d];
    dot /= 127;
    const o = S.own[j];
    if (dot > best[o]) best[o] = dot;
  }
  return best;
}
/** Each answer's ways of asking, as meanings; and how rare each meaning is across the bank (a rare one decides more). */
/* Every part of the app (a button, column, box, option or hover note) comes compact — [label, kind, en, hi, hg, sel] —
 * and is opened out here: its ways of asking made from its own label, its answer from its one line. */
const GA_PART_KIND = { button: ['button', 'बटन', 'button'], column: ['column', 'कॉलम', 'column'], box: ['box', 'बॉक्स', 'box'], option: ['option', 'विकल्प', 'option'], note: ['note', 'जानकारी', 'note'] };
function gaPartOpen(e) {
  const [L, kind, en, hi, hg, sel] = e.p, K = GA_PART_KIND[kind] || ['part', 'हिस्सा', 'part'], scr = e.tab ? gaTabName(e.tab) : '';
  e.q = { en: [L, `what is ${L}`, `what does ${L} do`, `${L} meaning`, `${L} ${K[0]}`], hi: [`${L} क्या है`, `${L} का मतलब`, `${L} क्या करता है`],
    hg: [`${L} kya hai`, `${L} kya karta hai`, `${L} ka matlab`, `${L} ${K[2]}`] };
  const where = { en: scr ? ` — ${K[0]} on ${scr}` : '', hi: scr ? ` — ${scr} पर ${K[1]}` : '', hg: scr ? ` — ${scr} par ${K[2]}` : '' };
  e.a = { en: `<b>${esc(L)}</b>${esc(where.en)}: ${esc(en)}`, hi: `<b>${esc(L)}</b>${esc(where.hi)}: ${esc(hi || en)}`, hg: `<b>${esc(L)}</b>${esc(where.hg)}: ${esc(hg || en)}` };
  if (sel) e.sel = sel;
}
function gaBankIndex(list) {
  const df = new Map();
  list.forEach(e => { if (e.p && !e.q) gaPartOpen(e); });
  gaSkelAdd(Object.keys(GUIDE_SYN));
  list.forEach(e => { const q = e.q || {}; gaSkelAdd([].concat(q.en || [], q.hg || [], gaPlain((e.a || {}).en)).flatMap(t => gaWords(t))); });
  GA_MEAN.clear();
  list.forEach(e => {
    const q = e.q || {};
    e.phr = [].concat(q.en || [], q.hi || [], q.hg || []).map(t => gaMeans(t)).filter(s => s.size);
    e.all = new Set(e.phr.flatMap(s => [...s]));
    e.body = gaMeans(gaPlain((e.a || {}).en) + ' ' + gaPlain((e.a || {}).hg));
    e.raw = new Set([].concat(q.en || [], q.hi || [], q.hg || []).flatMap(t => gaWords(t)));
    e.all.forEach(m => df.set(m, (df.get(m) || 0) + 1));
    if (e.p) { e.pn = ' ' + gaWords(e.p[0]).join(' ') + ' '; e.pw = new Set(gaWords(e.p[0])); }
  });
  return { list, df, n: list.length || 1 };
}
/* The words that only make a question of a part's name: "<label> kya karta hai", "what happens if I press <label>". */
const GA_PART_ASK = new Set(('what does do happens happen press click tap mean meaning means show shows kya karta karti hai kis kaam ka ke liye kisliye ' +
  'kyun kyu ye yeh is ka matlab hota hoti dabane dabau dabaun dabaya par pe se button column box option note field tab ' +
  'क्या करता करती है किस काम का के लिए किसलिए मतलब होता यह ये दबाने बटन कॉलम').split(' '));
/* NOT ABOUT THE ERP (27 Oct): a word none of Meera's answers ever uses (weather, cricket, pizza, bitcoin…) and fewer than
 * two words her answers do use, leaving out the asking words below. Set on 380 test questions, 200 part questions and
 * 11,335 made from every part's name: none of them refused; 12 of the 41 she cannot answer caught (the rest are
 * about the business — GST, Flipkart — and go on to the AI and a ticket). */
const GA_OFF_IGNORE = new Set(["what","how","where","why","not","can","help","ok","date","time","tomorrow","yesterday","good","best","tell","give","make","want","need","see","show","new","one","all","more","last","week","month","day","year","name","you","who","hello","thanks","bye","joke","language","meera","about","writ","count","correct","open","find","screen","button","do","get","please","work","job","wala","wali","wale","वाली","वाला","kab","milega","aayegi","rahega","raha","kaisa","ऐसा","ऐसे","वैसा","जबकि","क्यों","kyu","kyun","bhai","yaar","sir","ji","madam","plz","acha","accha","theek","haan","nahi","किसलिए","किसलिये","kisliye","kislie","kisliy","किस","लिए","liye","क्यूँ","क्यूं","कैसा","कैसी","कौनसा","कौन","konsa","kaunsa","matlab","मतलब","बताओ","बताइए","batao","bataiye","samjhao","समझाओ","hota","होता","hoti","होती","karta","करता","karti","करती"]);
function gaOffTopic(means) {
  const B = GA_BANK; if (!B || !B.list.length) return false;
  const ms = means.filter(m => !GA_OFF_IGNORE.has(m) && !/^\d+$/.test(m));
  const known = ms.filter(m => (B.df.get(m) || 0) >= 3).length, unknown = ms.filter(m => !B.df.has(m) && m.length >= 3).length;
  return unknown > 0 && known < 2;
}
/* The screens by what people call them: a question that names one leans to that screen's answers. */
const GA_TAB_SAY = [['ord', /order console/], ['pbase', /job ?work|jobwork|जॉब वर्क/], ['ppress', /\bpress\b|प्रेस/], ['pack', /packing|scan to pack|\bpack\b/],
  ['qc', /\bqc\b|quality|क्यूसी/], ['att', /attendance|hajri|haziri|हाजिरी/], ['pcut', /cutting|कटिंग/], ['fgi', /finished goods|\bfg\b/], ['fba', /\bfba\b/],
  ['shop', /shopify order/], ['shopify', /shopify stock/], ['so', /sales order/], ['repl', /replenish/], ['fab', /fabric inventory/], ['hr', /salary|payout|finance|सैलरी/],
  ['pmdb', /master database/], ['dash', /dashboard/], ['top', /top asin/], ['flow', /\bppc\b|production flow/], ['gdesk', /greige desk/], ['vend', /vendor portal/], ['acc', /accessor/]];
function gaTabsSaid(q) { const t = String(q || '').toLowerCase(); return new Set(GA_TAB_SAY.filter(([, re]) => re.test(t)).map(([tab]) => tab)); }
/** The answers that fit a question best, with how well (0–1): the closest way of asking, weighted by rare words.
 * The same word as asked (not only the same meaning) settles near-ties: "PIN bhool gaya" is the PIN answer. */
function gaBankFind(means, words, q) {
  const B = GA_BANK;
  if (!B || !B.list.length || !means.length) return [];
  const sem = GA_SEM_W ? gaSemScores(q) : null;
  const w = m => Math.log(1 + B.n / (B.df.get(m) || 0.5));
  const qW = means.reduce((a, m) => a + w(m), 0);
  const tab = gaHere();
  const said = gaTabsSaid(q);
  if (GA_HERE_RE.test(String(q || ''))) said.add(tab);
  /* A question that is a part's name and nothing more ("SKU kya karta hai") is about that part — the one on this screen
   * first, and the longest name that fits ("Placed today", not "Placed"). */
  const qw = gaWords(q), qn = ' ' + qw.join(' ') + ' ';
  let longest = 0;
  for (const e of B.list) if (e.pn && e.pn.length > longest && qn.includes(e.pn)) longest = e.pn.length;
  const out = [];
  for (let ei = 0; ei < B.list.length; ei++) {
    const e = B.list[ei];
    let best = 0;
    for (const p of e.phr) {
      let inter = 0, pW = 0;
      p.forEach(m => { pW += w(m); });
      for (const m of means) if (p.has(m)) inter += w(m);
      if (inter) best = Math.max(best, inter / Math.sqrt(qW * pW));
    }
    const near = sem ? sem[ei] : 0;
    let named = 0;
    if (longest && e.pn && e.pn.length === longest && qn.includes(e.pn)) {
      const rest = qw.filter(x => !e.pw.has(x) && !GA_PART_ASK.has(x) && !GUIDE_STOP.has(x)).length;
      named = rest === 0 ? 0.35 : rest === 1 ? 0.12 : 0;
      if (named && e.tab && e.tab === tab) named += 0.12;
    }
    if (!best && !named && near < 0.5) continue;
    /* a word not in any way of asking, but in the answer itself, still counts a little */
    best += 0.04 * means.filter(m => !e.all.has(m) && e.body.has(m)).length;
    if (e.tab && e.tab === tab) best += 0.05;
    if (said.size && (said.has(e.tab) || said.has(e.tab2))) best += 0.1;
    best += 0.015 * (words || []).filter(x => !GUIDE_STOP.has(x) && e.raw.has(x)).length;
    /* meaning: added on top of the word match, so a question in other words still finds it */
    if (sem) best = (best + GA_SEM_W * near) / (1 + GA_SEM_W * 0.6);
    out.push({ e, s: best + named });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, GA_TOPK);
}
/* How many answers a search returns; how sure she must be to answer outright (with the meaning table the scores run
 * higher, so the bar is higher); and how close an answer must be to be offered as "did you mean". */
let GA_TOPK = 4;
let GA_BANK_SURE = 0.65, GA_BANK_SURE_SEM = 0.75, GA_BANK_NEAR = 0.32;
/* how far ahead the best answer must be to be given outright (set on 389 test questions, 24 Oct: wrong answers halved) */
let GA_BANK_GAP = 0.04;
/* from here up, a not-sure question gets the bank's nearest answers to choose from rather than the older lists */
let GA_BANK_ASK = 0.5;
const gaL3 = (o, lang) => (o ? (lang === 'hi' ? o.hi : lang === 'hg' ? (o.hg || o.en) : o.en) || o.en || '' : '');
const gaAskOf = (e, lang) => { const q = e.q || {}; return ((lang === 'hi' ? q.hi : lang === 'hg' ? q.hg : q.en) || q.en || [])[0] || ''; };
/** One answer from the bank: the answer, why, what to do, and the buttons that do it. */
function gaBankAnswer(e, lang, L, near) {
  let html = `<div class="ga-a">${gaL3(e.a, lang)}</div>`;
  const why = gaL3(e.why, lang);
  if (why) html += `<div class="ga-why"><b>${L('Why', 'क्यों', 'Kyun')}</b>${why}</div>`;
  const st = e.steps ? gaL3(e.steps, lang) : null;
  if (st && st.length) html += `<div class="ga-do"><b>${L('What to do', 'क्या करें', 'Kya karein')}</b><ol>${st.map(s => `<li>${s}</li>`).join('')}</ol></div>`;
  if (e.admin) html += `<div class="ga-note">${L('Only an admin can do this — please ask your admin.', 'यह काम सिर्फ़ एडमिन कर सकते हैं — कृपया अपने एडमिन से कहें।', 'Ye kaam sirf admin kar sakte hain — kripya apne admin se kahiye.')}</div>`;
  const here = gaHere();
  const acts = [];
  const walk = typeof gaWalkFor === 'function' ? gaWalkFor(e) : null;   // a job with a walk-through: Do it with me, Show me
  if (walk) acts.push(...gaWalkActs(walk, L));
  else if (e.task && GUIDE_TASKS.some(t => t.id === e.task)) acts.push({ t: 'task', id: e.task, label: L('Guide me step by step', 'स्टेप-बाय-स्टेप करवाएँ', 'Step-by-step karwaiye') });
  if (!walk && e.sel && (!e.tab || e.tab === here) && guideTarget({ sel: e.sel })) acts.push({ t: 'fix', id: e.sel, label: L('Show me', 'दिखाएँ', 'Dikhaiye') });
  [e.tab, e.tab2].forEach(tb => {
    if (tb && tb !== here && guideMayOpen(tb) && acts.length < 3) acts.push({ t: 'open', tab: tb, label: L(`Open ${gaTabName(tb)}`, `${gaTabName(tb)} खोलें`, `${gaTabName(tb)} kholiye`) });
  });
  if (e.tab && e.tab === here && GUIDE_TOURS[e.tab] && acts.length < 3) acts.push({ t: 'tour', tab: e.tab, label: L('Show me round this screen', 'यह स्क्रीन घुमाकर दिखाएँ', 'Ye screen ghuma ke dikhaiye') });
  const after = near && near.length ? gaNearHtml(near, lang, L('Related', 'इससे जुड़े', 'Isse jude')) : '';
  return { html, acts, after, bank: e.id };
}
function gaNearHtml(near, lang, head) {
  return `<div class="ga-rel"><span>${head}</span>${near.map(n => { const t = gaAskOf(n.e, lang); return t ? `<button type="button" class="ga-chip" data-gq="${esc(t)}">${esc(t)}</button>` : ''; }).join('')}</div>`;
}
/* ---------- questions she could not answer, kept on this device so the bank can learn them ---------- */
function gaMissKeep(q, why) {
  try {
    const k = 'guideMiss', list = JSON.parse(localStorage.getItem(k) || '[]');
    list.push({ q: String(q).slice(0, 200), why, tab: gaHere(), at: new Date().toISOString().slice(0, 16) });
    localStorage.setItem(k, JSON.stringify(list.slice(-150)));
  } catch (e) { /* storage full or blocked: only the learning list */ }
}
function gaMissList(L) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('guideMiss') || '[]'); } catch (e) { /* none */ }
  if (!list.length) return { html: L('No unanswered questions on this device yet.', 'इस डिवाइस पर अभी कोई बिना जवाब वाला सवाल नहीं है।', 'Is device par abhi koi bina jawaab wala sawaal nahi hai.'), acts: [] };
  return { html: L(`Questions I could not answer well on this device (${list.length}) — send this list to whoever keeps my answers:`, `इस डिवाइस पर जिन सवालों का मैं ठीक जवाब नहीं दे पाई (${list.length}) — यह लिस्ट मेरे जवाब रखने वाले को भेजें:`, `Is device par jin sawaalon ka main theek jawaab nahi de paayi (${list.length}) — ye list mere jawaab rakhne wale ko bhejiye:`)
    + `<div class="ga-quote ga-miss">${list.slice(-40).reverse().map(m => `${esc(m.at)} · ${esc(m.tab || '-')} · ${esc(m.why)} · ${esc(m.q)}`).join('<br>')}</div>`, acts: [] };
}

/** The page in front of the person: a screen, or a page of its own that is not one (R-one's "My work today"). */
function gaHere() {
  try { if (typeof FR !== 'undefined' && FR && FR.shown) return 'mywork'; } catch (e) { /* no such page here */ }
  return typeof TAB_NOW !== 'undefined' ? TAB_NOW : '';
}
/** Open a screen — or that page. */
function gaGo(tab) {
  if (tab === 'mywork' && typeof frHomeShow === 'function') frHomeShow(); else showTab(tab);
}
/* ---------- the chat box ---------- */
let GA = { built: false, greeted: false };
function guideAskBuild() {
  if (GA.built || typeof document === 'undefined' || !document.body) return;
  GA.built = true;
  const box = document.createElement('div');
  box.id = 'gdAsk';
  box.className = 'hide';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Ask Meera');
  box.innerHTML = `<div class="ga-head">${GUIDE_FACE}<div class="ga-who"><b>Ask Meera</b><small>English · हिंदी · Hinglish</small></div>
      <button type="button" id="gaClose" class="ga-x" aria-label="Close">×</button></div>
    <div id="gaLog" class="ga-log" aria-live="polite"></div>
    <div id="gaChips" class="ga-chips"></div>
    <form id="gaForm" class="ga-form" autocomplete="off"><input id="gaQ" maxlength="300" placeholder="Ask anything… e.g. karigar ko kaam kaise de">
      <button type="submit" id="gaSend">Ask</button></form>`;
  document.body.appendChild(box);
  $('gaClose').onclick = guideAskClose;
  $('gaForm').onsubmit = e => { e.preventDefault(); const q = $('gaQ').value.trim(); if (q) { $('gaQ').value = ''; gaAsk(q); } };
  box.addEventListener('click', e => {
    const a = e.target.closest('[data-ga]');
    if (a) { if (a.dataset.ga === 'fb' && a.closest('.ga-fb')) a.closest('.ga-fb').remove(); gaAct(a.dataset.ga, a.dataset.id || '', a.dataset.tab || ''); return; }
    const c = e.target.closest('[data-gq]'); if (c) gaAsk(c.dataset.gq);
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') guideAskClose(); });
}
function guideAskOpen(q) {
  guideAskBuild();
  if (GUIDE.tour && GUIDE.tour.kind !== 'task') guideClose();   // a walk-round gives way to a question; a task guide stays
  $('gdAsk').classList.remove('hide');
  if ($('gdLaunch')) $('gdLaunch').classList.add('hide');   // the box opens where the launcher sits
  gaChipsDraw();
  if (!GA.greeted) {
    GA.greeted = true;
    const hi = guideLang() === 'hi';
    gaSay(hi ? 'नमस्ते! मैं मीरा हूँ। ERP के बारे में कुछ भी पूछें — इंग्लिश, हिंदी या हिंग्लिश में।' : 'Hi! I\'m Meera. Ask me anything about the ERP — in English, Hindi or Hinglish.', []);
    gaGuideLoad();
    gaBankLoad();
  }
  if (q) gaAsk(q);
  setTimeout(() => { try { $('gaQ').focus(); } catch (e) { /* closed again */ } }, 30);
}
function guideAskClose() { if ($('gdAsk')) $('gdAsk').classList.add('hide'); if ($('gdLaunch')) $('gdLaunch').classList.remove('hide'); }
/** Suggestions for the screen open now: its jobs first, then the usual trouble. */
function gaChipsDraw() {
  const hi = guideLang() === 'hi', tab = gaHere();
  const chips = GUIDE_TASKS.filter(t => t.steps.some(s => s.tab === tab)).map(t => hi ? t.title.hi : t.title.en);
  chips.unshift(hi ? 'यह सेव क्यों नहीं हो रहा?' : 'Why isn\'t this working?');
  chips.push(...(hi ? ['यह स्क्रीन क्या है?', 'स्क्रीन धीमी है', 'गलत एंट्री हो गई'] : ['What is this screen?', 'Screen is slow', 'I made a wrong entry']));
  $('gaChips').innerHTML = chips.slice(0, 5).map(c => `<button type="button" class="ga-chip" data-gq="${esc(c)}">${esc(c)}</button>`).join('');
}
function gaMine(t) { const d = document.createElement('div'); d.className = 'ga-msg ga-me'; d.textContent = t; $('gaLog').appendChild(d); $('gaLog').scrollTop = $('gaLog').scrollHeight; }
function gaSay(html, acts, after) {
  const d = document.createElement('div');
  d.className = 'ga-msg ga-she';
  d.innerHTML = html + (acts && acts.length ? '<div class="ga-acts">' + acts.map(a => `<button type="button" class="ga-act" data-ga="${a.t}" data-id="${esc(a.id || '')}" data-tab="${esc(a.tab || '')}">${esc(a.label)}</button>`).join('') + '</div>' : '') + (after || '');
  $('gaLog').appendChild(d);
  $('gaLog').scrollTop = $('gaLog').scrollHeight;
}
async function gaAsk(q) {
  gaMine(q);
  if (typeof gaAiCommand === 'function' && await gaAiCommand(q)) return;
  GA.lastQ = q;
  if (GA_WHEREAMI_RE.test(q) && gaHere()) {
    const lg = gaRead(q).lang, LL = (en, hi, hg) => (lg === 'hi' ? hi : lg === 'hg' ? (hg || en) : en), name = esc(gaTabName(gaHere()));
    const a = gaScreenAnswer(gaHere(), lg, LL);
    gaSay(LL(`You are on <b>${name}</b>.`, `आप <b>${name}</b> पर हैं।`, `Aap <b>${name}</b> par hain.`) + '<br>' + a.html, a.acts);
    return;
  }
  /* "this screen" means the one open now — when that is all the question asks ("ye screen kya hai"), not "keyboard
   * shortcut kya hai is page ke", which has an answer of its own */
  const rest = gaRead(q).means.filter(m => !['what', 'screen', 'show', 'help', 'about', 'how'].includes(m) && !/^(page|pej|पेज|about|samjha|samjhao|batao|bataiye|tell|explain)$/.test(m));
  const here = !rest.length && (/\b(this|is|yeh|ye|yah)\s+(screen|page)\b|यह स्क्रीन|ye screen|is screen/i.test(q)) && gaHere();
  const r = here && /what|kya|क्या|about|samjha|batao/i.test(q) ? gaScreenAnswer(here, gaRead(q).lang, (en, hi, hg) => { const l = gaRead(q).lang; return l === 'hi' ? hi : l === 'hg' ? (hg || en) : en; }) : await gaAnswer(q);
  if (r.miss) gaMissKeep(q, r.miss === true ? 'none' : r.miss);
  const lg = gaRead(q).lang, LL = (en, hi, hg) => (lg === 'hi' ? hi : lg === 'hg' ? hg : en);
  const fb = r.bank ? `<div class="ga-fb"><span>${LL('Did this help?', 'क्या इससे मदद मिली?', 'Kya isse madad mili?')}</span><button type="button" class="ga-fbb" data-ga="fb" data-id="up:${esc(r.bank)}" aria-label="Yes">👍</button><button type="button" class="ga-fbb" data-ga="fb" data-id="down:${esc(r.bank)}" aria-label="No">👎</button></div>` : '';
  /* not sure: she asks the AI herself, within the day's limit (guide-ai.js) — no answer at all: the AI's alone; a few close
   * ones offered: those, then the AI's below them. Without AI, or over the limit: as before. */
  const auto = !!r.miss && !r.off && typeof gaAiAuto === 'function' && gaAiAuto();   // not about the ERP: never to the AI
  if (auto && r.miss === true) { gaAiAsk(q, { html: r.html, acts: r.acts }); gaChipsDraw(); return; }
  gaSay(r.html, r.acts || [], (r.after || '') + fb);
  if (auto) gaAiAsk(q);
  if (r.miss) gaChipsDraw();
}
function gaAct(t, id, tab) {
  if (t === 'ai') { gaAiAsk(GA.lastQ || ''); return; }
  if (t === 'aifb') { gaAiFeedback(id); return; }
  if (t === 'aians') { gaAiAnswer(id); return; }
  if (t === 'fb') {
    const up = id.startsWith('up:'), lg = gaRead(GA.lastQ || '').lang, LL = (en, hi, hg) => (lg === 'hi' ? hi : lg === 'hg' ? hg : en);
    if (!up) gaMissKeep(GA.lastQ || '', 'not-helpful ' + id.slice(5));
    gaSay(up ? LL('Thank you! 🙏', 'धन्यवाद! 🙏', 'Dhanyavaad! 🙏')
      : LL('Sorry that did not help. I have noted your question. Please try asking in other words, or tell your admin what you needed.', 'माफ़ कीजिए, इससे मदद नहीं मिली। मैंने आपका सवाल नोट कर लिया है। दूसरे शब्दों में पूछकर देखें, या अपने एडमिन को बताएँ कि क्या चाहिए था।', 'Maaf kijiye, isse madad nahi mili. Maine aapka sawaal note kar liya hai. Doosre shabdon me poochh kar dekhiye, ya apne admin ko bataiye ki kya chahiye tha.'), []);
    return;
  }
  if (t === 'task') { guideAskClose(); guideTaskStart(id, GA.lastQ); }
  else if (t === 'wdo' || t === 'wshow' || t === 'wresume') gaWalkStart(id, t.slice(1), GA.lastQ);
  else if (t === 'tour') { guideAskClose(); if (gaHere() !== tab && guideMayOpen(tab)) { gaGo(tab); setTimeout(() => guideStart(tab, true), 600); } else guideStart(tab, true); }
  else if (t === 'open') { guideAskClose(); if (guideMayOpen(tab)) gaGo(tab); }
  else if (t === 'guide') window.open('/guide/#' + tab, '_blank');
  else if (t === 'fixel') { const el = (GA.fix || [])[+id]; if (el && guideVisible(el)) { guideAskClose(); guideRingOn(el); try { el.focus(); } catch (e) { /* not a box */ } } }
  else if (t === 'fix') { const el = guideTarget({ sel: id }); if (el) { guideAskClose(); guideRingOn(el); try { el.focus(); } catch (e) { /* not a box */ } } }
}

/* ---------- starting a task guide ---------- */
function guideTaskStart(id, q) {
  const t = GUIDE_TASKS.find(x => x.id === id); if (!t) return;
  guideBuild();
  guideRingOff(); GUIDE.paused = null; if ($('gdResume')) $('gdResume').classList.add('hide');
  GUIDE.tour = { kind: 'task', id, title: t.title, steps: t.steps.map(s => Object.assign({}, s)) };
  GUIDE.i = 0; GUIDE.dir = 1;
  guideShow();
  if (typeof guideFillFromQuestion === 'function') guideFillFromQuestion(GUIDE.tour, q);
}
/** May this account open that screen? The same rule showTab applies, asked first so a guide never lands somewhere else. */
function guideMayOpen(tab) {
  if (tab === 'mywork') return typeof frHomeShow === 'function';
  try {
    if (!ME || ME.admin || !ME.tabs || !ME.tabs.length) return true;
    return ME.tabs.includes(tab) || (tab === 'shop' && ME.tabs.includes('shopret')) || (tab === 'ord' && ME.tabs.includes('shopprod'));
  } catch (e) { return true; }
}
