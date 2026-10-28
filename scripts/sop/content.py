# Standard operating procedures for every role, in English and Arabic. One source:
# build.py writes them into the web app's messages (shown at /help) and into docs/sop/*.md.
# Each role: title, who, sections of steps; each language must keep the same shape.

EN = {
  "store_staff": {
    "title": "Dark store staff",
    "who": "Receivers, pickers and packers working inside a dark store or the hub. Open your store from the home screen.",
    "sections": [
      {"title": "Start of shift", "steps": [
        "Sign in on the store phone or tablet and open your store.",
        "Check the Orders list: anything red is late and comes first.",
        "Make sure the scanner (or camera) reads a barcode before the first order arrives."]},
      {"title": "Receive a merchant shipment", "steps": [
        "Goods are received only against a shipment the merchant created first. If there is none, do not take the goods; call admin.",
        "Open Receive, choose the shipment, then scan every unit. Each scan adds one unit to the receiving bin.",
        "Products not on the shipment and units above the listed quantity are still received; the merchant sees them as extra.",
        "A barcode that is not in the catalog is refused. Put the item aside and tell admin.",
        "When every box is scanned, tap Close shipment. The merchant gets a summary of expected against received."]},
      {"title": "Put away", "steps": [
        "Open Put away. Scan the product in the receiving bin, then scan the shelf you place it on.",
        "Only shelf stock can be sold. Do not leave stock in receiving at the end of a shift."]},
      {"title": "Pick an order", "steps": [
        "Open the order at the top of the list (oldest first, late in red).",
        "Go to the shelf shown, scan the shelf (optional) and then each product. The count goes up with each scan.",
        "If a product is not on the shelf, tap Missing. The missing units are cancelled, the merchant is told and admin gets an alert. Never replace with another product."]},
      {"title": "Pack and hand to the rider", "steps": [
        "Pack the items, then take a clear photo of the closed package. Packing cannot finish without the photo.",
        "When the rider arrives, scan the rider's badge. The order moves to Out for delivery and the customer's clock keeps running.",
        "A rider may take several orders in one trip only if none of them would miss its promise; the screen will refuse otherwise."]},
      {"title": "Cash from riders", "steps": [
        "Open Cash, choose the rider and count the money in front of the rider.",
        "Type the counted total exactly. If it differs from what the system expects, finance reviews it; do not change the count to make it match.",
        "Keep the cash in the store box. Only finance takes it to the bank."]},
      {"title": "Failed deliveries and returns", "steps": [
        "When a rider brings goods back, tap Receive goods back on that order.",
        "For a merchant return, open Returns, scan each unit listed, then hand it over and type the collector's full name."]},
      {"title": "Damaged stock and counts", "steps": [
        "Damaged units go to the damaged bin only through Damaged, with the cause. Never hide damage in a shelf.",
        "Counts are blind: scan what you find in the bin. Differences wait for admin approval."]},
      {"title": "Transfers", "steps": [
        "Approved transfers show in Transfers. Pick by scan, then tap Send. Units you could not find are released and admin is told.",
        "When a transfer arrives, scan every unit into receiving, close it, then put away as usual."]},
      {"title": "If something goes wrong", "steps": [
        "The screen says a code like not_enough_available: read it, do not repeat the tap many times; every tap is counted once anyway.",
        "No internet: wait and try again; the action is not lost and will not be applied twice.",
        "Anything unclear: call your store lead or admin before acting."]}
    ]},
  "rider": {
    "title": "Rider",
    "who": "Riders delivering 60 minute orders from a dark store.",
    "sections": [
      {"title": "Before you leave the store", "steps": [
        "Keep the rider app open; it shares your position with the customer while you carry an order.",
        "Staff scan your badge to hand you the orders. Check the number of packages matches the screen."]},
      {"title": "Deliver", "steps": [
        "Tap the map link to navigate. Call the customer from the app if you cannot find the place.",
        "Hand over the package and ask for the customer's 4 digit code, or take a handover photo.",
        "Cash on delivery: collect the exact amount shown and type what you collected. A difference raises an alert, so count carefully."]},
      {"title": "When you cannot deliver", "steps": [
        "Choose the reason. No answer needs at least the required number of calls from the app and a photo of the door; Other needs a note.",
        "Bring the goods back to the store the same trip and give them to staff. Never keep goods overnight."]},
      {"title": "End of shift cash", "steps": [
        "Hand all collected cash to store staff and watch them count it.",
        "Any shortage stays on your wallet until finance decides. Your delivery bonuses are paid by finance."]},
      {"title": "Rules", "steps": [
        "Never give the package without the code or a photo.",
        "Never share a customer's phone or address.",
        "Drive safely; the promise time is never a reason to break traffic rules."]}
    ]},
  "merchant": {
    "title": "Merchant",
    "who": "Shops selling through Shiply Now 60 minute delivery.",
    "sections": [
      {"title": "Get started", "steps": [
        "Add your products (or import the product file, or link your Shopify store) with a barcode on every product.",
        "Set your 60 minute delivery price in Delivery.",
        "Create your first shipment so we can receive your stock."]},
      {"title": "Send stock", "steps": [
        "In Shipments, create a shipment listing products and quantities before you send anything. We do not accept goods without it.",
        "Print or write the shipment number on the boxes.",
        "When we close it you get a summary: expected against received, and anything extra."]},
      {"title": "Orders", "steps": [
        "Shopify orders with the 60 minute option arrive by themselves. You can also create an order by hand in New order.",
        "You can cancel only new or accepted orders. After that, call support.",
        "Items we did not have are cancelled on the order and you are told."]},
      {"title": "Money", "steps": [
        "Wallet shows what we owe you: cash collected for you minus our fees.",
        "Choose your payout schedule (daily, twice weekly or weekly). Payouts go to your bank with a reference you can see.",
        "Download a statement for any period from Wallet."]},
      {"title": "Take stock back", "steps": [
        "In Returns, ask for sellable, damaged or held units of one store. We pick them and hand them to your driver; a fee per unit applies."]}
    ]},
  "finance": {
    "title": "Finance",
    "who": "The finance team and the accountant. Everything is in /finance.",
    "sections": [
      {"title": "Every day", "steps": [
        "Overview: check cash with riders, cash in store boxes and pending reviews.",
        "Cash: review every handover with a difference. Write it off (company loss) or keep it on the rider, always with a note.",
        "Deposit store cash to the bank: choose the store, the amount, the bank and the slip number."]},
      {"title": "Chart of accounts", "steps": [
        "Accounts are numbered by category: 1 assets, 2 liabilities, 3 equity, 4 income, 5 expenses. New accounts take the next number of their group automatically (CIB is 1101, the next bank 1102).",
        "Open a bank account: Chart of accounts, Open a new account, group 1100 Banks, bank name and account number.",
        "Open an expense category in group 5400, or a cash box in group 1200.",
        "Only an empty account can be closed. System accounts cannot be closed."]},
      {"title": "Money movements", "steps": [
        "Cash box to bank or bank to cash box: Money movements, Transfer.",
        "A bill you paid: Expense. Choose the category and where it was paid from; enter the VAT if the bill shows it.",
        "Owner money in or out: Owner money.",
        "Corrections: Journal entry, with a reason. Never delete; a wrong entry is corrected by a new one.",
        "Each record gets a voucher number (JV-000123). Write it on the paper receipt and file it."]},
      {"title": "Merchant payouts", "steps": [
        "Payouts, Prepare due payouts for the day. Check each draft.",
        "Send the bank transfer, then Mark paid with the bank reference and the bank used. Only then the balance moves.",
        "A merchant who owes us and pays: Merchants, Record payment."]},
      {"title": "Rider bonuses", "steps": [
        "Riders shows bonuses owed. Pay from a bank or a store box with a reference."]},
      {"title": "Month end", "steps": [
        "Trial balance: totals must be equal.",
        "Profit and loss for the month, and the balance sheet at the last day.",
        "Download the journal and account statements as CSV for the accountant.",
        "Compare each bank account statement in the system with the real bank statement; book bank charges as an Expense in 5501."]}
    ]},
  "admin": {
    "title": "Admin",
    "who": "Operations admins. You can open every area.",
    "sections": [
      {"title": "Every day", "steps": [
        "Overview and Alerts: handle every open alert (late orders, missing items, cash and rating alerts).",
        "Orders: watch late orders and call the store lead."]},
      {"title": "Stores, hubs and zones", "steps": [
        "Stores: open a dark store or a sorting facility (hub) with a short code of letters and numbers, address and location.",
        "Zones: draw the delivery area of each store on the map.",
        "Address map: run the OpenStreetMap import once, then approve the names it learns."]},
      {"title": "Merchants and products", "steps": [
        "Merchants: approve or reject sign ups. Link a merchant to their Shopify store in Shopify.",
        "Disconnect store in Shopify ends the link with an old Shopify store.",
        "Products: import the product file; every barcode must be unique."]},
      {"title": "Stock", "steps": [
        "Approve count differences in Counts.",
        "Damage: confirm the cause of each report; company causes credit the merchant.",
        "Transfers: create, approve or cancel; refill drafts come every evening for approval."]},
      {"title": "Users and settings", "steps": [
        "Users: create staff (with a store), riders (with a store and badge), merchants and finance users. Disabling a user signs them out everywhere.",
        "Settings: SLA minutes, capacity, fees and refill levels. Every change is audited."]}
    ]}
}

