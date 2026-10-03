/* Reference lists for the demo data generator. Names are invented; any resemblance to real businesses is accidental. */

export interface Category {
  key: string;
  en: string[];
  ar: string[];
  suffixEn: string[];
  suffixAr: string[];
  items: string[];
  cod: [number, number]; // EGP range
  sizes: string[];
}

export const CATEGORIES: Category[] = [
  {
    key: 'fashion',
    en: ['Nour', 'Layla', 'Zeina', 'Kemet', 'Farida', 'Malak', 'Salma', 'Jana', 'Hana', 'Yara', 'Dahab', 'Nefertari', 'Mira', 'Lina'],
    ar: ['نور', 'ليلى', 'زينة', 'كيميت', 'فريدة', 'ملك', 'سلمى', 'جنى', 'هنا', 'يارا', 'دهب', 'نفرتاري', 'ميرا', 'لينا'],
    suffixEn: ['Boutique', 'Couture', 'Closet', 'Wear', 'Atelier', 'Studio', 'Modest Wear', 'Abayas'],
    suffixAr: ['بوتيك', 'كوتور', 'كلوزيت', 'وير', 'أتيليه', 'ستوديو', 'للأزياء المحتشمة', 'عبايات'],
    items: ['Linen dress', 'Satin blouse', 'Wide leg trousers', 'Cotton abaya', 'Knit cardigan', 'Two piece set', 'Denim jacket', 'Maxi skirt', 'Hijab set (3 pcs)', 'Evening dress'],
    cod: [350, 2800],
    sizes: ['SMALL_MEDIUM', 'SMALL_MEDIUM', 'SMALL_MEDIUM', 'LARGE'],
  },
  {
    key: 'beauty',
    en: ['Lotus', 'Bloom', 'Amira', 'Jasmine', 'Velvet', 'Rosa', 'Glow', 'Aloe', 'Sahara', 'Nile'],
    ar: ['لوتس', 'بلوم', 'أميرة', 'ياسمين', 'فيلفت', 'روزا', 'جلو', 'ألوفيرا', 'صحارى', 'النيل'],
    suffixEn: ['Beauty', 'Skincare', 'Cosmetics', 'Organics', 'Naturals'],
    suffixAr: ['بيوتي', 'للعناية بالبشرة', 'كوزمتكس', 'أورجانكس', 'ناتشورالز'],
    items: ['Vitamin C serum', 'Hair oil 100ml', 'Lip tint set', 'Sunscreen SPF50', 'Body butter', 'Rose water toner', 'Argan shampoo', 'Makeup brush set'],
    cod: [150, 1100],
    sizes: ['SMALL_MEDIUM'],
  },
  {
    key: 'electronics',
    en: ['Tech', 'Gadget', 'Volt', 'Pixel', 'Nile', 'Smart', 'Byte', 'Orbit'],
    ar: ['تك', 'جادجت', 'فولت', 'بيكسل', 'النيل', 'سمارت', 'بايت', 'أوربت'],
    suffixEn: ['Hub Egypt', 'Souq', 'Mobile', 'Store', 'Accessories'],
    suffixAr: ['هب مصر', 'سوق', 'موبايل', 'ستور', 'للإكسسوارات'],
    items: ['Wireless earbuds', 'Power bank 20000mAh', 'Smart watch', 'Phone case + screen protector', 'Bluetooth speaker', 'USB-C fast charger', 'Gaming mouse', 'Mechanical keyboard'],
    cod: [450, 9500],
    sizes: ['SMALL_MEDIUM', 'SMALL_MEDIUM', 'LARGE'],
  },
  {
    key: 'home',
    en: ['Dar', 'Beit', 'Nakhla', 'Oasis', 'Cotton', 'Kanaba', 'Arabesque', 'Fayrouz'],
    ar: ['دار', 'بيت', 'نخلة', 'واحة', 'قطن', 'كنبة', 'أرابيسك', 'فيروز'],
    suffixEn: ['Home', 'Decor', 'Living', 'Linens', 'Kitchenware'],
    suffixAr: ['هوم', 'ديكور', 'ليفينج', 'للمفروشات', 'لأدوات المطبخ'],
    items: ['Bed sheet set (king)', 'Ceramic dinner set', 'Cushion covers x4', 'Bath towel set', 'Table lamp', 'Wall clock', 'Non stick pan set', 'Storage boxes'],
    cod: [400, 4200],
    sizes: ['LARGE', 'XLARGE', 'SMALL_MEDIUM', 'XXL_WHITE_BAG'],
  },
  {
    key: 'kids',
    en: ['Baby', 'Little', 'Toto', 'Bambino', 'Teddy', 'Mini'],
    ar: ['بيبي', 'ليتل', 'توتو', 'بامبينو', 'تيدي', 'ميني'],
    suffixEn: ['Kids', 'Corner', 'World', 'Steps', 'Toys'],
    suffixAr: ['كيدز', 'كورنر', 'وورلد', 'ستيبس', 'للألعاب'],
    items: ['Baby romper set', 'Building blocks', 'Kids sneakers', 'School backpack', 'Plush toy', 'Baby carrier'],
    cod: [200, 1800],
    sizes: ['SMALL_MEDIUM', 'LARGE'],
  },
  {
    key: 'sports',
    en: ['Pharaoh', 'Fit', 'Peak', 'Delta', 'Sprint', 'Pulse'],
    ar: ['فرعون', 'فيت', 'بيك', 'دلتا', 'سبرينت', 'بالس'],
    suffixEn: ['Sports', 'Active', 'Gym Gear', 'Outdoors'],
    suffixAr: ['سبورتس', 'أكتيف', 'لمعدات الجيم', 'للرحلات'],
    items: ['Yoga mat', 'Running shoes', 'Dumbbell pair 5kg', 'Sports leggings', 'Gym bag', 'Protein shaker'],
    cod: [250, 3500],
    sizes: ['SMALL_MEDIUM', 'LARGE', 'XLARGE'],
  },
  {
    key: 'food',
    en: ['Om Ali', 'Konafa', 'Baladi', 'Fresh', 'Sweet', 'Date Palm'],
    ar: ['أم علي', 'كنافة', 'بلدي', 'فريش', 'سويت', 'نخيل'],
    suffixEn: ['Sweets', 'Bakery', 'Pantry', 'Dates', 'Spices'],
    suffixAr: ['للحلويات', 'بيكري', 'بانتري', 'للتمور', 'للتوابل'],
    items: ['Assorted dates box', 'Basbousa tray', 'Spice gift box', 'Honey jar 1kg', 'Oriental sweets 1kg', 'Coffee beans 500g'],
    cod: [150, 900],
    sizes: ['SMALL_MEDIUM'],
  },
  {
    key: 'books',
    en: ['Maktaba', 'Qalam', 'Waraq', 'Hikaya'],
    ar: ['مكتبة', 'قلم', 'ورق', 'حكاية'],
    suffixEn: ['Books', 'Stationery', 'Bookshop'],
    suffixAr: ['للكتب', 'للأدوات المكتبية', 'بوكشوب'],
    items: ['Novel bundle (3 books)', 'Notebook set', 'Planner 2027', 'Art supplies kit', 'Children story books'],
    cod: [120, 900],
    sizes: ['SMALL_MEDIUM'],
  },
];

