/* ================= WHAT THE GUIDE CHARACTER SAYS (2026-10-21) =================
 *
 * GUIDE_TOURS: the first-visit walk-round of each screen (guide.js). A step is { sel, en, hi }: sel is the box it lights
 * up ('a || b' = the first of these that is on the screen; a step whose box is not on the screen is left out, so one
 * list serves an admin and a packer alike); no sel = Meera just talks. A screen not listed here gets a plain
 * walk-round read off the screen itself (guideSteps). The words follow /guide/, in its English and its Hindi.
 *
 * GUIDE_FIX: what to say when the same red message comes up three times. re is tried against the message; sel, when
 * given, is the box to light (else the box the person was last in). First match wins, so the narrow ones come first. */

const GUIDE_TOURS = {
  shop: [
    { en: 'This is <b>Shopify Orders</b> — the shipping queue for Shopify, CPC and Etsy. Let me show you round.',
      hi: 'यह <b>शॉपिफाई ऑर्डर</b> है — Shopify, CPC और Etsy के ऑर्डर की शिपिंग लिस्ट। चलिए, समझते हैं।' },
    { sel: '#soStoreSeg', en: 'Choose the store here: Ridhi, CPC, or both.', hi: 'यहाँ स्टोर चुनें: Ridhi, CPC, या दोनों।' },
    { sel: '#soFrom', en: 'These dates set which orders are loaded. Change a date and the orders load again by themselves.',
      hi: 'इन तारीखों से तय होता है कि कौन से ऑर्डर आएँगे। तारीख बदलते ही ऑर्डर अपने आप फिर से आ जाते हैं।' },
    { sel: '#soFilter', en: 'Type an order number, a SKU or a customer name to find it.', hi: 'ऑर्डर नंबर, SKU या ग्राहक का नाम लिखकर ढूँढें।' },
    { sel: '#soLanes', en: 'Each step shows only the orders at that stage. <b>Show all</b> brings everything back.',
      hi: 'हर स्टेप पर क्लिक करने से सिर्फ़ उस स्टेज के ऑर्डर दिखते हैं। <b>Show all</b> से सब वापस आ जाते हैं।' },
    { sel: '#soGo', en: '<b>Fetch orders</b> pulls the latest orders from Shopify. Press it if the list looks old.',
      hi: '<b>Fetch orders</b> से Shopify के नए ऑर्डर आते हैं। लिस्ट पुरानी लगे तो इसे दबाएँ।' },
    { sel: '#soTmpl || #soMoreMenu > summary || #soMoreMenu', en: 'Under <b>More</b>: pick the courier file (MCF, DHL, FedEx…), then press <b>Export</b>. Tick orders first, or it uses everything shown.',
      hi: '<b>More</b> में: कूरियर फ़ाइल चुनें (MCF, DHL, FedEx…), फिर <b>Export</b> दबाएँ। पहले ऑर्डर टिक करें, वरना स्क्रीन के सारे ऑर्डर जाएँगे।' },
    { sel: '#soTable', en: 'The orders. Click a row to open the order, set its shelf and status — each box saves as soon as you change it.',
      hi: 'यह ऑर्डर की लिस्ट है। लाइन पर क्लिक करके ऑर्डर खोलें, शेल्फ और स्टेटस भरें — हर बॉक्स बदलते ही सेव हो जाता है।' },
    { sel: '#soMsg', en: 'Watch this line: when something goes wrong it turns red and says what to do.',
      hi: 'इस लाइन पर नज़र रखें: कुछ गलत होने पर यह लाल हो जाती है और बताती है क्या करना है।' }
  ],
  pack: [
    { en: 'This is the <b>Packing List</b> — the boxes that go to Amazon FBA.', hi: 'यह <b>पैकिंग लिस्ट</b> है — Amazon FBA जाने वाले बॉक्स।' },
    { sel: '#pkSearch', en: 'Find a list by its title or invoice.', hi: 'टाइटल या इनवॉइस से लिस्ट ढूँढें।' },
    { sel: '#pkAccount', en: 'Choose the FBA account, Active or Completed lists, and the dates.', hi: 'FBA अकाउंट, Active या Completed लिस्ट, और तारीख चुनें।' },
    { sel: '#pkScanBtn', en: '<b>Scan to pack</b>: scan each piece’s label with the phone or the hand scanner. The list builds itself, with a picture on every scan.',
      hi: '<b>Scan to pack</b>: हर पीस का लेबल फ़ोन या हैंड स्कैनर से स्कैन करें। लिस्ट अपने आप बनती है, हर स्कैन पर फ़ोटो के साथ।' },
    { sel: '#pkNew', en: 'Or make a new list from a file — download the template first.', hi: 'या फ़ाइल से नई लिस्ट बनाएँ — पहले टेम्पलेट डाउनलोड करें।' },
    { sel: '#pkTable', en: 'Your saved packing lists. Click one to open its boxes.', hi: 'सेव की हुई पैकिंग लिस्ट। बॉक्स देखने के लिए किसी पर क्लिक करें।' }
  ],
  ord: [
    { en: 'This is the <b>Order Console</b> — every order line, from cutting to shipping.', hi: 'यह <b>ऑर्डर कंसोल</b> है — हर ऑर्डर लाइन, कटिंग से शिपिंग तक।' },
    { sel: '#odView', en: 'Switch the view: the Shopify list, the order book, or the printing and cloth reports.', hi: 'व्यू बदलें: Shopify लिस्ट, ऑर्डर बुक, या प्रिंटिंग और कपड़े की रिपोर्ट।' },
    { sel: '#odQ', en: 'Search by order, SKU or article.', hi: 'ऑर्डर, SKU या आर्टिकल से ढूँढें।' },
    { sel: '#odClear', en: 'The boxes beside it narrow the list. <b>Clear</b> puts them all back.', hi: 'पास के बॉक्स लिस्ट छोटी करते हैं। <b>Clear</b> से सब वापस।' },
    { sel: '#odDone', en: 'Tick the finished lines, then press <b>Completed</b> to hand them to shipping.', hi: 'तैयार लाइनें टिक करें, फिर <b>Completed</b> दबाकर शिपिंग को दें।' },
    { sel: '#odTable', en: 'The order lines themselves.', hi: 'यह ऑर्डर की लाइनें हैं।' }
  ],
  fgi: [
    { en: 'This is <b>Finished Goods</b> — the ready stock in the India store, every piece in and out.', hi: 'यह <b>तैयार माल</b> है — इंडिया स्टोर का तैयार स्टॉक, हर पीस का आना-जाना।' },
    { sel: '#fgView', en: 'Choose what to see: the store, pieces waiting to be counted, corrections, or every movement.', hi: 'क्या देखना है चुनें: स्टोर, गिनती के लिए रुके पीस, सुधार, या हर मूवमेंट।' },
    { sel: '#fgQ', en: 'Search by SKU, colour, size or tag.', hi: 'SKU, रंग, साइज़ या टैग से ढूँढें।' },
    { sel: '#fgScan', en: '<b>Scan in / out</b> records pieces coming into or leaving the store.', hi: '<b>Scan in / out</b> से स्टोर में आने या जाने वाले पीस दर्ज होते हैं।' },
    { sel: '#fgPack', en: 'Scan pieces against an order or an Amazon shipment — a wrong article is stopped.', hi: 'ऑर्डर या Amazon शिपमेंट के लिए पीस स्कैन करें — गलत आर्टिकल रुक जाता है।' },
    { sel: '#fgAlerts', en: 'These badges are things waiting on you. Click one to open it.', hi: 'ये बैज वो काम हैं जो आपका इंतज़ार कर रहे हैं। खोलने के लिए क्लिक करें।' },
    { sel: '#fgTable', en: 'The stock list.', hi: 'यह स्टॉक की लिस्ट है।' }
  ],
  pbase: [
    { en: 'This is the <b>Job Work Register</b> — pieces given to karigars, and what came back.', hi: 'यह <b>जॉब वर्क रजिस्टर</b> है — कारीगरों को दिए गए पीस, और क्या वापस आया।' },
    { sel: '#bwToggle', en: '<b>+ New Job Work</b> opens the form to give out work.', hi: '<b>+ New Job Work</b> से काम देने का फ़ॉर्म खुलता है।' },
    { sel: '#bwOrd', en: 'Every issue is against an order — pick the Order ID first.', hi: 'हर काम किसी ऑर्डर के लिए होता है — पहले Order ID चुनें।' },
    { sel: '#bwEmp', en: 'Then the worker type and the karigar’s name, from the list.', hi: 'फिर कारीगर का टाइप और नाम, लिस्ट से।' },
    { sel: '#bwPcs', en: 'How many pieces. It cannot be more than what is left on the order.', hi: 'कितने पीस। यह ऑर्डर में बचे पीस से ज़्यादा नहीं हो सकता।' },
    { sel: '#bwSave', en: '<b>Issue</b> saves it. If something is missing, the red line beside it says what.', hi: '<b>Issue</b> से सेव होता है। कुछ छूटा हो तो पास की लाल लाइन बताएगी।' },
    { sel: '#pbQ', en: 'Search the register by karigar, item, SKU or order.', hi: 'कारीगर, आइटम, SKU या ऑर्डर से रजिस्टर में ढूँढें।' },
    { sel: '#pbTable', en: 'The register itself.', hi: 'यह रजिस्टर है।' }
  ],
  flow: [
    { en: 'This is <b>Production flow</b> — every PO line through its stages.', hi: 'यह <b>प्रोडक्शन फ़्लो</b> है — हर PO लाइन, हर स्टेज पर।' },
    { sel: '#flBuckets', en: 'Click a stage to see only the lines at that step.', hi: 'किसी स्टेज पर क्लिक करें, सिर्फ़ उसी स्टेप की लाइनें दिखेंगी।' },
    { sel: '#flQ', en: 'Search PO, SKU, colour, fabric or printer.', hi: 'PO, SKU, रंग, फ़ैब्रिक या प्रिंटर से ढूँढें।' },
    { sel: '#flXlOut', en: 'Download the lines to Excel — or bring a filled plan back with the button beside it.', hi: 'लाइनें Excel में डाउनलोड करें — या भरा हुआ प्लान पास वाले बटन से वापस डालें।' },
    { sel: '#flTable', en: 'The lines themselves.', hi: 'यह लाइनें हैं।' }
  ],
  qc: [
    { en: 'This is <b>Quality Control</b> — checks, alteration, and pieces coming back mended.', hi: 'यह <b>क्वालिटी कंट्रोल</b> है — चेकिंग, ऑल्टरेशन, और ठीक होकर आए पीस।' },
    { sel: '#qcView', en: 'Choose: waiting for QC, the ledger, checks, or alteration.', hi: 'चुनें: QC के लिए रुके, लेजर, चेक, या ऑल्टरेशन।' },
    { sel: '#qcwToggle', en: '<b>+ Record a check</b>: the item, the order, who checked, and how many passed, need alteration, or were rejected.',
      hi: '<b>+ Record a check</b>: आइटम, ऑर्डर, किसने चेक किया, और कितने पास, ऑल्टरेशन या रिजेक्ट।' },
    { sel: '#qciToggle', en: 'Send faulty pieces for alteration here, and receive them back with the button beside it.', hi: 'खराब पीस ऑल्टरेशन के लिए यहाँ से भेजें, और पास वाले बटन से वापस लें।' },
    { sel: '#qcTable', en: 'The list for the view you chose.', hi: 'चुने हुए व्यू की लिस्ट।' }
  ],
  fba: [
    { en: 'This is <b>FBA Dispatch</b> — stock going from the India store to Amazon.', hi: 'यह <b>FBA डिस्पैच</b> है — इंडिया स्टोर से Amazon जाने वाला स्टॉक।' },
    { sel: '#fbaStatus', en: 'Choose waiting, accepted, shipped or returned.', hi: 'waiting, accepted, shipped या returned चुनें।' },
    { sel: '#fbaQ', en: 'Search by SKU, shipment, colour or size.', hi: 'SKU, शिपमेंट, रंग या साइज़ से ढूँढें।' },
    { sel: '#fbaAccept', en: 'Tick rows, then accept, ship or return them with these buttons.', hi: 'लाइनें टिक करें, फिर इन बटन से accept, ship या return करें।' },
    { sel: '#fbaTable', en: 'The stock lines.', hi: 'स्टॉक की लाइनें।' }
  ],
  repl: [
    { en: 'This is <b>Replenishment</b> — which Amazon SKUs need reordering, by air or sea.', hi: 'यह <b>रीप्लेनिशमेंट</b> है — Amazon के कौन से SKU दोबारा मँगाने हैं, एयर या सी से।' },
    { sel: '#rFilter', en: 'Type a SKU, ASIN or product name.', hi: 'SKU, ASIN या प्रोडक्ट का नाम लिखें।' },
    { sel: '#rNeed', en: 'Choose the brand, what needs reordering, and the marketplace. <b>Clear filters</b> shows everything again.',
      hi: 'ब्रांड, क्या मँगाना है, और मार्केटप्लेस चुनें। <b>Clear filters</b> से सब फिर दिखेगा।' },
    { sel: '#rGo', en: '<b>Refresh from sheet</b> loads the latest stock and sales.', hi: '<b>Refresh from sheet</b> से नया स्टॉक और सेल आती है।' },
    { sel: '#rPo', en: 'Make a purchase order from what is on screen.', hi: 'स्क्रीन पर जो है उससे परचेज़ ऑर्डर बनाएँ।' },
    { sel: '#rTable', en: 'Each row is a SKU with its stock and forecast.', hi: 'हर लाइन एक SKU है, उसके स्टॉक और अनुमान के साथ।' }
  ],
  pmdb: [
    { en: 'This is the <b>Master Database</b> — every SKU with its article, colour, size, fabric and ASIN.', hi: 'यह <b>मास्टर डेटाबेस</b> है — हर SKU, उसके आर्टिकल, रंग, साइज़, फ़ैब्रिक और ASIN के साथ।' },
    { sel: '#ptmQ', en: 'Search SKU, article or fabric.', hi: 'SKU, आर्टिकल या फ़ैब्रिक से ढूँढें।' },
    { sel: '#ptmView', en: 'Switch between the master, custom SKUs, fabric for printing, cloth per piece and recipes.', hi: 'मास्टर, कस्टम SKU, प्रिंटिंग फ़ैब्रिक, पीस का कपड़ा और रेसिपी के बीच बदलें।' },
    { sel: '#ptmNew', en: '<b>+ New SKU</b> adds one product.', hi: '<b>+ New SKU</b> से एक प्रोडक्ट जुड़ता है।' },
    { sel: '#ptmRename', en: '<b>Change SKU</b> renames a code everywhere — use it carefully.', hi: '<b>Change SKU</b> से कोड हर जगह बदल जाता है — ध्यान से इस्तेमाल करें।' },
    { sel: '#ptmTable', en: 'The master list.', hi: 'यह मास्टर लिस्ट है।' }
  ],
  att: [
    { en: 'This is <b>Attendance</b> — punch staff in and out each day.', hi: 'यह <b>अटेंडेंस</b> है — रोज़ स्टाफ़ का आना-जाना।' },
    { sel: '#attDay', en: 'Pick the day, or press <b>Today</b>.', hi: 'दिन चुनें, या <b>Today</b> दबाएँ।' },
    { sel: '#attView', en: 'The day’s punches, or the month’s totals.', hi: 'दिन की पंचिंग, या महीने का जोड़।' },
    { sel: '#attQ', en: 'Search a name.', hi: 'नाम ढूँढें।' },
    { sel: '#attTable', en: 'Press <b>In</b> or <b>Out</b> on a person’s row. In comes first, once a day.', hi: 'किसी की लाइन पर <b>In</b> या <b>Out</b> दबाएँ। पहले In, दिन में एक बार।' }
  ],
  rep: [
    { en: 'This is <b>Reports</b> — production, QC, stock value and dispatch.', hi: 'यह <b>रिपोर्ट</b> है — प्रोडक्शन, QC, स्टॉक वैल्यू और डिस्पैच।' },
    { sel: '#repView', en: 'Choose which report.', hi: 'कौन सी रिपोर्ट, चुनें।' },
    { sel: '#repWk || #repMonth', en: 'Pick the week or month, and the brand.', hi: 'हफ़्ता या महीना, और ब्रांड चुनें।' },
    { sel: '#repExport', en: 'Download what you see.', hi: 'जो दिख रहा है वो डाउनलोड करें।' }
  ],
  so: [
    { en: 'This is <b>Sales Orders</b> — raise, approve and track bulk orders.', hi: 'यह <b>सेल्स ऑर्डर</b> है — बड़े ऑर्डर बनाना, मंज़ूर करना और ट्रैक करना।' },
    { sel: '#sxNew', en: '<b>+ New sales order</b> starts one.', hi: '<b>+ New sales order</b> से नया ऑर्डर शुरू होता है।' },
    { sel: '#sxStatus', en: 'Filter by status, channel, air or sea, and month.', hi: 'स्टेटस, चैनल, एयर या सी, और महीने से छाँटें।' },
    { sel: '#sxQtyTpl', en: 'Download the quantity sheet, fill it, and bring it back with <b>Import</b>.', hi: 'क्वांटिटी शीट डाउनलोड करें, भरें, और <b>Import</b> से वापस डालें।' },
    { sel: '#sxTable', en: 'The orders.', hi: 'ऑर्डर की लिस्ट।' }
  ],
  dash: [
    { en: 'This is the <b>Dashboard</b> — today’s picture of every register.', hi: 'यह <b>डैशबोर्ड</b> है — हर रजिस्टर की आज की तस्वीर।' },
    { sel: '#dashGo', en: '<b>Refresh</b> reloads today’s figures.', hi: '<b>Refresh</b> से आज के आँकड़े फिर से आते हैं।' },
    { sel: '#dashBody', en: 'Click any card to jump to the screen it comes from.', hi: 'किसी भी कार्ड पर क्लिक करें, उसी स्क्रीन पर पहुँच जाएँगे।' },
    { sel: '#audView', en: 'Down here: who changed what, and the recycle bin.', hi: 'यहाँ नीचे: किसने क्या बदला, और रीसायकल बिन।' }
  ]
};

