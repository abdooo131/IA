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

1. Merchants: open a merchant; the tabs are Overview, Contract, Shopify, Products and stock, Users, Profit (with Accounting) and History.
2. Contract, Edit (new version): every price beside the standard one (leave empty for the standard price), volume tiers on any fee (Orders a month: from the nth delivered order, the prices that change), payment terms (payout schedule, minimum payout, monthly minimum, deposit, credit limit), promises (delivery promise, attempts included, stores, areas), dates, special terms and an internal note. Save draft changes nothing yet.
3. Check the draft with the calculator (a cash order, a month of orders and units), then Activate from today or a later day. Charges from that day use the new version; earlier versions stay in Versions and print as before.
4. Attach the signed copy (PDF, JPG or PNG up to 5 MB) under Signed copies, and print the contract in English or Arabic from PDF English / PDF عربي.
5. The payout bank account is edited from the contract's payment terms.
6. Tiers apply from the order that crosses the band, never to earlier orders of the month; unit fees and failed deliveries use the band of the next delivered order.

**Check it went right**

- The merchant sees the contract in force read only under Contract (with the PDF); History shows every draft, activation and file.
- Accounting's fee settings are only the standard prices: a merchant's own price is in their contract.

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

### Hiring and leaving (HR)

1. New hire (HR home or Employee list): fill Person, Job, Pay (only with the salaries switch), Documents, System access, then Review. Every Next saves a draft; Save and finish later keeps it under Hires to finish on the HR home.
2. Documents step: drop several files at once or take photos with the phone, then tap the type of each from the list of what this job needs. Anything missing can come later.
3. System access: give a login (the job role comes from the position; pick the stores) or no login for people who never use the system. Riders always get a login.
4. Create: copy the one time setup link at once and send it to the person; they open it to choose their password. Lost it? Their file shows Waiting for their password with New setup link.
5. Someone leaving: on the file, Start leaving. Pick the last working day and the reason, the notice date, tick the company items returned, read the settlement figures for payroll, give their people, department, merchants and deals to someone (or later), then Confirm.
6. Their account closes by itself at the end of the last day. Anything left for later shows under Needs a new owner on the HR home; give each one an owner.
7. Documents: on a file tap Remind on a missing or expiring document (or Remind of everything missing); the person gets a notification and a notice in My HR, once a day. Documents, Expiry calendar shows what runs out each day of the month.

**Check it went right**

- No hire waits under Hires to finish for more than a day; Needs a new owner is empty; every new hire opened their setup link within the week.

**If something is wrong**

- The pay step is missing: you do not have the salaries switch; the HR manager adds the package (New hires wait for pay on the HR home).
- Only someone with settings manage can give the Owner job role; ask them, or pick another role.
- Email or mobile already used: the person may already have an account; search the employee list first.
- The leaving wizard refuses the last owner: give settings manage to someone else first.

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

1. التجار: افتح التاجر؛ التبويبات: نظرة عامة، العقد، شوبيفاي، المنتجات والمخزون، المستخدمون، الربحية (مع الحسابات) والسجل.
2. العقد، تعديل (إصدار جديد): كل سعر جنب السعر القياسي (سيبه فاضي للسعر القياسي)، وشرائح الحجم على أي رسم (الطلبات في الشهر: من الطلب رقم n، والأسعار اللي بتتغير)، وشروط الدفع (مواعيد التحويل، الحد الأدنى للتحويل، الحد الأدنى الشهري، التأمين، حد الائتمان)، والالتزامات (مدة التوصيل، المحاولات، المخازن، المناطق)، والتواريخ والشروط الخاصة وملاحظة داخلية. حفظ المسودة مش بيغير حاجة لسه.
3. راجع المسودة بالحاسبة (طلب نقدي، وشهر طلبات ووحدات)، وبعدين فعلها من النهارده أو يوم بعده. الرسوم من اليوم ده بتتحسب بالإصدار الجديد؛ والإصدارات القديمة موجودة في الإصدارات وبتتطبع زي ما هي.
4. ارفع النسخة الموقعة (PDF أو JPG أو PNG لحد 5 ميجا) في النسخ الموقعة، واطبع العقد عربي أو إنجليزي من PDF عربي / PDF English.
5. الحساب البنكي للتحويلات بيتعدل من شروط الدفع في العقد.
6. الشريحة بتتطبق من الطلب اللي بيعدي الحد، ومش على الطلبات اللي قبله في الشهر؛ ورسوم الوحدات والتوصيل الفاشل بتاخد شريحة الطلب الجاي.