export const FIRST_EN = ['Mohamed', 'Ahmed', 'Mahmoud', 'Mostafa', 'Omar', 'Youssef', 'Karim', 'Hassan', 'Ali', 'Amr', 'Khaled', 'Tarek', 'Sherif', 'Hany',
  'Mona', 'Sara', 'Nour', 'Yasmin', 'Aya', 'Mariam', 'Salma', 'Habiba', 'Dina', 'Rana', 'Laila', 'Heba', 'Nada', 'Reem', 'Farida', 'Hana', 'Menna', 'Shahd'];
export const LAST_EN = ['Adel', 'Hassan', 'Ibrahim', 'Mostafa', 'Samir', 'Fathy', 'Mahmoud', 'Saeed', 'Abdelrahman', 'Kamal', 'Fawzy', 'Nabil', 'Gamal', 'Salah',
  'Ezzat', 'Youssef', 'Shaker', 'Hamdy', 'Lotfy', 'Ramadan', 'Soliman', 'Farouk', 'Zaki', 'Hegazy', 'Morsy', 'Ashraf'];
export const FIRST_AR = ['محمد', 'أحمد', 'محمود', 'مصطفى', 'عمر', 'يوسف', 'كريم', 'حسن', 'علي', 'عمرو', 'منى', 'سارة', 'نور', 'ياسمين', 'آية', 'مريم', 'سلمى', 'حبيبة', 'دينا', 'رنا', 'هبة', 'ندى', 'ريم', 'منة'];
export const LAST_AR = ['عادل', 'حسن', 'إبراهيم', 'مصطفى', 'سمير', 'فتحي', 'محمود', 'سعيد', 'كمال', 'فوزي', 'نبيل', 'جمال', 'صلاح', 'يوسف', 'حمدي', 'رمضان', 'سليمان', 'فاروق'];

export const STREETS_EN = ['Street 9', 'Road 233', 'El Nasr St', 'Abbas El Akkad St', 'Makram Ebeid St', 'El Tahrir St', 'Gameat El Dowal St', 'Shehab St', 'El Thawra St',
  '26 July St', 'El Merghany St', 'Mostafa El Nahas St', 'El Hegaz St', 'Gesr El Suez St', 'El Haram St', 'Faisal St', 'Corniche Rd', 'El Gaish St', 'Port Said St', 'Salah Salem St'];
