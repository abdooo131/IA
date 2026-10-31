# Standard operating procedures for every role, in English and Arabic. One source:
# build.py writes them into the web app's messages (shown at /help) and into docs/sop/*.md.
# Shape per role: title, who, day (the daily routine), escalation (who tells whom), and
# sections of: title, steps (do this, in order), check (how to know it went right),
# problems (if this happens, do that and tell whom). Both languages keep the same shape.

EN = {
  "store_staff": {
    "title": "Dark store staff",
    "who": "Receivers, pickers and packers in a dark store or the hub. Your store opens from Home after you sign in.",
    "day": [
      "Start of shift (first 10 minutes): sign in, open your store, read Orders (red = late), check the scanner reads a barcode, check the Receive and Put away counts.",
      "Every hour: Orders first, always. Between orders: put away, then returns and transfers, then counts.",
      "Before a rider leaves: every packed order has its photo and was handed over by scanning the badge.",
      "End of shift (last 15 minutes): receive cash from every rider who is back, put away everything in receiving, receive goods back from failed deliveries, and write a ticket to the next shift lead about anything open."
    ],
    "escalation": [
      "An order will be late, or a product is missing on the shelf: tap Missing on the order (admin is alerted automatically) and tell your store lead.",
      "A shipment arrives without a shipment number from the merchant: do not take it; open a ticket to admin with the merchant name and number of boxes.",
      "Cash does not match: enter what you counted; finance reviews it. Do not change the count.",
      "Scanner, phone or internet down for more than 10 minutes: call your store lead; they open an urgent ticket to admin.",
      "Anything you are not sure about: ticket to your store lead before you act."
    ],
    "sections": [
      {"title": "Receive a merchant shipment",
       "steps": [
         "Ask the driver for the merchant's shipment reference. No shipment in Receive for that merchant means no receiving: call admin.",
         "Open Receive and choose that shipment. Check the merchant name matches the boxes.",
         "Open one box at a time. Scan every unit. Each scan adds 1 to the receiving bin.",
         "Damaged on arrival: put it aside; after closing, report it in Damaged and held with cause Arrived damaged.",
         "When all boxes are empty, tap Close shipment and confirm."],
       "check": [
         "The screen shows received against expected for every product.",
         "The shipment's status bar shows Received.",
         "The receiving bin count went up by what you scanned (Put away shows it)."],
       "problems": [
         "Barcode refused (not in catalog): put the item aside, take a photo of the label, and open a ticket to admin with the merchant name.",
         "More units than expected: receive them anyway; the merchant sees them as extra.",
         "You closed by mistake: tell admin by ticket at once; do not receive the rest on another shipment."]},
      {"title": "Put away",
       "steps": [
         "Open Put away. Pick up the units from the receiving bin.",
         "Scan the product, then scan the shelf label where you place it.",
         "Repeat until the receiving bin is empty."],
       "check": [
         "Put away on Home shows 0 units to shelve.",
         "The product is on the shelf whose label you scanned."],
       "problems": [
         "Shelf full: use the next empty shelf and scan that one.",
         "No shelf label: print it from Bin labels before placing anything there."]},
      {"title": "Pick an order",
       "steps": [
         "Open Orders and tap the top order (oldest first, red is late). Tap Accept if it is new.",
         "Go to the shelf shown. Scan the shelf (optional), then each product.",
         "If a product is not there, tap Missing for it. Never replace it with something else."],
       "check": [
         "Every line shows picked equal to ordered (or the missing units are marked).",
         "The status bar moves to Picking, then Packed after packing."],
       "problems": [
         "Wrong product scanned: the screen refuses it; scan the right one.",
         "Product damaged on the shelf: tap Missing, then report it in Damaged and held with cause Store handling."]},
      {"title": "Pack and hand to the rider",
       "steps": [
         "Pack all items, close the bag and stick the order label.",
         "Take a clear photo of the closed bag. Packing does not finish without it.",
         "When the rider arrives, scan the rider's badge.",
         "Give the bags and say the number of bags out loud."],
       "check": [
         "The status bar shows Out for delivery.",
         "The rider's screen shows the order with the right number of units."],
       "problems": [
         "The screen refuses to add an order to a rider's trip: an order on the trip would be late; give it to another rider.",
         "Wrong badge scanned: call admin; do not let the rider leave with the order."]},
      {"title": "Cash from riders",
       "steps": [
         "Open Cash and choose the rider.",
         "Count the money in front of the rider, twice.",
         "Type exactly what you counted and save.",
         "Put the cash in the store box at once."],
       "check": [
         "The handover shows Balanced, or Waiting if it differs (finance reviews it).",
         "The store box total in Cash went up by the amount."],
       "problems": [
         "Short or over: save the real count anyway, write a note (what the rider said), and the difference goes to finance.",
         "Rider refuses to wait for the count: do not save; tell the store lead."]},
      {"title": "Failed deliveries and returns to merchants",
       "steps": [
         "When a rider brings goods back: open the order and tap Receive goods back.",
         "Merchant return: open Returns, choose the return, scan each unit listed.",
         "When ready, hand it to the merchant's driver and type the driver's full name."],
       "check": [
         "The order shows the goods are back; the return shows Collected."],
       "problems": [
         "Goods not back within 2 hours of a failed attempt: admin gets an alert; find the rider and ask."]},
      {"title": "Damaged stock, counts and transfers",
       "steps": [
         "Damaged: open Damaged and held, scan the unit, choose the cause, save.",
         "Count: open Stock count, scan the bin, scan every unit you find; you are not shown the expected number.",
         "Transfer to send: open Transfers, pick by scan, tap Send.",
         "Transfer received: scan every unit into receiving, close it, then put away."],
       "check": [
         "Damaged units are no longer on sale.",
         "The count shows Submitted; admin approves differences.",
         "The transfer status bar shows In transit (sent) or Received."],
       "problems": [
         "Units for a transfer not found: send what you have; the missing units are released and admin is told."]}
    ]},
  "rider": {
    "title": "Rider",
    "who": "Riders delivering 60 minute orders from one dark store.",
    "day": [
      "Start of shift: sign in, allow location, check your phone battery is above 50% and you have change for cash orders.",
      "For every trip: take orders only by badge scan at the store; check the number of bags.",
      "After every trip: come back to the store, give back failed goods, and hand any cash over if your lead asks.",
      "End of shift: hand all cash to the store and watch it being counted. Nothing stays with you overnight."
    ],
    "escalation": [
      "Customer not answering after the calls the app asks for: mark it failed with the door photo; the store lead decides the next step.",
      "Accident, police or danger: stop, stay safe, call your store lead at once.",
      "Wrong amount of cash collected: type exactly what you got; finance will review it.",
      "App not working: call the store lead; do not hand over a package without the code or a photo."
    ],
    "sections": [
      {"title": "Deliver an order",
       "steps": [
         "Open the order and tap Directions.",
         "At the address, call from the app if you cannot find it.",
         "Ask for the 4 digit customer code and type it, or take a photo of the handover.",
         "Cash order: take exactly the amount shown, type what you got, tap Delivered."],
       "check": [
         "The order moves to Finished today as Delivered.",
         "Today's cash total went up by the amount."],
       "problems": [
         "Code wrong: check it again with the customer; never deliver without the code or a photo.",
         "Customer has no change: do not give change from the company cash; call the store lead."]},
      {"title": "When you cannot deliver",
       "steps": [
         "Customer not answering: call from the app as many times as it asks, then take a photo of the door.",
         "Tap Could not deliver, choose the reason, add details if Other.",
         "Bring the goods back to the store on the same trip."],
       "check": [
         "The order shows Attempt failed or Failed.",
         "Store staff tapped Receive goods back."],
       "problems": [
         "You cannot get back to the store: call the store lead; never keep goods overnight."]},
      {"title": "Cash at the end of the shift",
       "steps": [
         "Go to the store with all the cash you collected.",
         "Hand it over and watch it being counted.",
         "Check that the counted total matches your app's total for today."],
       "check": [
         "The store's screen shows Balanced."],
       "problems": [
         "Difference: tell staff what happened so they write it in the note; finance decides."]}
    ]},
  "merchant": {
    "title": "Merchant",
    "who": "Shops selling with Shiply Now 60 minute delivery.",
    "day": [
      "Every morning: check Orders and Notifications; check stock you are low on in Products.",
      "Before sending stock: create the shipment first, then send.",
      "Every week: check your Wallet and statement; make sure your payout schedule is right."
    ],
    "escalation": [
      "A question about an order or money: write to Shiply support (your account manager) with the order or payout number.",
      "Something missing after a shipment was received: reply with the shipment number and the product SKU within 48 hours."
    ],
    "sections": [
      {"title": "Start selling",
       "steps": [
         "Add your products (one by one, by file, or by linking your Shopify store). Every product needs a barcode.",
         "Set your 60 minute delivery price in Delivery.",
         "Create your first shipment so we can receive stock."],
       "check": [
         "The checklist on Home is all ticked."],
       "problems": [
         "A barcode is refused: it already belongs to another product; use the real barcode on the item."]},
      {"title": "Send stock",
       "steps": [
         "Shipments, New shipment: list each product and quantity.",
         "Write the shipment number on every box.",
         "Send the boxes to the address shown."],
       "check": [
         "The shipment goes Expected, Receiving, Received.",
         "You get a summary: expected against received."],
       "problems": [
         "Extra units: they are received and shown as extra; nothing to do."]},
      {"title": "Orders and money",
       "steps": [
         "Shopify orders with the 60 minute option arrive by themselves; you can also add one in New order.",
         "You can cancel only new or accepted orders.",
         "Wallet shows what we owe you; payouts go to your bank on your schedule."],
       "check": [
         "Each payout shows a bank reference."],
       "problems": [
         "A payout looks wrong: download the statement for the period and send it with your question."]}
    ]},
  "finance": {
    "title": "Finance",
    "who": "The finance team and the accountant. Everything is in Finance.",
    "day": [
      "Every morning (30 minutes): Overview; review every cash difference in Cash; deposit yesterday's store cash to the bank (choose the bank, write the slip number).",
      "Payout days: Payouts, prepare due payouts, check each, transfer from the bank, mark paid with the bank reference.",
      "Every bill or money movement the same day it happens: Money movements, with the paper receipt's number as reference.",
      "End of month: trial balance, profit and loss, balance sheet, bank statement check, CSVs to the accountant."
    ],
    "escalation": [
      "A rider is short more than once in a week: ticket to admin with the CH- numbers.",
      "A payout bounced or a bank figure does not match: ticket to admin; do not book a correction until you know why.",
      "The trial balance does not balance: stop and open an urgent ticket to admin (it should never happen)."
    ],
    "sections": [
      {"title": "Review a cash difference",
       "steps": [
         "Cash, Waiting for you: open the handover (CH-...).",
         "Read the note and talk to the store lead if needed.",
         "Write it off (company loss) or keep it on the rider, always with a reason."],
       "check": [
         "The handover leaves the waiting list; the rider's cash in Riders is right."],
       "problems": [
         "You are not sure who is right: ticket to the store lead; decide only after the answer."]},
      {"title": "Deposit store cash to the bank",
       "steps": [
         "Cash, the store, enter the amount and the bank slip number, choose the bank, Deposit.",
         "Keep the slip; write the JV number on it."],
       "check": [
         "The store box goes down and the bank account (Chart of accounts) goes up by the same amount."],
       "problems": [
         "Deposited to the wrong bank: book a Transfer between the two banks with the reason; never delete."]},
      {"title": "Record money movements",
       "steps": [
         "Transfer: from one bank or box to another.",
         "Expense: choose the category and where it was paid from; enter VAT if the bill shows it.",
         "Owner money: capital in or drawings out.",
         "Journal entry: corrections, with a written reason. Debits must equal credits."],
       "check": [
         "You get a voucher number (JV-...). Write it on the receipt and file it.",
         "The account statement shows the line with the right balance after it."],
       "problems": [
         "Not enough money in the account: the screen refuses; check the date and the account."]},
      {"title": "Merchant payouts",
       "steps": [
         "Payouts, prepare due payouts for the day.",
         "Open each draft (PAY-...) and compare with the merchant's statement.",
         "Transfer from the bank, then Mark paid with the bank reference and the bank used."],
       "check": [
         "The payout shows Paid; the merchant's balance dropped by the amount."],
       "problems": [
         "Amount looks wrong: cancel the draft with a note and open a ticket to admin."]},
      {"title": "Month end",
       "steps": [
         "Trial balance for the month: debits must equal credits.",
         "Profit and loss for the month; balance sheet at the last day.",
         "Compare each bank account statement in Shiply with the real bank statement; book bank charges as an Expense in 5501.",
         "Download the journal and statements as CSV for the accountant."],
       "check": [
         "Bank balances in Shiply equal the bank statements.",
         "The balance sheet says Assets equal liabilities plus equity."],
       "problems": [
         "A difference you cannot explain: ticket to admin with the account code and the amount."]}
    ]},
  "admin": {
    "title": "Admin",
    "who": "Operations admins. You can open every area.",
    "day": [
      "Every morning: Overview, then Alerts (handle each one), then Tickets (For me).",
      "Every hour at peak: Orders, late ones first; call the store lead of any red store.",
      "Every evening after 21:00: Transfers, approve or edit tonight's refill drafts.",
      "Every week: Merchants (sign ups), Counts (approve differences), Damage (settle), Settings (check nothing changed by mistake)."
    ],
    "escalation": [
      "You receive what nobody else can decide: missing stock, money differences, merchant complaints, broken equipment.",
      "Use Tickets to ask anyone; every ticket has an answer time and a reminder.",
      "Shopify, payments or the server down: ticket to the tech lead (urgent) and tell the stores to take manual orders only after you say so."
    ],
    "sections": [
      {"title": "Stores, hubs and zones",
       "steps": [
         "Dark stores and hubs: open a location with a short code (letters and numbers), the address and the map position.",
         "Zones: draw each store's delivery area.",
         "Address map: run the OpenStreetMap import once, then approve the names it learns each week."],
       "check": [
         "Try an address on the Address map page: it lands in the right store."],
       "problems": [
         "An area is served by two stores: fix the zone borders so they do not overlap."]},
      {"title": "Merchants, products and Shopify",
       "steps": [
         "Merchants: approve or reject sign ups with a reason.",
         "Shopify: link the merchant to their store, send them the install link, then create locations.",
         "Products: import the product file; every barcode must be unique."],
       "check": [
         "The Shopify card shows locations and linked products."],
       "problems": [
         "A merchant moved to a new Shopify store: Disconnect store, then link the new one."]},
      {"title": "Stock",
       "steps": [
         "Counts: approve or reject each difference.",
         "Damage: confirm the cause; company causes credit the merchant.",
         "Transfers: approve, edit quantities, or cancel before picking starts."],
       "check": [
         "Stock on the Stock page matches what staff see on the shelves."],
       "problems": [
         "A count is stale: ask the store to count the bin again."]},
      {"title": "Users and settings",
       "steps": [
         "Users: create staff (with a store), riders (store and badge), merchants and finance users; add each person's Slack member ID.",
         "Settings: SLA minutes, capacity, fees, refill levels and ticket answer times."],
       "check": [
         "The audit log shows every change with who made it."],
       "problems": [
         "Someone leaves: disable the user the same day; they are signed out everywhere."]}
    ]}
}

