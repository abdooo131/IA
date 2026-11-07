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

1. HR, Configuration, Attendance setup: Shifts (start, end, break, days) and Official holidays; HR settings hold the clock in distance, grace and overtime minutes, and the office location.
2. HR, Time, Roster: set each person's default shift; the coming two weeks are planned from it; change a day by hand when needed.
3. HR, Time, Today: who is in, late, missing or off at each store. Days: closed days with late, overtime and hours, and a CSV export.
4. Open a day to correct it: add a punch the phone could not make, void a wrong one, or set the status; every correction needs a reason.

**Check it went right**

- Yesterday's days are closed the morning after; a forgotten clock out shows the flag.

**If something is wrong**

- A person cannot clock in (too far): check their store on the file, the store's location and hr.clock_radius_m.
- Office staff cannot clock in: set hr.office_lat and hr.office_lng.

### Leave and violations (HR)

1. HR, Configuration: set annual leave days on each grade (a position may override it); HR settings hold the default 21 days, casual days, the leave year, monthly or yearly accrual, carry over, how far back a request may start, the days per month of pay, the violation period and the appeal days.
2. HR, Configuration, Leave types: what each type allows (paid, which balance, document above N days, most days, notice, self request). Configuration, Violation types: each ladder of penalties.
3. HR, Inbox every morning: approve or refuse leave at the HR step (the manager already approved), apply or refuse attendance fixes, decide appeals of violations you did not record.
4. HR, Time, Leave requests: Ask for leave for someone when they cannot (you may allow more than the balance, the extra days unpaid, or a start further back). Cancel approved leave with a reason before payroll takes it.
5. HR, Time, Leave balances: adjust a balance with a reason (old leave, a correction); Calendar shows who is off by department and store.
6. HR, Discipline, Violations: Record a violation; the ladder picks the step from earlier ones in the period (change it only with a reason). Add a photo or PDF as evidence. Suggested lists lateness and absences from attendance: Confirm or Dismiss each.
7. For outsourcing companies lists final deductions of outsourced people: send them to their company each month.

**Check it went right**

- The Inbox count is zero by noon; suggested violations are handled within two days.
- Before payroll: every leave request of the month is decided, so unpaid days reach the run.

**If something is wrong**

- A request is stuck at the manager: the manager in force is shown on the request; remind them or fix the manager on the file.
- A suggestion is wrong (the person was on leave): correct the attendance day or approve the leave; the suggestion falls away.
- Termination review alert: never automatic; review the file with the owner and decide.

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

### Merchant contracts

1. Merchants: open a merchant (Contract and profit), then Edit contract: start and end dates, notice days, monthly minimum, security deposit, credit limit and volume tiers (from the nth delivered order of the month, a fixed fee and/or a share of products).
2. Tiers apply from the order that crosses the band, never to earlier orders of the month; empty values use the fee settings.
3. With Accounting access, the same page shows this month's fees, costs and margin; Details opens the what if.

**Check it went right**

- The merchant sees the contract read only under Contract; the History panel shows every change.

**If something is wrong**

- Shipments refused for a merchant over the credit limit: the alert names the balance; finance records the payment or you raise the limit with the owner's agreement.

### Stock

1. Counts: approve or reject each difference.
2. Damage: confirm the cause; company causes credit the merchant.
3. Transfers: approve, edit quantities, or cancel before picking starts.

**Check it went right**

- Stock on the Stock page matches what staff see on the shelves.

**If something is wrong**

- A count is stale: ask the store to count the bin again.

### People (HR app)