AR = {
  "store_staff": {
    "title": "موظفين الدارك ستور",
    "who": "الاستلام والتجهيز والتغليف جوه الدارك ستور أو المركز. افتح فرعك من الشاشة الرئيسية.",
    "sections": [
      {"title": "أول الشيفت", "steps": [
        "ادخل على موبايل أو تابلت الفرع وافتح فرعك.",
        "بص على قائمة الطلبات: أي حاجة باللون الأحمر متأخرة وليها الأولوية.",
        "اتأكد إن الاسكانر (أو الكاميرا) بيقرا الباركود قبل أول طلب."]},
      {"title": "استلام شحنة تاجر", "steps": [
        "البضاعة بتتستلم بس على شحنة التاجر عاملها الأول. لو مفيش شحنة، ما تستلمش البضاعة وكلم الأدمن.",
        "افتح الاستلام، اختار الشحنة، واعمل سكان لكل قطعة. كل سكان بيزود قطعة في رف الاستلام.",
        "المنتجات اللي مش في الشحنة والكميات الزيادة بتتستلم برضه، والتاجر بيشوفها زيادة.",
        "الباركود اللي مش في الكتالوج بيترفض. حط القطعة على جنب وبلغ الأدمن.",
        "لما تخلص كل الكراتين اضغط اقفل الشحنة. التاجر بيوصله ملخص المتوقع والمستلم."]},
      {"title": "التخزين على الرفوف", "steps": [
        "افتح التخزين. اعمل سكان للمنتج في رف الاستلام وبعدين سكان للرف اللي هتحطه عليه.",
        "البضاعة اللي على الرفوف بس هي اللي تتباع. ما تسيبش بضاعة في الاستلام آخر الشيفت."]},
      {"title": "تجهيز طلب", "steps": [
        "افتح أول طلب في القائمة (الأقدم الأول، والمتأخر بالأحمر).",
        "روح للرف اللي ظاهر، اعمل سكان للرف (اختياري) وبعدين لكل منتج. العدد بيزيد مع كل سكان.",
        "لو المنتج مش على الرف اضغط ناقص. القطع الناقصة بتتلغي والتاجر بيتبلغ والأدمن بيوصله تنبيه. ممنوع تحط منتج بدل منتج."]},
      {"title": "التغليف والتسليم للمندوب", "steps": [
        "غلف الطلب وصور الشنطة مقفولة صورة واضحة. التغليف مش هيخلص من غير الصورة.",
        "لما المندوب يوصل اعمل سكان لكارنيه المندوب. الطلب بيبقى خرج للتوصيل ووقت العميل مكمل.",
        "المندوب ياخد كذا طلب في مشوار واحد بس لو مفيش طلب هيتأخر عن معاده؛ الشاشة هترفض غير كده."]},
      {"title": "فلوس المناديب", "steps": [
        "افتح الكاش، اختار المندوب، وعد الفلوس قدامه.",
        "اكتب المبلغ اللي عديته بالظبط. لو مختلف عن المتوقع الماليات بتراجعه؛ ما تغيرش العد عشان يظبط.",
        "سيب الفلوس في خزنة الفرع. الماليات بس هي اللي بتوديها البنك."]},
      {"title": "التوصيل اللي فشل والمرتجعات", "steps": [
        "لما المندوب يرجع بالبضاعة اضغط استلام البضاعة الراجعة على الطلب.",
        "لمرتجع التاجر افتح المرتجعات، اعمل سكان لكل قطعة، وبعدين سلمها واكتب اسم المستلم كامل."]},
      {"title": "التالف والجرد", "steps": [
        "القطع التالفة تروح رف التالف من شاشة التالف بس ومعاها السبب. ممنوع تخبي تالف على رف.",
        "الجرد أعمى: اعمل سكان للي لقيته في الرف. الفروق بتستنى موافقة الأدمن."]},
      {"title": "التحويلات", "steps": [
        "التحويلات المعتمدة بتظهر في التحويلات. جهزها بالسكان واضغط ابعت. القطع اللي مالقيتهاش بتتفك والأدمن بيتبلغ.",
        "لما تحويل يوصل اعمل سكان لكل قطعة في الاستلام، اقفله، وبعدين خزن على الرفوف عادي."]},
      {"title": "لو حصلت مشكلة", "steps": [
        "لو الشاشة كتبت كود زي not_enough_available اقراه وما تضغطش كتير؛ كل ضغطة بتتحسب مرة واحدة بس.",
        "لو النت فصل استنى وجرب تاني؛ العملية مش هتضيع ومش هتتسجل مرتين.",
        "أي حاجة مش واضحة كلم مسؤول الفرع أو الأدمن قبل ما تتصرف."]}
    ]},
  "rider": {
    "title": "المندوب",
    "who": "المناديب اللي بيوصلوا طلبات الـ60 دقيقة من الدارك ستور.",
    "sections": [
      {"title": "قبل ما تخرج من الفرع", "steps": [
        "خلي تطبيق المندوب مفتوح؛ بيشارك مكانك مع العميل طول ما معاك طلب.",
        "الموظف بيعمل سكان لكارنيهك عشان يسلمك الطلبات. اتأكد إن عدد الشنط زي اللي على الشاشة."]},
      {"title": "التوصيل", "steps": [
        "اضغط لينك الخريطة عشان تمشي عليه. كلم العميل من التطبيق لو مش لاقي المكان.",
        "سلم الشنطة واطلب كود العميل الأربع أرقام، أو صور صورة التسليم.",
        "الدفع عند الاستلام: خد المبلغ اللي ظاهر بالظبط واكتب اللي استلمته. أي فرق بيعمل تنبيه، فعد كويس."]},
      {"title": "لو مقدرتش توصل", "steps": [
        "اختار السبب. محدش بيرد محتاج عدد المكالمات المطلوب من التطبيق وصورة للباب؛ سبب تاني محتاج ملاحظة.",
        "رجع البضاعة للفرع في نفس المشوار وسلمها للموظف. ممنوع تبات بالبضاعة."]},
      {"title": "فلوس آخر الشيفت", "steps": [
        "سلم كل الفلوس اللي حصلتها لموظف الفرع وشوفه وهو بيعدها.",
        "أي عجز بيفضل على محفظتك لحد ما الماليات تقرر. حوافز التوصيل الماليات بتصرفها."]},
      {"title": "القواعد", "steps": [
        "ممنوع تسلم الشنطة من غير الكود أو الصورة.",
        "ممنوع تدي رقم أو عنوان العميل لحد.",
        "سوق بأمان؛ وقت التوصيل عمره ما يكون سبب إنك تكسر قواعد المرور."]}
    ]},
  "merchant": {
    "title": "التاجر",
    "who": "المحلات اللي بتبيع بتوصيل شيبلي ناو في 60 دقيقة.",
    "sections": [
      {"title": "البداية", "steps": [
        "ضيف منتجاتك (أو ارفع ملف المنتجات، أو اربط متجر شوبيفاي) وكل منتج عليه باركود.",
        "حدد سعر توصيل الـ60 دقيقة من صفحة التوصيل.",
        "اعمل أول شحنة عشان نستلم بضاعتك."]},
      {"title": "ابعت بضاعة", "steps": [
        "من الشحنات اعمل شحنة فيها المنتجات والكميات قبل ما تبعت أي حاجة. مش بنستلم بضاعة من غيرها.",
        "اطبع أو اكتب رقم الشحنة على الكراتين.",
        "لما نقفلها بيوصلك ملخص: المتوقع والمستلم وأي زيادة."]},
      {"title": "الطلبات", "steps": [
        "طلبات شوبيفاي اللي فيها اختيار الـ60 دقيقة بتوصل لوحدها. وتقدر تعمل طلب بإيدك من طلب جديد.",
        "تقدر تلغي الطلبات الجديدة أو المقبولة بس. بعد كده كلم الدعم.",
        "المنتجات اللي ما كانتش عندنا بتتلغي من الطلب وبتتبلغ."]},
      {"title": "الفلوس", "steps": [
        "المحفظة بتوريك لك عندنا كام: الكاش اللي اتحصل لك ناقص رسومنا.",
        "اختار مواعيد التحويل (يومي، مرتين في الأسبوع، أو أسبوعي). التحويلات بتنزل البنك برقم مرجع تقدر تشوفه.",
        "نزل كشف حساب لأي فترة من المحفظة."]},
      {"title": "استرجاع بضاعة", "steps": [
        "من المرتجعات اطلب قطع سليمة أو تالفة أو محجوزة من فرع واحد. بنجهزها ونسلمها لمندوبك؛ وفيه رسوم على كل قطعة."]}
    ]},
  "finance": {
    "title": "الماليات",
    "who": "فريق الماليات والمحاسب. كل حاجة في /finance.",
    "sections": [
      {"title": "كل يوم", "steps": [
        "النظرة العامة: راجع الكاش مع المناديب والكاش في خزن الفروع والمراجعات المستنية.",
        "الكاش: راجع كل تسليم فيه فرق. شيله على الشركة (خسارة) أو سيبه على المندوب، ودايما بملاحظة.",
        "ايداع كاش الفرع في البنك: اختار الفرع والمبلغ والبنك ورقم الإيصال."]},
      {"title": "دليل الحسابات", "steps": [
        "الحسابات مترقمة حسب النوع: 1 أصول، 2 خصوم، 3 حقوق ملكية، 4 إيرادات، 5 مصروفات. الحساب الجديد بياخد الرقم اللي بعده في مجموعته أوتوماتيك (CIB رقمه 1101، والبنك اللي بعده 1102).",
        "افتح حساب بنكي: دليل الحسابات، افتح حساب جديد، مجموعة 1100 البنوك، اسم البنك ورقم الحساب.",
        "افتح نوع مصروف في مجموعة 5400، أو خزنة في مجموعة 1200.",
        "الحساب الفاضي بس اللي يتقفل. حسابات السيستم مبتتقفلش."]},
      {"title": "حركة الأموال", "steps": [
        "من الخزنة للبنك أو من البنك للخزنة: حركة الأموال، تحويل.",
        "فاتورة دفعتها: مصروف. اختار النوع والفلوس اتدفعت منين؛ واكتب الضريبة لو موجودة في الفاتورة.",
        "فلوس المالك داخلة أو طالعة: فلوس المالك.",
        "التصحيحات: قيد يومية بسبب. ممنوع المسح؛ القيد الغلط بيتصلح بقيد جديد.",
        "كل حركة بتاخد رقم قيد (JV-000123). اكتبه على الإيصال الورق واحفظه."]},
      {"title": "تحويلات التجار", "steps": [
        "التحويلات، جهز التحويلات المستحقة لليوم. راجع كل مسودة.",
        "ابعت التحويل البنكي، وبعدين اضغط اتدفع برقم المرجع والبنك اللي دفعت منه. ساعتها بس الرصيد بيتحرك.",
        "تاجر عليه فلوس ودفعها: التجار، سجل دفعة."]},
      {"title": "حوافز المناديب", "steps": [
        "المناديب بتوريك الحوافز المستحقة. اصرفها من بنك أو خزنة فرع برقم مرجع."]},
      {"title": "آخر الشهر", "steps": [
        "ميزان المراجعة: الإجماليين لازم يكونوا متساويين.",
        "الأرباح والخسائر للشهر، والميزانية في آخر يوم.",
        "نزل اليومية وكشوف الحسابات CSV للمحاسب.",
        "قارن كشف كل حساب بنكي في السيستم بكشف البنك الحقيقي؛ وسجل مصاريف البنك كمصروف في 5501."]}
    ]},
  "admin": {
    "title": "الأدمن",
    "who": "أدمن التشغيل. تقدر تفتح كل الأجزاء.",
    "sections": [
      {"title": "كل يوم", "steps": [
        "النظرة العامة والتنبيهات: اتعامل مع كل تنبيه مفتوح (طلبات متأخرة، نواقص، فلوس، تقييمات).",
        "الطلبات: تابع المتأخر وكلم مسؤول الفرع."]},
      {"title": "الفروع والمراكز والمناطق", "steps": [
        "الفروع: افتح دارك ستور أو مركز فرز بكود قصير حروف وأرقام، والعنوان والموقع.",
        "المناطق: ارسم منطقة توصيل كل فرع على الخريطة.",
        "خريطة العناوين: شغل تحميل OpenStreetMap مرة، وبعدين وافق على الأسماء اللي بتتعلمها."]},
      {"title": "التجار والمنتجات", "steps": [
        "التجار: وافق أو ارفض التسجيلات. اربط التاجر بمتجر شوبيفاي من صفحة شوبيفاي.",
        "افصل المتجر في شوبيفاي بينهي الربط مع متجر قديم.",
        "المنتجات: ارفع ملف المنتجات؛ كل باركود لازم يكون مختلف."]},
      {"title": "المخزون", "steps": [
        "وافق على فروق الجرد من الجرد.",
        "التالف: أكد سبب كل بلاغ؛ أسباب الشركة بتعوض التاجر.",
        "التحويلات: اعمل أو وافق أو الغي؛ مسودات إعادة التعبئة بتيجي كل ليلة للموافقة."]},
      {"title": "المستخدمين والإعدادات", "steps": [
        "المستخدمين: اعمل موظفين (بفرع)، مناديب (بفرع وكارنيه)، تجار، وماليات. إيقاف المستخدم بيخرجه من كل الأجهزة.",
        "الإعدادات: دقائق الـSLA، السعة، الرسوم ومستويات إعادة التعبئة. كل تغيير بيتسجل."]}
    ]}
}