AR = {
  "store_staff": {
    "title": "موظفين الدارك ستور",
    "who": "الاستلام والتجهيز والتغليف جوه الدارك ستور أو المركز. فرعك بيتفتح من الرئيسية بعد ما تدخل.",
    "day": [
      "أول الشيفت (أول 10 دقايق): ادخل، افتح فرعك، اقرا الطلبات (الأحمر متأخر)، اتأكد الاسكانر بيقرا، وبص على عدد الاستلام والتخزين.",
      "كل ساعة: الطلبات الأول دايما. بين الطلبات: التخزين، بعدين المرتجعات والتحويلات، بعدين الجرد.",
      "قبل ما المندوب يمشي: كل طلب متغلف ليه صورة واتسلم بسكان الكارنيه.",
      "آخر الشيفت (آخر 15 دقيقة): استلم الفلوس من كل مندوب رجع، خزن كل اللي في الاستلام، استلم البضاعة الراجعة، واكتب تذكرة لمسؤول الشيفت اللي بعدك بأي حاجة مفتوحة."
    ],
    "escalation": [
      "طلب هيتأخر أو منتج مش على الرف: اضغط ناقص على الطلب (الأدمن بيتبلغ لوحده) وقول لمسؤول الفرع.",
      "شحنة وصلت من غير رقم شحنة من التاجر: ما تستلمهاش؛ افتح تذكرة للأدمن باسم التاجر وعدد الكراتين.",
      "الفلوس مش مظبوطة: اكتب اللي عديته؛ الماليات بتراجع. ما تغيرش العد.",
      "الاسكانر أو الموبايل أو النت واقف أكتر من 10 دقايق: كلم مسؤول الفرع؛ هو يفتح تذكرة عاجلة للأدمن.",
      "أي حاجة مش متأكد منها: تذكرة لمسؤول الفرع قبل ما تتصرف."
    ],
    "sections": [
      {"title": "استلام شحنة تاجر",
       "steps": [
         "اطلب من السواق رقم شحنة التاجر. لو مفيش شحنة للتاجر ده في الاستلام يبقى مفيش استلام: كلم الأدمن.",
         "افتح الاستلام واختار الشحنة. اتأكد إن اسم التاجر نفس اللي على الكراتين.",
         "افتح كرتونة كرتونة. اعمل سكان لكل قطعة. كل سكان بيزود 1 في رف الاستلام.",
         "التالف من الوصول: حطه على جنب؛ بعد القفل بلغ عنه من التالف والمحجوز بسبب وصل تالف.",
         "لما كل الكراتين تفضى اضغط اقفل الشحنة وأكد."],
       "check": [
         "الشاشة بتوري المستلم قصاد المتوقع لكل منتج.",
         "شريط حالة الشحنة بيقول اتستلم.",
         "رف الاستلام زاد باللي عملت له سكان (التخزين بيوريه)."],
       "problems": [
         "باركود اترفض (مش في الكتالوج): حط القطعة على جنب، صور الليبل، وافتح تذكرة للأدمن باسم التاجر.",
         "قطع أكتر من المتوقع: استلمها عادي؛ التاجر بيشوفها زيادة.",
         "قفلت بالغلط: بلغ الأدمن بتذكرة فورا؛ ما تستلمش الباقي على شحنة تانية."]},
      {"title": "التخزين على الرفوف",
       "steps": [
         "افتح التخزين. خد القطع من رف الاستلام.",
         "اعمل سكان للمنتج، وبعدين سكان لليبل الرف اللي هتحطه عليه.",
         "كرر لحد ما رف الاستلام يفضى."],
       "check": [
         "التخزين في الرئيسية بيقول 0 قطعة.",
         "المنتج على الرف اللي عملت سكان لليبله."],
       "problems": [
         "الرف مليان: استخدم الرف الفاضي اللي بعده واعمله سكان.",
         "مفيش ليبل للرف: اطبعه من ليبلات الرفوف قبل ما تحط حاجة."]},
      {"title": "تجهيز طلب",
       "steps": [
         "افتح الطلبات واضغط أول طلب (الأقدم الأول، الأحمر متأخر). اضغط اقبل لو جديد.",
         "روح للرف اللي ظاهر. اعمل سكان للرف (اختياري) وبعدين لكل منتج.",
         "لو منتج مش موجود اضغط ناقص. ممنوع تحط حاجة بدل حاجة."],
       "check": [
         "كل سطر المجهز بيساوي المطلوب (أو الناقص متعلم).",
         "شريط الحالة بيروح لبيتجهز، وبعد التغليف متغلف."],
       "problems": [
         "سكان لمنتج غلط: الشاشة بترفضه؛ اعمل سكان للصح.",
         "المنتج تالف على الرف: اضغط ناقص، وبلغ عنه من التالف والمحجوز بسبب تعامل الفرع."]},
      {"title": "التغليف والتسليم للمندوب",
       "steps": [
         "غلف كل الحاجات، اقفل الشنطة والزق ليبل الطلب.",
         "صور الشنطة مقفولة صورة واضحة. التغليف مش هيخلص من غيرها.",
         "لما المندوب يوصل اعمل سكان لكارنيهه.",
         "سلمه الشنط وقول عددها بصوت عالي."],
       "check": [
         "شريط الحالة بيقول خرج للتوصيل.",
         "شاشة المندوب بتوري الطلب بعدد القطع الصح."],
       "problems": [
         "الشاشة رفضت تضيف طلب لمشوار المندوب: فيه طلب هيتأخر؛ اديه لمندوب تاني.",
         "اتعمل سكان لكارنيه غلط: كلم الأدمن؛ ما تخليش المندوب يمشي بالطلب."]},
      {"title": "فلوس المناديب",
       "steps": [
         "افتح الكاش واختار المندوب.",
         "عد الفلوس قدام المندوب مرتين.",
         "اكتب اللي عديته بالظبط واحفظ.",
         "حط الفلوس في خزنة الفرع فورا."],
       "check": [
         "التسليم بيقول مظبوط، أو مستني لو فيه فرق (الماليات بتراجع).",
         "إجمالي خزنة الفرع في الكاش زاد بالمبلغ."],
       "problems": [
         "ناقص أو زيادة: احفظ العد الحقيقي، اكتب ملاحظة (المندوب قال إيه)، والفرق بيروح للماليات.",
         "المندوب مش عايز يستنى العد: ما تحفظش؛ قول لمسؤول الفرع."]},
      {"title": "التوصيل اللي فشل ومرتجعات التجار",
       "steps": [
         "لما المندوب يرجع بالبضاعة: افتح الطلب واضغط استلام البضاعة الراجعة.",
         "مرتجع تاجر: افتح المرتجعات، اختار المرتجع، اعمل سكان لكل قطعة.",
         "لما يبقى جاهز سلمه لسواق التاجر واكتب اسمه كامل."],
       "check": [
         "الطلب بيوري إن البضاعة رجعت؛ المرتجع بيقول اتسلم."],
       "problems": [
         "البضاعة ما رجعتش خلال ساعتين من المحاولة الفاشلة: الأدمن بيتبلغ؛ دور على المندوب واسأله."]},
      {"title": "التالف والجرد والتحويلات",
       "steps": [
         "التالف: افتح التالف والمحجوز، اعمل سكان للقطعة، اختار السبب، احفظ.",
         "الجرد: افتح الجرد، اعمل سكان للرف، اعمل سكان لكل قطعة بتلاقيها؛ مش هتشوف العدد المتوقع.",
         "تحويل هيتبعت: افتح التحويلات، جهز بالسكان، اضغط ابعت.",
         "تحويل وصل: اعمل سكان لكل قطعة في الاستلام، اقفله، وبعدين خزن عادي."],
       "check": [
         "القطع التالفة مبقتش معروضة للبيع.",
         "الجرد بيقول اتبعت؛ الأدمن بيوافق على الفروق.",
         "شريط حالة التحويل بيقول في الطريق (اتبعت) أو اتستلم."],
       "problems": [
         "قطع التحويل مش لاقيها: ابعت اللي عندك؛ الناقص بيتفك والأدمن بيتبلغ."]}
    ]},
  "rider": {
    "title": "المندوب",
    "who": "المناديب اللي بيوصلوا طلبات الـ60 دقيقة من دارك ستور واحد.",
    "day": [
      "أول الشيفت: ادخل، اسمح بالموقع، اتأكد إن شحن الموبايل فوق 50% ومعاك فكة للطلبات الكاش.",
      "كل مشوار: خد الطلبات بسكان الكارنيه في الفرع بس؛ اتأكد من عدد الشنط.",
      "بعد كل مشوار: ارجع الفرع، رجع البضاعة اللي ما اتسلمتش، وسلم الفلوس لو مسؤولك طلب.",
      "آخر الشيفت: سلم كل الفلوس للفرع وشوفهم وهم بيعدوها. مفيش حاجة تبات معاك."
    ],
    "escalation": [
      "العميل ما بيردش بعد المكالمات اللي التطبيق بيطلبها: علمه فشل بصورة الباب؛ مسؤول الفرع بيقرر الخطوة الجاية.",
      "حادثة أو بوليس أو خطر: وقف، خليك في أمان، وكلم مسؤول الفرع فورا.",
      "حصلت مبلغ غلط: اكتب اللي أخدته بالظبط؛ الماليات هتراجع.",
      "التطبيق واقف: كلم مسؤول الفرع؛ ما تسلمش شنطة من غير الكود أو صورة."
    ],
    "sections": [
      {"title": "توصيل طلب",
       "steps": [
         "افتح الطلب واضغط الاتجاهات.",
         "عند العنوان، كلم العميل من التطبيق لو مش لاقي المكان.",
         "اطلب كود العميل الأربع أرقام واكتبه، أو صور صورة التسليم.",
         "طلب كاش: خد المبلغ اللي ظاهر بالظبط، اكتب اللي أخدته، واضغط اتسلم."],
       "check": [
         "الطلب بيروح لخلصت النهارده كاتسلم.",
         "إجمالي كاش النهارده زاد بالمبلغ."],
       "problems": [
         "الكود غلط: راجعه مع العميل؛ عمرك ما تسلم من غير الكود أو صورة.",
         "العميل معهوش فكة: ما تديش فكة من فلوس الشركة؛ كلم مسؤول الفرع."]},
      {"title": "لو مقدرتش توصل",
       "steps": [
         "العميل ما بيردش: اتصل من التطبيق عدد المرات اللي بيطلبها، وبعدين صور الباب.",
         "اضغط مقدرتش أوصل، اختار السبب، واكتب التفاصيل لو سبب تاني.",
         "رجع البضاعة للفرع في نفس المشوار."],
       "check": [
         "الطلب بيقول محاولة فشلت أو فشل.",
         "الموظف ضغط استلام البضاعة الراجعة."],
       "problems": [
         "مش قادر ترجع الفرع: كلم مسؤول الفرع؛ ممنوع تبات بالبضاعة."]},
      {"title": "الفلوس آخر الشيفت",
       "steps": [
         "روح الفرع بكل الفلوس اللي حصلتها.",
         "سلمها وشوفهم وهم بيعدوها.",
         "اتأكد إن المعدود نفس إجمالي النهارده في تطبيقك."],
       "check": [
         "شاشة الفرع بتقول مظبوط."],
       "problems": [
         "فيه فرق: قول للموظف اللي حصل عشان يكتبه في الملاحظة؛ الماليات بتقرر."]}
    ]},
  "merchant": {
    "title": "التاجر",
    "who": "المحلات اللي بتبيع بتوصيل شيبلي ناو في 60 دقيقة.",
    "day": [
      "كل صباح: بص على الطلبات والإشعارات؛ وشوف المنتجات اللي قربت تخلص.",
      "قبل ما تبعت بضاعة: اعمل الشحنة الأول، وبعدين ابعت.",
      "كل أسبوع: راجع المحفظة وكشف الحساب؛ واتأكد إن مواعيد التحويل صح."
    ],
    "escalation": [
      "سؤال عن طلب أو فلوس: كلم دعم شيبلي (مدير حسابك) برقم الطلب أو التحويل.",
      "حاجة ناقصة بعد استلام شحنة: ابعت رقم الشحنة وكود المنتج خلال 48 ساعة."
    ],
    "sections": [
      {"title": "ابدأ البيع",
       "steps": [
         "ضيف منتجاتك (واحد واحد، بملف، أو بربط متجر شوبيفاي). كل منتج محتاج باركود.",
         "حدد سعر توصيل الـ60 دقيقة من التوصيل.",
         "اعمل أول شحنة عشان نستلم البضاعة."],
       "check": [
         "القائمة في الرئيسية كلها متعلمة."],
       "problems": [
         "باركود اترفض: مستخدم لمنتج تاني؛ استخدم الباركود الحقيقي اللي على القطعة."]},
      {"title": "ابعت بضاعة",
       "steps": [
         "الشحنات، شحنة جديدة: اكتب كل منتج وكميته.",
         "اكتب رقم الشحنة على كل كرتونة.",
         "ابعت الكراتين للعنوان اللي ظاهر."],
       "check": [
         "الشحنة بتمشي متوقع، بيتستلم، اتستلم.",
         "بيوصلك ملخص: المتوقع قصاد المستلم."],
       "problems": [
         "قطع زيادة: بتتستلم وبتظهر زيادة؛ مفيش حاجة تعملها."]},
      {"title": "الطلبات والفلوس",
       "steps": [
         "طلبات شوبيفاي اللي فيها الـ60 دقيقة بتيجي لوحدها؛ وتقدر تضيف طلب من طلب جديد.",
         "تقدر تلغي الطلبات الجديدة أو المقبولة بس.",
         "المحفظة بتوري لك عندنا كام؛ التحويلات بتنزل البنك على مواعيدك."],
       "check": [
         "كل تحويل ليه رقم مرجع من البنك."],
       "problems": [
         "تحويل شكله غلط: نزل كشف الحساب للفترة وابعته مع سؤالك."]}
    ]},
  "finance": {
    "title": "الماليات",
    "who": "فريق الماليات والمحاسب. كل حاجة في الماليات.",
    "day": [
      "كل صباح (30 دقيقة): النظرة العامة؛ راجع كل فرق نقدية في الكاش؛ أودع كاش امبارح في البنك (اختار البنك واكتب رقم الإيصال).",
      "أيام التحويلات: التحويلات، جهز المستحق، راجع كل واحد، حول من البنك، وعلمه اتدفع برقم المرجع.",
      "كل فاتورة أو حركة فلوس في نفس يومها: حركة الأموال، ورقم الإيصال الورق كمرجع.",
      "آخر الشهر: ميزان المراجعة، الأرباح والخسائر، الميزانية، مطابقة البنك، وملفات CSV للمحاسب."
    ],
    "escalation": [
      "مندوب ناقص أكتر من مرة في الأسبوع: تذكرة للأدمن بأرقام CH-.",
      "تحويل رجع أو رقم البنك مش مطابق: تذكرة للأدمن؛ ما تسجلش تصحيح قبل ما تعرف السبب.",
      "ميزان المراجعة مش متوازن: وقف وافتح تذكرة عاجلة للأدمن (المفروض عمرها ما تحصل)."
    ],
    "sections": [
      {"title": "مراجعة فرق نقدية",
       "steps": [
         "الكاش، مستني مراجعتك: افتح التسليم (CH-...).",
         "اقرا الملاحظة وكلم مسؤول الفرع لو محتاج.",
         "شيله على الشركة (خسارة) أو سيبه على المندوب، ودايما بسبب."],
       "check": [
         "التسليم بيخرج من قائمة الانتظار؛ كاش المندوب في المناديب صح."],
       "problems": [
         "مش متأكد مين الصح: تذكرة لمسؤول الفرع؛ قرر بعد الرد."]},
      {"title": "إيداع كاش الفرع في البنك",
       "steps": [
         "الكاش، الفرع، اكتب المبلغ ورقم إيصال البنك، اختار البنك، أودع.",
         "احتفظ بالإيصال واكتب عليه رقم القيد JV."],
       "check": [
         "خزنة الفرع بتقل وحساب البنك (دليل الحسابات) بيزيد بنفس المبلغ."],
       "problems": [
         "أودعت في بنك غلط: اعمل تحويل بين البنكين بالسبب؛ ممنوع المسح."]},
      {"title": "تسجيل حركة الأموال",
       "steps": [
         "تحويل: من بنك أو خزنة لتانية.",
         "مصروف: اختار النوع ودفعت منين؛ واكتب الضريبة لو في الفاتورة.",
         "فلوس المالك: رأس مال داخل أو مسحوبات طالعة.",
         "قيد يومية: تصحيحات بسبب مكتوب. المدين لازم يساوي الدائن."],
       "check": [
         "بتاخد رقم قيد (JV-...). اكتبه على الإيصال واحفظه.",
         "كشف الحساب بيوري السطر والرصيد بعده صح."],
       "problems": [
         "مفيش فلوس كفاية في الحساب: الشاشة بترفض؛ راجع التاريخ والحساب."]},
      {"title": "تحويلات التجار",
       "steps": [
         "التحويلات، جهز التحويلات المستحقة لليوم.",
         "افتح كل مسودة (PAY-...) وقارنها بكشف حساب التاجر.",
         "حول من البنك، وبعدين اتدفع برقم المرجع والبنك اللي دفعت منه."],
       "check": [
         "التحويل بيقول اتدفع؛ رصيد التاجر قل بالمبلغ."],
       "problems": [
         "المبلغ شكله غلط: الغي المسودة بملاحظة وافتح تذكرة للأدمن."]},
      {"title": "آخر الشهر",
       "steps": [
         "ميزان المراجعة للشهر: المدين لازم يساوي الدائن.",
         "الأرباح والخسائر للشهر؛ والميزانية في آخر يوم.",
         "قارن كشف كل حساب بنكي في شيبلي بكشف البنك الحقيقي؛ وسجل مصاريف البنك كمصروف في 5501.",
         "نزل اليومية والكشوف CSV للمحاسب."],
       "check": [
         "أرصدة البنوك في شيبلي = كشوف البنك.",
         "الميزانية بتقول الأصول = الخصوم + حقوق الملكية."],
       "problems": [
         "فرق مش عارف تفسره: تذكرة للأدمن بكود الحساب والمبلغ."]}
    ]},
  "admin": {
    "title": "الأدمن",
    "who": "أدمن التشغيل. تقدر تفتح كل الأجزاء.",
    "day": [
      "كل صباح: النظرة العامة، بعدين التنبيهات (اتعامل مع كل واحد)، بعدين التذاكر (ليا).",
      "كل ساعة وقت الذروة: الطلبات، المتأخر الأول؛ كلم مسؤول أي فرع أحمر.",
      "كل ليلة بعد 9: التحويلات، وافق أو عدل مسودات إعادة التعبئة.",
      "كل أسبوع: التجار (التسجيلات)، الجرد (وافق على الفروق)، التالف (سوي)، الإعدادات (اتأكد مفيش تغيير بالغلط)."
    ],
    "escalation": [
      "بيوصلك اللي محدش تاني يقدر يقرره: نقص مخزون، فروق فلوس، شكاوى تجار، أجهزة بايظة.",
      "استخدم التذاكر عشان تسأل أي حد؛ كل تذكرة ليها وقت رد وتذكير.",
      "شوبيفاي أو الدفع أو السيرفر واقف: تذكرة عاجلة للمسؤول التقني وقول للفروع ياخدوا طلبات يدوي بس بعد ما تقول."
    ],
    "sections": [
      {"title": "الفروع والمراكز والمناطق",
       "steps": [
         "المخازن ومراكز الفرز: افتح موقع بكود قصير (حروف وأرقام)، العنوان ومكانه على الخريطة.",
         "المناطق: ارسم منطقة توصيل كل فرع.",
         "خريطة العناوين: شغل تحميل OpenStreetMap مرة، وبعدين وافق على الأسماء اللي بتتعلمها كل أسبوع."],
       "check": [
         "جرب عنوان في خريطة العناوين: بيروح للفرع الصح."],
       "problems": [
         "منطقة بيخدمها فرعين: ظبط حدود المناطق عشان ما تتداخلش."]},
      {"title": "التجار والمنتجات وشوبيفاي",
       "steps": [
         "التجار: وافق أو ارفض التسجيلات بسبب.",
         "شوبيفاي: اربط التاجر بمتجره، ابعتله لينك التثبيت، وبعدين اعمل المواقع.",
         "المنتجات: ارفع ملف المنتجات؛ كل باركود لازم يكون مختلف."],
       "check": [
         "كارت شوبيفاي بيوري المواقع والمنتجات المربوطة."],
       "problems": [
         "تاجر نقل لمتجر شوبيفاي جديد: افصل المتجر وبعدين اربط الجديد."]},
      {"title": "المخزون",
       "steps": [
         "الجرد: وافق أو ارفض كل فرق.",
         "التالف: أكد السبب؛ أسباب الشركة بتعوض التاجر.",
         "التحويلات: وافق، عدل الكميات، أو الغي قبل ما التجهيز يبدأ."],
       "check": [
         "المخزون في صفحة المخزون نفس اللي الموظفين شايفينه على الرفوف."],
       "problems": [
         "جرد قديم: اطلب من الفرع يجرد الرف تاني."]},
      {"title": "المستخدمين والإعدادات",
       "steps": [
         "المستخدمين: اعمل موظفين (بفرع)، مناديب (بفرع وكارنيه)، تجار، وماليات؛ وضيف رقم سلاك لكل واحد.",
         "الإعدادات: دقائق الـSLA، السعة، الرسوم، مستويات إعادة التعبئة، ووقت الرد على التذاكر."],
       "check": [
         "سجل التدقيق بيوري كل تغيير ومين عمله."],
       "problems": [
         "حد ساب الشغل: وقف المستخدم في نفس اليوم؛ بيخرج من كل الأجهزة."]}
    ]}
}