1. Open HR: the HR home shows what needs you today: who is in, late, absent or on leave now, what waits in the inbox, suggested violations, documents missing or running out, joining and leaving checklists, probation and contracts ending in 30 days, birthdays and work anniversaries this week, and the headcount. Each card has a button to act.
2. Employees, Employee list: search by name, EMP number or mobile; filter by department, store, status, employment or a flag (documents missing, on probation, leaving, left, on leave today, open violation); tap a column title to sort; export CSV. Phones show one card per person.
3. Open a file: the header has the photo, name, EMP number, position, manager, department, store and status, with Call, WhatsApp, Upload a document, Request leave for them, Record a violation, Change status (HR manage) and Edit file. The bar below says how complete the file is and lists exactly what is missing; tap an item to fix it.
4. File tabs: Overview, Job (where they work now, the form, and the history of moves), Pay (with the salaries switch), Documents, Attendance (today's punches and the last 30 days), Leave (balances and requests), Violations, Checklists, Team, History. The tab stays in the address, so a link opens the same tab.
5. Documents: upload a photo or PDF per required type; a new upload keeps the old one as a version. Verify what people sent from My HR, or refuse it with a note.
6. Org chart: by manager or by department; dashed cards are open places. Export PNG or print for the wall.
7. Configuration, Organisation: departments as a tree on the left (fold or unfold, head, headcount); pick one to see its positions with grade range, planned against in post and leave days; All positions and Grades are tabs. Add or Edit opens a side panel.
8. Configuration, Attendance setup: Shifts and Official holidays on one page. Leave types, Violation types, Document types (which documents each file needs) and Checklist templates (tasks when someone joins or leaves) sit in the same menu.

**Check it went right**

- The HR home has nothing in red at the end of the day; every file shows 100% complete, a position, a grade and a manager; the org chart has one person at the top.

**If something is wrong**

- Manager loop refused: someone would manage themselves through the chain; set the manager on the file instead.
- A person is missing from payroll: open their Pay tab and set the package.
- An old link to Departments, Positions, Grades, Shifts or Holidays opens the new setup page on the right tab.

### Users and settings

1. Users: create team members with a job role (it fills their access per app and the stores they cover), riders (store and badge) and merchant owners; adjust a person's access from Edit (nobody changes their own) and add their Slack member ID.
2. Settings: SLA minutes, capacity, fees, refill levels and ticket answer times.

**Check it went right**

- The audit log shows every change with who made it.

**If something is wrong**

- Someone leaves: disable the user the same day; they are signed out everywhere.

### Turn on phone notifications

1. iPhone: open Shiply Now in Safari, tap Share, Add to Home Screen, then always open it from the Home Screen icon (needs iOS 16.4 or later). Android and computers: any browser works; installing the app is optional.
2. Open the Settings menu (top of every screen), then Notifications.
3. Tap Turn on notifications on this device and allow notifications when the phone asks.
4. Tap Send me a test: a notification must appear within a few seconds.
5. Switch off the kinds you do not need. You are told about: urgent alerts (server errors, late orders, failed deliveries, goods not back), merchant sign ups, tickets.

**Check it went right**

- The page says notifications are on for this device and the test arrived.
- Tapping a notification opens the right screen in Shiply Now.

**If something is wrong**

- Blocked: allow notifications for the site in the browser or phone settings, then turn it on again.
- No test arrives: check the phone is not in Do Not Disturb or battery saver, then send another test.
- A lost or old phone: remove it from Your devices on the same page.

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

### الإجازات والمخالفات (شؤون العاملين)

1. شؤون العاملين، الإعدادات: حدد أيام الإجازة الاعتيادية لكل درجة (والوظيفة ممكن تغيرها)؛ وإعدادات شؤون العاملين فيها الافتراضي 21 يوم، أيام العارضة، سنة الإجازات، الاستحقاق شهري أو سنوي، الترحيل، أقصى رجوع للخلف للطلب، أيام الشهر لحساب أجر اليوم، مدة المخالفات وأيام التظلم.
2. شؤون العاملين، الإجازات، أنواع الإجازات: كل نوع بيسمح بإيه (بأجر، أنهي رصيد، مستند لأكتر من كام يوم، أقصى أيام، الإخطار، الموظف يطلبها). المخالفات، أنواع المخالفات: سلم الجزاءات لكل نوع.
3. شؤون العاملين، الوارد كل صبح: وافق أو ارفض الإجازات في مرحلة شؤون العاملين (المدير وافق خلاص)، نفّذ أو ارفض تصحيحات الحضور، وابت في التظلمات من المخالفات اللي ما سجلتهاش.
4. شؤون العاملين، الإجازات، الطلبات: اطلب إجازة لموظف لو مش قادر (تقدر تسمح بأكتر من الرصيد والأيام الزيادة بدون أجر، أو بداية أقدم). الغي إجازة موافق عليها بسبب قبل ما المرتبات تاخدها.
5. شؤون العاملين، الإجازات، الأرصدة: عدّل رصيد بسبب (إجازة قديمة، تصحيح)؛ والتقويم بيوري مين في إجازة حسب القسم والمخزن.
6. شؤون العاملين، المخالفات: سجّل مخالفة؛ السلم بيختار الدرجة من المخالفات السابقة في المدة (غيرها بسبب بس). ارفع صورة أو PDF كإثبات. المقترحة فيها التأخير والغياب من الحضور: أكّد أو تجاهل كل واحدة.
7. لشركات توريد العمالة فيها الخصومات النهائية للعمالة الخارجية: ابعتها لشركتهم كل شهر.

**اتأكد إنها مشيت صح**

- عداد الوارد صفر قبل الضهر؛ والمخالفات المقترحة بتتراجع في خلال يومين.
- قبل المرتبات: كل طلبات إجازة الشهر اتقررت، عشان الأيام بدون أجر تدخل المسير.

**لو فيه مشكلة**

- طلب واقف عند المدير: المدير الحالي مكتوب على الطلب؛ فكّره أو صحح المدير في الملف.
- اقتراح غلط (الموظف كان في إجازة): صحح يوم الحضور أو وافق على الإجازة؛ والاقتراح هيختفي.
- تنبيه مراجعة إنهاء الخدمة: عمره ما بيحصل لوحده؛ راجع الملف مع المالك وقرر.

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

### عقود التجار

1. التجار: افتح التاجر (العقد والربحية)، وبعدين تعديل العقد: تاريخ البداية والنهاية، أيام الإخطار، الحد الأدنى الشهري، التأمين، حد الائتمان وشرائح الحجم (من الطلب رقم n اللي اتوصل في الشهر، رسم ثابت و/أو نسبة من البضاعة).
2. الشريحة بتتطبق من الطلب اللي بيعدي الحد، ومش على الطلبات اللي قبله في الشهر؛ والقيم الفاضية من إعدادات الرسوم.
3. لو عندك صلاحية الحسابات، نفس الصفحة بتوريك رسوم الشهر وتكاليفه والهامش؛ والتفاصيل بتفتح ماذا لو.

**اتأكد إنها مشيت صح**

- التاجر بيشوف العقد للعرض بس تحت العقد؛ ولوحة السجل بتوري كل تغيير.

**لو فيه مشكلة**

- شحنات مرفوضة لتاجر متجاوز حد الائتمان: التنبيه فيه الرصيد؛ الحسابات تسجل الدفع أو انت ترفع الحد بموافقة المالك.

### المخزون

1. الجرد: وافق أو ارفض كل فرق.
2. التالف: أكد السبب؛ أسباب الشركة بتعوض التاجر.
3. التحويلات: وافق، عدل الكميات، أو الغي قبل ما التجهيز يبدأ.

**اتأكد إنها مشيت صح**

- المخزون في صفحة المخزون نفس اللي الموظفين شايفينه على الرفوف.

**لو فيه مشكلة**

- جرد قديم: اطلب من الفرع يجرد الرف تاني.

### الأفراد (تطبيق الموارد البشرية)

1. افتح الموارد البشرية: الصفحة الرئيسية بتوريك اللي محتاجك النهارده: مين حاضر أو متأخر أو غايب أو في إجازة دلوقتي، اللي مستني في الوارد، المخالفات المقترحة، المستندات الناقصة أو اللي هتخلص، قوائم الانضمام والمغادرة، فترات الاختبار والعقود اللي بتخلص في 30 يوم، أعياد الميلاد وذكرى الشغل الأسبوع ده، وعدد الموظفين. كل كارت فيه زرار للتصرف.
2. الموظفون، قائمة الموظفين: دوّر بالاسم أو رقم الموظف أو الموبايل؛ فلتر بالقسم أو الفرع أو الحالة أو نوع التوظيف أو علامة (مستندات ناقصة، تحت الاختبار، سيغادر، غادر، في إجازة النهارده، مخالفة مفتوحة)؛ اضغط على عنوان العمود عشان ترتب؛ وصدّر CSV. الموبايل بيعرض كارت لكل شخص.
3. افتح الملف: الجزء العلوي فيه الصورة والاسم ورقم الموظف والوظيفة والمدير والقسم والفرع والحالة، وأزرار اتصال وواتساب ورفع مستند وطلب إجازة نيابة عنه وتسجيل مخالفة وتغيير الحالة (إدارة الموارد البشرية) وتعديل الملف. الشريط اللي تحته بيقول الملف مكتمل بنسبة كام ويعرض بالظبط الناقص؛ اضغط على أي بند عشان تكمله.
4. تبويبات الملف: نظرة عامة، الوظيفة (فين بيشتغل دلوقتي والنموذج وسجل التنقلات)، الراتب (بصلاحية المرتبات)، المستندات، الحضور (تسجيلات النهارده وآخر 30 يوم)، الإجازات (الأرصدة والطلبات)، المخالفات، قوائم المهام، الفريق، السجل. التبويب بيفضل في العنوان، فاللينك بيفتح نفس التبويب.
5. المستندات: ارفع صورة أو PDF لكل نوع مطلوب؛ الرفع الجديد بيحتفظ بالقديم كنسخة. اتحقق من اللي الناس بعتوه من ملفي، أو ارفضه بملاحظة.
6. الهيكل التنظيمي: حسب المدير أو حسب القسم؛ البطاقات المنقطة أماكن شاغرة. صدّره صورة PNG أو اطبعه.
7. الإعدادات، التنظيم: الأقسام كشجرة على الجنب (اطوي أو افتح، الرئيس، العدد)؛ اختار قسم تشوف وظايفه بنطاق الدرجات والمخطط قصاد الفعلي وأيام الإجازة؛ وكل الوظائف والدرجات تبويبات. إضافة أو تعديل بيفتح لوحة جانبية.
8. الإعدادات، إعداد الحضور: الورديات والإجازات الرسمية في صفحة واحدة. أنواع الإجازات وأنواع المخالفات وأنواع المستندات (المستندات المطلوبة في كل ملف) وقوالب قوائم المهام (المهام عند انضمام أو مغادرة حد) في نفس القائمة.

**اتأكد إنها مشيت صح**

- الصفحة الرئيسية مفيهاش أحمر آخر اليوم؛ كل ملف مكتمل 100% وله وظيفة ودرجة ومدير؛ والهيكل التنظيمي فيه شخص واحد فوق.

**لو فيه مشكلة**

- اترفض بسبب دايرة مديرين: حد هيبقى مدير نفسه من خلال السلسلة؛ حدد المدير في الملف بدل كده.
- حد مش ظاهر في المرتبات: افتح تبويب الراتب وحدد الحزمة.
- لينك قديم للأقسام أو الوظائف أو الدرجات أو الورديات أو الإجازات الرسمية بيفتح صفحة الإعداد الجديدة على التبويب الصح.

### المستخدمين والإعدادات

1. المستخدمين: اعمل أعضاء الفريق بوظيفة (بتملا صلاحياتهم في كل تطبيق والمخازن اللي مسؤولين عنها)، ومناديب (بفرع وكارنيه)، وأصحاب حسابات التجار؛ عدّل صلاحيات أي حد من تعديل (محدش يغير صلاحياته بنفسه) وضيف رقم سلاك.
2. الإعدادات: دقائق الـSLA، السعة، الرسوم، مستويات إعادة التعبئة، ووقت الرد على التذاكر.

**اتأكد إنها مشيت صح**

- سجل التدقيق بيوري كل تغيير ومين عمله.

**لو فيه مشكلة**

- حد ساب الشغل: وقف المستخدم في نفس اليوم؛ بيخرج من كل الأجهزة.

### تشغيل إشعارات الموبايل

1. آيفون: افتح شيبلي ناو في سفاري، اضغط مشاركة، إضافة إلى الشاشة الرئيسية، وبعد كده افتحه دايما من الأيقونة (محتاج iOS 16.4 أو أحدث). أندرويد والكمبيوتر: أي متصفح شغال، وتثبيت التطبيق اختياري.
2. افتح قائمة الإعدادات (فوق في كل شاشة) وبعدين الإشعارات.
3. اضغط تفعيل الإشعارات على هذا الجهاز ووافق لما الموبايل يسأل.
4. اضغط أرسل لي إشعارًا تجريبيًا: لازم يوصل إشعار في ثواني.
5. اقفل الأنواع اللي مش محتاجها. بيوصلك: التنبيهات العاجلة (أخطاء السيرفر، الطلبات المتأخرة، التوصيل الفاشل، البضاعة اللي مرجعتش)، تسجيل التجار، التذاكر.

**اتأكد إنها مشيت صح**

- الصفحة مكتوب فيها إن الإشعارات مفعّلة على الجهاز والتجربة وصلت.
- لما تدوس على الإشعار بيفتح الشاشة الصح في شيبلي ناو.

**لو فيه مشكلة**

- محظورة: اسمح بالإشعارات للموقع من إعدادات المتصفح أو الموبايل وفعّلها تاني.
- التجربة ما وصلتش: اتأكد إن الموبايل مش على عدم الإزعاج أو توفير البطارية وابعت تجربة تانية.
- موبايل ضاع أو قديم: شيله من أجهزتك في نفس الصفحة.
