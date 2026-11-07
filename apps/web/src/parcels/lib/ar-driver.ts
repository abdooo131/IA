// Arabic for the driver apps: delivery codes, offline use, camera scanning, returns from
// customers, FlexShip, vehicle problems, the live map and the check of failed attempts.
export const AR_DRIVER: Record<string, string> = {
  // camera and location
  'Scan with the camera': 'امسح بالكاميرا',
  'Point the camera at the label': 'وجّه الكاميرا على البوليصة',
  'Could not open the camera. Allow camera access, or type the code':
    'لم نتمكن من فتح الكاميرا. اسمح بالوصول للكاميرا أو اكتب الكود',
  Close: 'إغلاق',
  'Location is blocked. Allow it in the browser so the hub can see where you are':
    'الموقع مقفول. اسمح به من المتصفح حتى يرى الهب مكانك',

  // offline
  'No signal. Showing your run as saved at {time}. Results are kept on the phone and sent later.':
    'لا توجد شبكة. هذا مسارك كما حُفظ الساعة {time}. النتائج تُحفظ على الموبايل وتُرسل لاحقا.',
  '{n} results wait on the phone and will be sent when there is signal':
    '{n} نتيجة محفوظة على الموبايل وستُرسل عند وجود شبكة',
  'A saved result was refused': 'نتيجة محفوظة تم رفضها',
  'Saved on the phone, sends when there is signal': 'محفوظ على الموبايل، يُرسل عند وجود شبكة',
  'No signal, and the phone has no room to keep this. Try again when you have signal':
    'لا توجد شبكة ولا توجد مساحة على الموبايل لحفظ هذا. حاول مرة أخرى عند وجود شبكة',

  // delivery code
  'Code from the customer': 'الكود من العميل',
  'Code from the merchant': 'الكود من التاجر',
  'Ask for the 4 numbers in their SMS only after they have the parcel':
    'اطلب الأرقام الأربعة من الرسالة بعد أن يستلم الشحنة فقط',
  'Send again': 'أرسل مرة أخرى',
  'A new code is on its way to the receiver': 'تم إرسال كود جديد للمستلم',
  'Three codes were already sent for this parcel today':
    'تم إرسال ثلاثة أكواد لهذه الشحنة اليوم بالفعل',
  'Wrong code. Ask the receiver for the code in the SMS':
    'الكود غلط. اطلب من المستلم الكود الموجود في الرسالة',
  'The code has expired. Send a new one to the receiver': 'الكود انتهى. أرسل كودا جديدا للمستلم',
  'Too many wrong codes. Send a new one to the receiver':
    'محاولات خاطئة كثيرة. أرسل كودا جديدا للمستلم',
  Photo: 'صورة',
  'Optional proof of the hand over': 'إثبات اختياري للتسليم',
  'Delivery code': 'كود الاستلام',
  'The receiver gives the courier the code sent to their phone':
    'المستلم يعطي المندوب الكود المرسل على موبايله',

  // returns from customers
  'Collect a return from the customer': 'استلام مرتجع من العميل',
  Collected: 'تم الاستلام',
  'Take a photo of the item in front of the customer, then bring it to the hub.':
    'صوّر المنتج أمام العميل ثم أحضره للهب.',
  'Photo of the return': 'صورة المرتجع',
  'Condition of the item': 'حالة المنتج',
  'Return collected, bring it to the hub': 'تم استلام المرتجع، أحضره للهب',
  'Return collected. Bring it to the hub': 'تم استلام المرتجع. أحضره للهب',
  'This stop is a return to collect. Use Collect return and take a photo':
    'هذه المحطة مرتجع للاستلام. استخدم تم الاستلام والتقط صورة',
  'Return from a customer: the courier collects the item from them and brings it to you':
    'مرتجع من عميل: المندوب يستلم المنتج منه ويحضره لك',
  'A return from a customer has no cash to collect, no exchange and no opening':
    'المرتجع من العميل ليس عليه تحصيل ولا استبدال ولا فتح',
  'Returns to collect from customers ({n})': 'مرتجعات للاستلام من العملاء ({n})',
  'Visit {n}': 'زيارة {n}',
  'Add to run': 'أضف للمسار',
  'Added: collect the return from the customer': 'تمت الإضافة: استلم المرتجع من العميل',
  'Customer return received. It goes back to the merchant': 'تم استلام مرتجع العميل. سيعود للتاجر',
  'Recorded. The return will be tried again': 'تم التسجيل. سيُعاد المحاولة لاستلام المرتجع',
  'Recorded. The return request is closed after too many visits':
    'تم التسجيل. أُغلق طلب المرتجع بعد زيارات كثيرة',

  // failure details
  'Which day did the customer ask for?': 'أي يوم طلبه العميل؟',
  'Pick the day the customer asked for, from tomorrow on':
    'اختر اليوم الذي طلبه العميل، من الغد فصاعدا',
  'A delivery can be postponed by two weeks at most': 'يمكن تأجيل التوصيل أسبوعين بحد أقصى',
  'FlexShip: did the customer pay the shipping of {amount}?':
    'FlexShip: هل دفع العميل الشحن {amount}؟',
  'Yes, paid': 'نعم، دفع',
  'No, refused to pay': 'لا، رفض الدفع',
  'Shipping is only collected from a customer who refuses a FlexShip parcel':
    'الشحن يُحصّل فقط من عميل رفض شحنة FlexShip',
  'Refused, shipping paid {amount}. Bring it back': 'رفض الاستلام ودفع الشحن {amount}. أرجعها للهب',
  'Recorded. Keep the shipping cash with the run cash and bring the parcel back':
    'تم التسجيل. احتفظ بفلوس الشحن مع فلوس المسار وأرجع الشحنة',
  'Quality calls the customer to check every failed attempt.':
    'الجودة تتصل بالعميل لمراجعة كل محاولة فاشلة.',
  'FlexShip: a customer who refuses may pay the shipping':
    'FlexShip: العميل الذي يرفض الاستلام يمكنه دفع الشحن',

  // vehicle
  'Problem with your vehicle?': 'مشكلة في المركبة؟',
  'Where are you, what happened': 'أين أنت وماذا حدث',
  'It broke down': 'عطلت',
  'It is full': 'ممتلئة',
  'Your agent was asked for a vehicle ({code})': 'تم طلب مركبة من الوكيل ({code})',
  'Operations were told': 'تم إبلاغ العمليات',

  // live map
  'Couriers on the road': 'المناديب في الطريق',
  'Where each courier is and how far their run is': 'مكان كل مندوب وإلى أين وصل في مساره',
  'Each courier phone sends its place about once a minute while the app is open. Refreshes every minute':
    'موبايل كل مندوب يرسل مكانه تقريبا كل دقيقة والتطبيق مفتوح. تتحدث الصفحة كل دقيقة',
  'No courier phone has sent a location in the last 12 hours':
    'لم يرسل أي مندوب موقعه خلال آخر 12 ساعة',
  'Last seen': 'آخر ظهور',
  Now: 'الآن',
  '{n} min ago': 'منذ {n} دقيقة',
  'No run': 'بدون مسار',
  'Open map': 'افتح الخريطة',
  '{p} location updates and {s} stops on this day. Green delivered, red failed, blue returns':
    '{p} تحديث للموقع و{s} محطة في هذا اليوم. الأخضر تسليم والأحمر فشل والأزرق مرتجعات',
  'No location sent': 'لم يُرسل موقع',
  Checked: 'تمت المراجعة',
  Place: 'المكان',

  // checking failed attempts
  'Check failed attempts': 'مراجعة المحاولات الفاشلة',
  'Call the customer and confirm what the courier recorded': 'اتصل بالعميل وتأكد مما سجله المندوب',
  'Call the customer: did the courier really come? A false reason opens a quality ticket against the courier':
    'اتصل بالعميل: هل جاء المندوب فعلا؟ السبب غير الصحيح يفتح تذكرة جودة على المندوب',
  'To check': 'للمراجعة',
  'Nothing to check. Every attempt of the last 7 days is checked':
    'لا شيء للمراجعة. كل محاولات آخر 7 أيام تمت مراجعتها',
  'Nothing checked in the last 7 days': 'لا مراجعات خلال آخر 7 أيام',
  Genuine: 'صحيح',
  'Not true': 'غير صحيح',
  'What did the customer say?': 'ماذا قال العميل؟',
  'Penalty, EGP': 'الغرامة بالجنيه',
  'Open ticket': 'افتح تذكرة',
  'Ticket opened': 'تم فتح التذكرة',
  'Marked as genuine': 'تم تأكيد أنها صحيحة',
  'FlexShip paid {amount}': 'FlexShip مدفوع {amount}',
  'New day': 'اليوم الجديد',
  'Where the courier stood': 'مكان المندوب',
  'Failed attempts stay here for 7 days.': 'المحاولات الفاشلة تظهر هنا لمدة 7 أيام.',
  'This attempt was already checked': 'تمت مراجعة هذه المحاولة بالفعل',
  'Say what the customer told you': 'اكتب ما قاله العميل',

  // settings
  'Courier location updates': 'تحديث موقع المندوب',
  'Seconds between location updates from a working phone':
    'الثواني بين كل تحديث لموقع موبايل المندوب',
  'Automatic pickups': 'استلام تلقائي',
  'Book a pickup when a merchant has parcels waiting and none booked':
    'احجز استلاما عندما يكون عند التاجر شحنات ولا يوجد استلام محجوز',
  'Booked automatically': 'محجوز تلقائيا',
};
