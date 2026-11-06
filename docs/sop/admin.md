# SOP: Admin

_The team running operations. Home shows the apps your job role opens; the owner opens everything._

Also inside the app: settings menu (top of every screen), Help.

## English

### Your day

- Every morning: Overview, then Alerts (handle each one), then Tickets (For me).
- Every hour at peak: Orders, late ones first; call the store lead of any red store.
- Every evening after 21:00: Transfers, approve or edit tonight's refill drafts.
- Every week: Merchants (sign ups), Counts (approve differences), Damage (settle), Settings (check nothing changed by mistake).

### Who tells whom

- You receive what nobody else can decide: missing stock, money differences, merchant complaints, broken equipment.
- Use Tickets to ask anyone; every ticket has an answer time and a reminder.
- Shopify, payments or the server down: ticket to the tech lead (urgent) and tell the stores to take manual orders only after you say so.

### Attendance and shifts

1. HR, Configuration: Shifts (start, end, break, days) and Official holidays; HR settings hold the clock in distance, grace and overtime minutes, and the office location.
2. HR, Attendance, Roster: set each person's default shift; the coming two weeks are planned from it; change a day by hand when needed.
3. HR, Attendance, Today: who is in, late, missing or off at each store. Days: closed days with late, overtime and hours, and a CSV export.
4. Open a day to correct it: add a punch the phone could not make, void a wrong one, or set the status; every correction needs a reason.

**Check it went right**

- Yesterday's days are closed the morning after; a forgotten clock out shows the flag.

**If something is wrong**

- A person cannot clock in (too far): check their store on the file, the store's location and hr.clock_radius_m.
- Office staff cannot clock in: set hr.office_lat and hr.office_lng.

### Stores, hubs and zones

1. Dark stores and hubs: open a location with a short code (letters and numbers), the address and the map position.
2. Delivery zones: pick the store, create a zone (code and names), then tap neighbourhoods on the map to add them; tap again to remove, Mark not served for a place we never go. Select areas in a shape adds many at once.
3. To review: decide each area that was split between two stores (keep, move or not served).
4. Address map: run the OpenStreetMap import once, then approve the names it learns each week.

**Check it went right**

- Try an address on the Address map page: it lands in the right store.

**If something is wrong**

- An area belongs to another store: tapping it asks before moving it.
- Orders say address_unsure: the address names a district split between stores; add the missing neighbourhoods or ask for the neighbourhood or a pin.

### Merchants, products and Shopify

1. Merchants: approve or reject sign ups with a reason.
2. Shopify: link the merchant to their store, send them the install link, then create locations.
3. Products: import the product file; every barcode must be unique.

**Check it went right**

- The Shopify card shows locations and linked products.

**If something is wrong**

- A merchant moved to a new Shopify store: Disconnect store, then link the new one.

### Stock

1. Counts: approve or reject each difference.
2. Damage: confirm the cause; company causes credit the merchant.
3. Transfers: approve, edit quantities, or cancel before picking starts.

**Check it went right**

- Stock on the Stock page matches what staff see on the shelves.

**If something is wrong**

- A count is stale: ask the store to count the bin again.

### Users and settings

1. Users: create team members with a job role (it fills their access per app and the stores they cover), riders (store and badge) and merchant owners; adjust a person's access from Edit (nobody changes their own) and add their Slack member ID.
2. Settings: SLA minutes, capacity, fees, refill levels and ticket answer times.

**Check it went right**

- The audit log shows every change with who made it.

**If something is wrong**

- Someone leaves: disable the user the same day; they are signed out everywhere.

## العربية

### الأدمن

فريق تشغيل الشغل. الرئيسية بتبين التطبيقات اللي وظيفتك بتفتحها؛ المالك بيفتح كل حاجة.

### يومك

- كل صباح: النظرة العامة، بعدين التنبيهات (اتعامل مع كل واحد)، بعدين التذاكر (ليا).
- كل ساعة وقت الذروة: الطلبات، المتأخر الأول؛ كلم مسؤول أي فرع أحمر.
- كل ليلة بعد 9: التحويلات، وافق أو عدل مسودات إعادة التعبئة.
- كل أسبوع: التجار (التسجيلات)، الجرد (وافق على الفروق)، التالف (سوي)، الإعدادات (اتأكد مفيش تغيير بالغلط).

### مين يبلغ مين

- بيوصلك اللي محدش تاني يقدر يقرره: نقص مخزون، فروق فلوس، شكاوى تجار، أجهزة بايظة.
- استخدم التذاكر عشان تسأل أي حد؛ كل تذكرة ليها وقت رد وتذكير.
- شوبيفاي أو الدفع أو السيرفر واقف: تذكرة عاجلة للمسؤول التقني وقول للفروع ياخدوا طلبات يدوي بس بعد ما تقول.

