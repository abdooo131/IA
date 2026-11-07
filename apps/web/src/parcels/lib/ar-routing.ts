// Arabic for routing, coverage and picking Shopify orders.
export const AR_ROUTING: Record<string, string> = {
  Merchant: 'التاجر',
  Customer: 'العميل',
  'Its way through our network': 'طريقها داخل شبكتنا',
  'Where we deliver': 'أماكن التوصيل',
  'We pick up and deliver only in governorates and areas that have a last mile hub. Give a governorate a hub below to open it.':
    'نستلم ونوصل فقط في المحافظات والمناطق التي لها مركز توزيع. اختر مركزا للمحافظة بالأسفل لفتحها.',
  'Nowhere yet': 'لا يوجد بعد',
  '{n} of {m} governorates served': '{n} من {m} محافظة مخدومة',
  'Truck routes between facilities': 'خطوط النقل بين مراكز الفرز',
  'A parcel goes from the facility nearest the merchant to the facility that feeds the customer hub. With no truck routes listed, every facility sends straight to every other one. Once you list routes, parcels follow them and may pass through up to two facilities in between.':
    'الشحنة تذهب من مركز الفرز الأقرب للتاجر إلى مركز الفرز الذي يغذي مركز توزيع العميل. إذا لم تُسجل خطوط نقل، يرسل كل مركز فرز مباشرة لأي مركز آخر. بعد تسجيل الخطوط تتبعها الشحنات وقد تمر بمركزين بحد أقصى في الطريق.',
  From: 'من',
  To: 'إلى',
  Hours: 'ساعات',
  'Both ways': 'في الاتجاهين',
  Add: 'إضافة',
  'No truck routes listed: every facility sends straight to every other one':
    'لا توجد خطوط نقل مسجلة: كل مركز فرز يرسل مباشرة لأي مركز آخر',
  'Hours on the road': 'ساعات الطريق',
  Remove: 'حذف',
  Removed: 'تم الحذف',
  'Try a route': 'جرّب مسارا',
  'From a merchant': 'من تاجر',
  'Any merchant in a governorate': 'أي تاجر في محافظة',
  'Pickup governorate': 'محافظة الاستلام',
  'To governorate': 'إلى محافظة',
  Any: 'أي منطقة',
  'Show the way': 'اعرض الطريق',
  'No route': 'لا يوجد طريق',
  '{n} facilities in between': '{n} مركز فرز في الطريق',
  'No facility in between': 'بدون مراكز فرز في الطريق',
  '{n} days': '{n} أيام',
  'We do not pick up from your area yet': 'لا نستلم من منطقتك بعد',
  'Truck routes join sorting facilities only': 'خطوط النقل تربط مراكز الفرز فقط',
  'Pick two different facilities': 'اختر مركزين مختلفين',

  // Shopify picking
  'Ship with Shiply': 'اشحن مع Shiply',
  'Check the orders you picked in Shopify. Fix anything marked red, then make the AWBs and print the labels. A courier picks them up from your warehouse.':
    'راجع الطلبات التي اخترتها في Shopify. عدّل ما هو باللون الأحمر ثم أنشئ البوالص واطبع الملصقات. سيستلمها مندوب من مخزنك.',
  'This link could not be checked. Open it again from Shopify':
    'تعذر التحقق من الرابط. افتحه مرة أخرى من Shopify',
  'This link has expired. Pick the orders in Shopify again':
    'انتهت صلاحية الرابط. اختر الطلبات في Shopify مرة أخرى',
  'This page has expired. Pick the orders in Shopify again':
    'انتهت صلاحية الصفحة. اختر الطلبات في Shopify مرة أخرى',
  'This store is not connected to Shiply. Connect it from your Shiply panel first':
    'هذا المتجر غير مربوط بـ Shiply. اربطه من لوحة Shiply أولا',
  'No orders were picked. Tick orders in Shopify, then choose Ship with Shiply':
    'لم يتم اختيار طلبات. علّم الطلبات في Shopify ثم اختر اشحن مع Shiply',
  'Shopify did not send the orders. Try again in a minute':
    'Shopify لم يرسل الطلبات. حاول بعد دقيقة',
  'Open this page from Shopify: tick orders, then choose Ship with Shiply':
    'افتح هذه الصفحة من Shopify: علّم الطلبات ثم اختر اشحن مع Shiply',
  'None of the picked orders could be read': 'تعذرت قراءة الطلبات المختارة',
  AWB: 'بوليصة',
  Ready: 'جاهز',
  Paid: 'مدفوع',
  'We deliver to': 'نوصل إلى',
  '{n} orders picked': '{n} طلب مختار',
  'Make AWBs': 'أنشئ البوالص',
  '{n} AWBs made': 'تم إنشاء {n} بوليصة',
  '{n} not made': '{n} لم تُنشأ',
  'Back to the orders': 'رجوع للطلبات',
  'Print labels': 'اطبع الملصقات',
  '{n} orders were not made:': '{n} طلب لم يُنشأ:',
  'Bring in open orders': 'اجلب الطلبات المفتوحة',
  'No new open orders in Shopify': 'لا توجد طلبات مفتوحة جديدة في Shopify',
  'New orders brought in': 'تم جلب الطلبات الجديدة',
  'Tick the orders you want to ship with us and make their AWBs. You can also tick them in your Shopify orders list and choose Ship with Shiply.':
    'علّم الطلبات التي تريد شحنها معنا وأنشئ بوالصها. يمكنك أيضا تعليمها في قائمة طلبات Shopify واختيار اشحن مع Shiply.',
  'AWBs made. The labels opened in a new tab': 'تم إنشاء البوالص. فُتحت الملصقات في صفحة جديدة',
  'Make an AWB for every new order by itself (usually off: you pick the orders to ship)':
    'أنشئ بوليصة لكل طلب جديد تلقائيا (عادة مغلق: أنت تختار الطلبات للشحن)',
};