const GUIDE_FIX = [
  { re: /select an order id|pick the correct order id|pick the order id it is for/i, sel: '#bwOrd || #cwOrd',
    en: 'Every entry belongs to an order. Open the <b>Order ID</b> box and pick the order these pieces are for.',
    hi: 'हर एंट्री किसी ऑर्डर की होती है। <b>Order ID</b> बॉक्स खोलें और वो ऑर्डर चुनें जिसके ये पीस हैं।' },
  { re: /already issued|ordered .* pcs/i, sel: '#bwPcs',
    en: 'You are giving out more pieces than are left on this order. Lower the <b>pieces</b>.',
    hi: 'आप ऑर्डर में बचे पीस से ज़्यादा दे रहे हैं। <b>पीस</b> कम करें।' },
  { re: /select the employment type/i, sel: '#bwType || #qciType',
    en: 'Choose the worker type first — the names list depends on it.', hi: 'पहले कारीगर का टाइप चुनें — नामों की लिस्ट उसी से आती है।' },
  { re: /enter the employee|is not on the .* list/i, sel: '#bwEmp',
    en: 'Pick the name from the list, don’t type a new one. If the name is missing, check the worker type above it.',
    hi: 'नाम लिस्ट से चुनें, नया मत लिखें। नाम नहीं दिख रहा तो ऊपर का टाइप देखें।' },
  { re: /select the (article type|article subtype|colour|size)|no sku/i, sel: '#bwSku || #cwSku',
    en: 'The item is not complete. Fill article, subtype, colour and size one by one — or just type the SKU.',
    hi: 'आइटम पूरा नहीं है। आर्टिकल, सबटाइप, रंग और साइज़ एक-एक करके भरें — या सीधे SKU लिखें।' },
  { re: /how many pieces|enter .* pieces/i, sel: '#bwPcs || #cwPcs',
    en: 'Type how many pieces — a number, 1 or more.', hi: 'कितने पीस, लिखें — 1 या उससे ज़्यादा।' },
  { re: /not in the master database/i,
    en: 'That SKU is not in the Master Database. Check the spelling letter by letter; if it is a new product, it must be added in Master Database first.',
    hi: 'यह SKU मास्टर डेटाबेस में नहीं है। स्पेलिंग अक्षर-अक्षर देखें; नया प्रोडक्ट है तो पहले मास्टर डेटाबेस में जोड़ना होगा।' },
  { re: /already saved a moment ago/i,
    en: 'Nothing is wrong — it is already saved. Look in the register below; do not save it again.',
    hi: 'कुछ गलत नहीं — यह पहले ही सेव हो चुका है। नीचे रजिस्टर में देखें; दोबारा सेव न करें।' },
  { re: /fabric type master|pick the fabric/i, sel: '#cwFabric',
    en: 'Choose the fabric from the list. A new fabric has to be added to the Fabric Type master first.',
    hi: 'फ़ैब्रिक लिस्ट से चुनें। नया फ़ैब्रिक हो तो पहले Fabric Type मास्टर में जोड़ें।' },
  { re: /is frozen/i,
    en: 'That month is locked. Use a date in this month, or ask an admin to open it.',
    hi: 'वो महीना बंद है। इस महीने की तारीख डालें, या एडमिन से खुलवाएँ।' },
  { re: /pressing is no longer recorded/i,
    en: 'Pressing is not entered here any more — record the pieces in <b>Quality Control</b>.',
    hi: 'प्रेसिंग अब यहाँ नहीं भरी जाती — पीस <b>क्वालिटी कंट्रोल</b> में दर्ज करें।' },
  { re: /pick which one these pieces are for/i, sel: '#qcwOrd',
    en: 'This item is on more than one order. Choose the order these checked pieces belong to.',
    hi: 'यह आइटम एक से ज़्यादा ऑर्डर में है। चुनें कि ये पीस किस ऑर्डर के हैं।' },
  { re: /available to check|is more than the .* checked/i, sel: '#qcwChecked',
    en: 'The counts do not add up. You cannot check more than came in, and alteration + rejected cannot be more than you checked.',
    hi: 'गिनती मेल नहीं खा रही। जितने आए उससे ज़्यादा चेक नहीं हो सकते, और ऑल्टरेशन + रिजेक्ट, चेक किए से ज़्यादा नहीं हो सकते।' },
  { re: /available to issue|flagged for alteration/i,
    en: 'Only pieces marked for alteration in a QC check can be sent. Record the check first, or send fewer.',
    hi: 'सिर्फ़ वही पीस भेज सकते हैं जो QC चेक में ऑल्टरेशन के लिए लिखे हों। पहले चेक भरें, या कम पीस भेजें।' },
  { re: /mended \+ still wrong/i, sel: '#qcrOk',
    en: 'Mended plus still wrong must equal the pieces that came back. Check the three numbers.',
    hi: 'ठीक हुए + अभी भी खराब = वापस आए पीस। तीनों नंबर देखें।' },
  { re: /plus rejected .* more than/i,
    en: 'Received plus rejected cannot be more than the pieces given out. Lower one of them.',
    hi: 'आए + रिजेक्ट, दिए गए पीस से ज़्यादा नहीं हो सकते। किसी एक को कम करें।' },
  { re: /already punched (in|out)|not been punched in/i, sel: '#attDay',
    en: 'Check the day at the top first. Each person is punched <b>In</b> once, then <b>Out</b> once — In always comes first.',
    hi: 'पहले ऊपर दिन देखें। हर व्यक्ति का एक बार <b>In</b>, फिर एक बार <b>Out</b> — पहले हमेशा In।' },
  { re: /no sku and qty columns|no usable rows|could not read that file/i,
    en: 'The file is not in the right shape. Download the template, fill it without changing the headings, and upload that.',
    hi: 'फ़ाइल सही ढाँचे में नहीं है। टेम्पलेट डाउनलोड करें, हेडिंग बदले बिना भरें, और वही अपलोड करें।' },
  { re: /could not reach shopify/i, sel: '#soGo',
    en: 'The internet dropped while talking to Shopify. Check the connection, then press <b>Fetch orders</b> once.',
    hi: 'Shopify से बात करते समय इंटरनेट टूट गया। कनेक्शन देखें, फिर एक बार <b>Fetch orders</b> दबाएँ।' },
  { re: /nothing to write/i, sel: '#soFilter',
    en: 'No orders are on screen to export. Widen the filters or the dates, or fetch orders first.',
    hi: 'एक्सपोर्ट के लिए स्क्रीन पर कोई ऑर्डर नहीं। फ़िल्टर या तारीख बढ़ाएँ, या पहले ऑर्डर लाएँ।' },
  { re: /blocked the print tab|allow pop-?ups/i,
    en: 'The browser stopped the print window. Click the small icon at the right of the address bar and choose <b>Always allow pop-ups</b>.',
    hi: 'ब्राउज़र ने प्रिंट विंडो रोक दी। एड्रेस बार के दाईं ओर छोटे आइकन पर क्लिक करके <b>Always allow pop-ups</b> चुनें।' },
  { re: /no boxes in it/i,
    en: 'This list has no boxes yet. Add boxes, or start with <b>Scan to pack</b>.', hi: 'इस लिस्ट में अभी कोई बॉक्स नहीं। बॉक्स जोड़ें, या <b>Scan to pack</b> से शुरू करें।' },
  { re: /not one this list wants|wrong article|not on this list|not wanted/i,
    en: 'That label does not belong on this list. Put the piece aside, check the label against the picture, and scan the right piece.',
    hi: 'यह लेबल इस लिस्ट का नहीं है। पीस अलग रखें, लेबल को फ़ोटो से मिलाएँ, और सही पीस स्कैन करें।' },
  { re: /permission|ask an admin/i,
    en: 'Your account is not allowed to do this. It is not a mistake you can fix here — ask an admin to give you the right.',
    hi: 'आपके अकाउंट को यह करने की अनुमति नहीं है। यह यहाँ ठीक नहीं होगा — एडमिन से अनुमति माँगें।' }
];