### الحضور والورديات

1. الموارد البشرية، الإعدادات: الورديات (البداية والنهاية والراحة والأيام) والإجازات الرسمية؛ وإعدادات الموارد البشرية فيها مسافة تسجيل الحضور والسماح والإضافي ومكان المكتب.
2. الموارد البشرية، الحضور، جدول الورديات: حدد الوردية الأساسية لكل شخص؛ الأسبوعين الجايين بيتعملوا منها؛ وغيّر أي يوم باليد لو محتاج.
3. الموارد البشرية، الحضور، النهارده: مين حاضر أو متأخر أو مش موجود أو في راحة في كل مخزن. أيام الحضور: الأيام المقفولة بالتأخير والإضافي والساعات وتصدير CSV.
4. افتح اليوم علشان تصححه: ضيف تسجيل الموبايل معملوش، أو الغي تسجيل غلط، أو حدد الحالة؛ كل تصحيح لازم له سبب.

**اتأكد إنها مشيت صح**

- أيام امبارح بتتقفل الصبح؛ ولو حد نسي الانصراف بتظهر العلامة.

**لو فيه مشكلة**

- حد مش عارف يسجل حضور (بعيد): راجع مخزنه في الملف ومكان المخزن و hr.clock_radius_m.
- موظفين المكتب مش عارفين يسجلوا: حدد hr.office_lat و hr.office_lng.

### الفروع والمراكز والمناطق

1. المخازن ومراكز الفرز: افتح موقع بكود قصير (حروف وأرقام)، العنوان ومكانه على الخريطة.
2. مناطق التوصيل: اختار الفرع، اعمل منطقة (كود وأسامي)، وبعدين اضغط على الأحياء في الخريطة عشان تضيفها؛ اضغط تاني عشان تشيلها، و"علّمه مش بنخدمه" لمكان مش بنروحه. "اختار الأحياء جوه شكل" بيضيف كتير مرة واحدة.
3. للمراجعة: قرّر في كل حي كان متقسم بين فرعين (خليه، انقله، أو مش بنخدمه).
4. خريطة العناوين: شغل تحميل OpenStreetMap مرة، وبعدين وافق على الأسماء اللي بتتعلمها كل أسبوع.

**اتأكد إنها مشيت صح**

- جرب عنوان في خريطة العناوين: بيروح للفرع الصح.

**لو فيه مشكلة**

- حي تبع فرع تاني: لما تضغط عليه هيسألك قبل ما ينقله.
- طلبات بتقول address_unsure: العنوان فيه منطقة متقسمة بين فرعين؛ ضيف الأحياء الناقصة أو اطلب الحي أو علامة على الخريطة.

### التجار والمنتجات وشوبيفاي

1. التجار: وافق أو ارفض التسجيلات بسبب.
2. شوبيفاي: اربط التاجر بمتجره، ابعتله لينك التثبيت، وبعدين اعمل المواقع.
3. المنتجات: ارفع ملف المنتجات؛ كل باركود لازم يكون مختلف.

**اتأكد إنها مشيت صح**

- كارت شوبيفاي بيوري المواقع والمنتجات المربوطة.

**لو فيه مشكلة**

- تاجر نقل لمتجر شوبيفاي جديد: افصل المتجر وبعدين اربط الجديد.

### المخزون

1. الجرد: وافق أو ارفض كل فرق.
2. التالف: أكد السبب؛ أسباب الشركة بتعوض التاجر.
3. التحويلات: وافق، عدل الكميات، أو الغي قبل ما التجهيز يبدأ.

**اتأكد إنها مشيت صح**

- المخزون في صفحة المخزون نفس اللي الموظفين شايفينه على الرفوف.

**لو فيه مشكلة**

- جرد قديم: اطلب من الفرع يجرد الرف تاني.

### المستخدمين والإعدادات

1. المستخدمين: اعمل أعضاء الفريق بوظيفة (بتملا صلاحياتهم في كل تطبيق والمخازن اللي مسؤولين عنها)، ومناديب (بفرع وكارنيه)، وأصحاب حسابات التجار؛ عدّل صلاحيات أي حد من تعديل (محدش يغير صلاحياته بنفسه) وضيف رقم سلاك.
2. الإعدادات: دقائق الـSLA، السعة، الرسوم، مستويات إعادة التعبئة، ووقت الرد على التذاكر.

**اتأكد إنها مشيت صح**

- سجل التدقيق بيوري كل تغيير ومين عمله.

**لو فيه مشكلة**

- حد ساب الشغل: وقف المستخدم في نفس اليوم؛ بيخرج من كل الأجهزة.