export const STREETS_AR = ['شارع ٩', 'شارع ٢٣٣', 'شارع النصر', 'شارع عباس العقاد', 'شارع مكرم عبيد', 'شارع التحرير', 'شارع جامعة الدول', 'شارع شهاب', 'شارع الثورة', 'شارع الحجاز', 'شارع الهرم', 'شارع فيصل'];

/** Extra hubs and areas so orders outside Cairo and Giza have somewhere to go. */
export const REGIONAL_HUBS = [
  { code: 'ALX', nameEn: 'Alexandria Hub', nameAr: 'مركز الإسكندرية', gov: 'ALX', address: 'Smouha, Alexandria', lat: 31.214, lng: 29.945, receivesPickups: false, dispatchesLastMile: true },
  { code: 'TANTA', nameEn: 'Tanta Hub', nameAr: 'مركز طنطا', gov: 'GHR', address: 'El Gaish St, Tanta', lat: 30.786, lng: 31.0, receivesPickups: false, dispatchesLastMile: true },
  { code: 'MANS', nameEn: 'Mansoura Hub', nameAr: 'مركز المنصورة', gov: 'DAK', address: 'El Gomhoreya St, Mansoura', lat: 31.04, lng: 31.38, receivesPickups: false, dispatchesLastMile: true },
  { code: 'ASYUT', nameEn: 'Asyut Hub', nameAr: 'مركز أسيوط', gov: 'AST', address: 'El Thawra St, Asyut', lat: 27.18, lng: 31.183, receivesPickups: true, dispatchesLastMile: true },
];

export const REGIONAL_AREAS = [
  { gov: 'GHR', en: 'Tanta', ar: 'طنطا', lat: 30.7865, lng: 31.0004 },
  { gov: 'GHR', en: 'El Mahalla', ar: 'المحلة الكبرى', lat: 30.97, lng: 31.166 },
  { gov: 'DAK', en: 'Mansoura', ar: 'المنصورة', lat: 31.0409, lng: 31.3785 },
  { gov: 'SHR', en: 'Zagazig', ar: 'الزقازيق', lat: 30.5877, lng: 31.502 },
  { gov: 'MNF', en: 'Shebin El Kom', ar: 'شبين الكوم', lat: 30.5972, lng: 30.9876 },
  { gov: 'QLY', en: 'Banha', ar: 'بنها', lat: 30.4659, lng: 31.1848 },
  { gov: 'ISM', en: 'Ismailia City', ar: 'الإسماعيلية', lat: 30.5965, lng: 32.2715 },
  { gov: 'PTS', en: 'Port Said City', ar: 'بورسعيد', lat: 31.2653, lng: 32.3019 },
  { gov: 'MNY', en: 'Minya City', ar: 'المنيا', lat: 28.0871, lng: 30.7618 },
  { gov: 'SHG', en: 'Sohag City', ar: 'سوهاج', lat: 26.5591, lng: 31.6957 },
  { gov: 'LXR', en: 'Luxor City', ar: 'الأقصر', lat: 25.6872, lng: 32.6396 },
  { gov: 'RSE', en: 'Hurghada', ar: 'الغردقة', lat: 27.2579, lng: 33.8116 },
];

/** Where customers live: weight per destination area name (areas seeded or added above). */
export const DESTINATION_WEIGHTS: [string, number][] = [
  ['Maadi', 7], ['Zahraa El Maadi', 3], ['Nasr City', 8], ['Heliopolis', 6], ['New Cairo', 9], ['Rehab', 3], ['Madinaty', 3], ['Shorouk', 2],
  ['Downtown', 2], ['Zamalek', 2], ['Garden City', 1], ['Mokattam', 3], ['Shubra', 3], ['Ain Shams', 2], ['Helwan', 2], ['Obour', 2],
  ['Dokki', 4], ['Mohandessin', 5], ['Agouza', 2], ['Haram', 4], ['Faisal', 4], ['6th of October', 6], ['Sheikh Zayed', 5], ['Imbaba', 2], ['Hadayek El Ahram', 2],
  ['Smouha', 4], ['Sidi Gaber', 2], ['Miami', 2], ['Agami', 1],
  ['Tanta', 2], ['El Mahalla', 1], ['Mansoura', 3], ['Zagazig', 1], ['Shebin El Kom', 1], ['Banha', 1],
  ['Asyut City', 2], ['Minya City', 1], ['Sohag City', 1], ['Luxor City', 1], ['Hurghada', 1],
  ['El Alamein', 1], ['Marina', 1], ['Ismailia City', 1], ['Port Said City', 1],
];

export const COMPENSATION_REASONS = ['Parcel damaged in transit', 'Item lost at hub', 'Wrong item delivered', 'Late delivery goodwill'];
export const DEDUCTION_REASONS = ['Wrong package size declared', 'Repeated address errors'];