**اتأكد إنها مشيت صح**

- التاجر بيشوف العقد الساري للعرض بس تحت العقد (مع الـPDF)؛ والسجل بيوري كل مسودة وتفعيل وملف.
- إعدادات الرسوم في الحسابات هي الأسعار القياسية بس: سعر التاجر الخاص في عقده.

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

### التعيين والمغادرة (الموارد البشرية)

1. تعيين جديد (من الصفحة الرئيسية للموارد البشرية أو قائمة الموظفين): املا البيانات الشخصية والوظيفة والراتب (بصلاحية المرتبات بس) والمستندات والدخول على النظام وبعدين المراجعة. كل التالي بيحفظ مسودة؛ احفظ وكمّل بعدين بيخليها تحت تعيينات لم تكتمل في الصفحة الرئيسية.
2. خطوة المستندات: اسحب أكتر من ملف مرة واحدة أو صوّر بالموبايل، وبعدين اختار نوع كل واحد من قائمة اللي الوظيفة محتاجاه. أي ناقص ممكن ييجي بعدين.
3. الدخول على النظام: ادّي حساب دخول (الدور الوظيفي بييجي من الوظيفة؛ اختار المخازن) أو من غير دخول للي مش بيستخدموا النظام. المناديب دايمًا ليهم حساب دخول.
4. إنشاء: انسخ رابط الإعداد اللي بيظهر مرة واحدة على طول وابعته للشخص؛ بيفتحه ويختار كلمة السر. ضاع؟ ملفه بيقول بانتظار اختيار كلمة المرور وفيه رابط إعداد جديد.
5. حد ماشي: من الملف، بدء إنهاء الخدمة. اختار آخر يوم شغل والسبب وتاريخ الإخطار، علّم على العهدة اللي اتسلمت، اقرا أرقام المخالصة للمرتبات، سلّم الناس والقسم والتجار والصفقات لحد (أو بعدين)، وبعدين أكّد.
6. حسابه بيتقفل لوحده في نهاية آخر يوم. أي حاجة اتسابت لبعدين بتظهر تحت يحتاج مسؤولًا جديدًا في الصفحة الرئيسية؛ ادّي كل واحدة لمسؤول.
7. المستندات: في الملف اضغط تذكير على مستند ناقص أو هيخلص (أو التذكير بكل النواقص)؛ الشخص بيوصله إشعار وتنبيه في ملفي، مرة واحدة في اليوم. المستندات، تقويم الانتهاء بيوريك اللي بيخلص كل يوم في الشهر.

**اتأكد إنها مشيت صح**

- مفيش تعيين مستني تحت تعيينات لم تكتمل أكتر من يوم؛ يحتاج مسؤولًا جديدًا فاضية؛ وكل موظف جديد فتح رابط الإعداد في نفس الأسبوع.

**لو فيه مشكلة**

- خطوة الراتب مش ظاهرة: معندكش صلاحية المرتبات؛ مدير الموارد البشرية بيضيف الحزمة (تعيينات جديدة بانتظار الراتب في الصفحة الرئيسية).
- دور المالك بيدّيه بس اللي معاه إدارة الإعدادات؛ اطلب منه أو اختار دور تاني.
- الإيميل أو الموبايل مستخدم: ممكن الشخص له حساب أصلًا؛ دوّر في قائمة الموظفين الأول.
- معالج إنهاء الخدمة رافض لأنه آخر مالك: ادّي إدارة الإعدادات لحد تاني الأول.

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
