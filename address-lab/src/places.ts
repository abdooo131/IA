// The list of places (the gazetteer). This is the part that decides how good the tester is:
// add the ways people really write a place to `names` and it is found.
//
// Kinds, from biggest to smallest: governorate, city or district, neighbourhood, compound.
// Landmarks and streets point at the area they sit in.
// `needsParent`: a generic or shared name ("Hay 7", "El Yasmeen") that only counts when a
// place above it is also written in the address.
// `served: false`: a governorate outside Greater Cairo.

export type Kind =
  | 'governorate'
  | 'city'
  | 'district'
  | 'neighbourhood'
  | 'compound'
  | 'landmark'
  | 'street';

export interface Place {
  id: string;
  kind: Kind;
  parent?: string;
  en: string;
  ar: string;
  names?: string[];
  needsParent?: boolean;
  served?: boolean;
}

const P: Place[] = [];
function add(
  kind: Kind,
  id: string,
  parent: string | undefined,
  en: string,
  ar: string,
  names: string[] = [],
  extra: Partial<Place> = {},
) {
  P.push({ id, kind, parent, en, ar, names, ...extra });
}
const gov = (id: string, en: string, ar: string, names: string[] = [], served = true) =>
  add('governorate', id, undefined, en, ar, names, { served });
const city = (id: string, parent: string, en: string, ar: string, names: string[] = []) =>
  add('city', id, parent, en, ar, names);
const dist = (id: string, parent: string, en: string, ar: string, names: string[] = []) =>
  add('district', id, parent, en, ar, names);
const hood = (
  id: string,
  parent: string,
  en: string,
  ar: string,
  names: string[] = [],
  extra: Partial<Place> = {},
) => add('neighbourhood', id, parent, en, ar, names, extra);
const comp = (
  id: string,
  parent: string,
  en: string,
  ar: string,
  names: string[] = [],
  extra: Partial<Place> = {},
) => add('compound', id, parent, en, ar, names, extra);
const mark = (
  id: string,
  parent: string,
  en: string,
  ar: string,
  names: string[] = [],
  extra: Partial<Place> = {},
) => add('landmark', id, parent, en, ar, names, extra);
const street = (
  id: string,
  parent: string,
  en: string,
  ar: string,
  names: string[] = [],
  extra: Partial<Place> = {},
) => add('street', id, parent, en, ar, names, extra);

// ── Governorates ──────────────────────────────────────────────────────────────
gov('cairo', 'Cairo', 'القاهرة', ['cairo governorate', 'el qahira', 'al qahira', 'kahera', 'el kahera', 'محافظة القاهرة', 'qahera']);
gov('giza', 'Giza', 'الجيزة', ['giza governorate', 'el giza', 'gizeh', 'geza', 'محافظة الجيزة']);
gov('qalyubia', 'Qalyubia', 'القليوبية', ['qalyoubia', 'kalyoubia', 'qaliubiya', 'el qalyubia', 'قليوبية']);

// ── Cairo: new cities ────────────────────────────────────────────────────────
city('new-cairo', 'cairo', 'New Cairo', 'القاهرة الجديدة', [
  'new cairo city', 'el kahera el gedida', 'kahera gedida', 'cairo gedida', 'التجمع', 'tagamoa', 'el tagamoa', 'tagamo', 'new cairo 1', 'new cairo 2', 'new cairo 3',
]);
hood('fifth-settlement', 'new-cairo', 'Fifth Settlement', 'التجمع الخامس', [
  '5th settlement', 'the 5th settlement', 'fifth settlement', 'el tagamoa el khames', 'tagamoa el khames', 'tagamoa khames', 'التجمع 5', 'تجمع خامس', 'tagamoa 5', 'el tagamoa 5', 'التجمع الخامس الجديد',
]);
hood('first-settlement', 'new-cairo', 'First Settlement', 'التجمع الأول', ['1st settlement', 'first settlement', 'el tagamoa el awal', 'tagamoa awal', 'التجمع 1', 'تجمع اول']);
hood('third-settlement', 'new-cairo', 'Third Settlement', 'التجمع الثالث', ['3rd settlement', 'third settlement', 'el tagamoa el talet', 'التجمع 3', 'تجمع تالت', 'التجمع التالت']);
hood('rehab', 'new-cairo', 'El Rehab', 'الرحاب', ['rehab', 'el rehab', 'al rehab', 'rehab city', 'مدينة الرحاب', 'rihab']);
hood('katameya', 'new-cairo', 'Katameya', 'القطامية', ['katameya', 'kattameya', 'qattamiya', 'el katameya', 'قطامية', 'katamya']);
hood('banafseg', 'fifth-settlement', 'El Banafseg', 'البنفسج', ['banafseg', 'el banafseg', 'banafsig', 'فيلات البنفسج']);
hood('lotus', 'fifth-settlement', 'El Lotus', 'اللوتس', ['lotus', 'el lotus', 'south lotus', 'north lotus', 'اللوتس الجنوبية', 'اللوتس الشمالية']);
hood('narges', 'fifth-settlement', 'El Narges', 'النرجس', ['narges', 'el narges', 'el narges buildings', 'عمارات النرجس', 'فيلات النرجس']);
hood('yasmeen', 'fifth-settlement', 'El Yasmeen', 'الياسمين', ['yasmeen', 'el yasmeen', 'el yasmin', 'فيلات الياسمين'], { needsParent: true });
hood('andalus', 'fifth-settlement', 'El Andalus', 'الأندلس', ['el andalus', 'andalus'], { needsParent: true });
hood('golden-square', 'fifth-settlement', 'Golden Square', 'الجولدن سكوير', ['golden square', 'gold square', 'جولدن سكوير']);
hood('south-investors', 'fifth-settlement', 'South Investors', 'المستثمرين الجنوبية', ['south investors', 'investors south', 'المستثمرين الجنوبيه']);
hood('north-investors', 'fifth-settlement', 'North Investors', 'المستثمرين الشمالية', ['north investors', 'investors north']);
hood('gharb-el-golf', 'fifth-settlement', 'Gharb El Golf', 'غرب الجولف', ['gharb el golf', 'west golf', 'غرب الجولف']);
hood('diplomats', 'fifth-settlement', 'El Diplomasiyeen', 'الدبلوماسيين', ['diplomats', 'el diplomasiyeen', 'حي الدبلوماسيين']);
hood('akademia', 'fifth-settlement', 'El Akademia', 'الأكاديمية', ['akademia', 'el akademia', 'academy district'], { needsParent: true });
street('90th-street', 'fifth-settlement', '90th Street', 'شارع التسعين', ['90th street', '90 street', 'south 90th', 'north 90th', 'التسعين', 'التسعين الجنوبي', 'التسعين الشمالي', 'el tesen', 'tes3een']);
comp('mivida', 'fifth-settlement', 'Mivida', 'ميفيدا', ['mivida', 'mi vida']);
comp('hyde-park', 'fifth-settlement', 'Hyde Park', 'هايد بارك', ['hyde park', 'hydepark']);
comp('katameya-heights', 'katameya', 'Katameya Heights', 'قطامية هايتس', ['katameya heights', 'kattameya heights']);
comp('lake-view', 'fifth-settlement', 'Lake View', 'ليك فيو', ['lake view', 'lakeview']);
comp('eastown', 'fifth-settlement', 'Eastown', 'ايستاون', ['eastown', 'east town', 'sodic eastown']);
comp('villette', 'fifth-settlement', 'Villette', 'فيليت', ['villette', 'sodic villette']);
comp('stone-park', 'katameya', 'Stone Park', 'ستون بارك', ['stone park']);
comp('mirage-city', 'first-settlement', 'Mirage City', 'ميراج سيتي', ['mirage city', 'mirage']);
comp('taj-city', 'new-cairo', 'Taj City', 'تاج سيتي', ['taj city']);
comp('dar-misr-andalus', 'andalus', 'Dar Misr El Andalus', 'دار مصر الأندلس', ['dar misr el andalus', 'dar masr el andalus', 'dar misr andalus']);
comp('beit-el-watan', 'fifth-settlement', 'Beit El Watan', 'بيت الوطن', ['beit el watan', 'bait el watan']);
comp('mountain-view-nc', 'fifth-settlement', 'Mountain View New Cairo', 'ماونتن فيو التجمع', ['mountain view', 'mountainview'], { needsParent: true });
comp('palm-hills-nc', 'fifth-settlement', 'Palm Hills New Cairo', 'بالم هيلز التجمع', ['palm hills new cairo', 'palm hills kattameya', 'pk1', 'pk2']);
mark('cfc', 'fifth-settlement', 'Cairo Festival City', 'كايرو فستيفال سيتي', ['cairo festival city', 'festival city', 'cfc', 'كايرو فستيفال', 'فستيفال سيتي']);
mark('auc', 'fifth-settlement', 'American University in Cairo', 'الجامعة الأمريكية', ['auc', 'american university', 'الجامعه الامريكيه بالتجمع']);
mark('point-90', 'fifth-settlement', 'Point 90 Mall', 'بوينت 90', ['point 90', 'point90']);
mark('waterway', 'fifth-settlement', 'Waterway', 'ووتر واي', ['waterway', 'water way', 'the waterway']);
mark('concord-plaza', 'fifth-settlement', 'Concord Plaza', 'كونكورد بلازا', ['concord plaza']);
city('madinaty', 'cairo', 'Madinaty', 'مدينتي', ['madinaty', 'madinty', 'madinati', 'medinaty']);
city('shorouk', 'cairo', 'El Shorouk', 'الشروق', ['sherouk', 'el sherouk', 'al sherouk', 'shorouk', 'el shorouk', 'shrouk', 'sherouk city', 'shorouk city', 'مدينة الشروق']);
city('badr', 'cairo', 'Badr City', 'مدينة بدر', ['badr city', 'madinet badr']);
city('new-capital', 'cairo', 'New Administrative Capital', 'العاصمة الإدارية', ['new capital', 'administrative capital', 'new administrative capital', 'nac', 'العاصمه الاداريه الجديده', 'العاصمة الإدارية الجديدة']);
city('mostakbal', 'cairo', 'Mostakbal City', 'مستقبل سيتي', ['mostakbal city', 'mostakbal', 'future city', 'مدينة المستقبل']);
city('new-heliopolis', 'cairo', 'New Heliopolis', 'هليوبوليس الجديدة', ['new heliopolis', 'heliopolis el gedida', 'heliopolis gedida', 'مصر الجديدة الجديدة']);

// ── Cairo: east ──────────────────────────────────────────────────────────────
dist('nasr-city', 'cairo', 'Nasr City', 'مدينة نصر', ['madinet nasr', 'nasr city', 'nasr cty', 'nasrcity', 'م نصر', 'مدينه نصر اول', 'مدينه نصر ثان', 'nasr city 1', 'nasr city 2']);
hood('rabaa', 'nasr-city', 'Rabaa', 'رابعة', ['rabaa', 'raba3a', 'rabea', 'rabaa el adaweya', 'رابعه العدويه']);
hood('zahraa-nasr-city', 'nasr-city', 'Zahraa Nasr City', 'زهراء مدينة نصر', ['zahraa nasr city', 'zahraa madinet nasr']);
hood('wafa-amal', 'nasr-city', 'El Wafaa Wel Amal', 'الوفاء والأمل', ['wafa wel amal', 'el wafaa wel amal', 'مساكن الوفاء والامل']);
hood('sefarat', 'nasr-city', 'Embassies District', 'حي السفارات', ['embassies district', 'hay el sefarat', 'el sefarat']);
hood('ezbet-el-haggana', 'nasr-city', 'Ezbet El Haggana', 'عزبة الهجانة', ['ezbet el haggana', 'el haggana', 'الهجانه']);
hood('manteqa-sadsa', 'nasr-city', 'Sixth Zone', 'المنطقة السادسة', ['6th zone', 'sixth zone', 'el manteqa el sadsa'], { needsParent: true });
hood('manteqa-tamna', 'nasr-city', 'Eighth Zone', 'المنطقة الثامنة', ['8th zone', 'eighth zone', 'el manteqa el tamna', 'المنطقه التامنه'], { needsParent: true });
street('abbas-el-akkad', 'nasr-city', 'Abbas El Akkad St', 'عباس العقاد', ['abbas el akkad', 'abbas akkad', 'abbas el aqqad']);
street('makram-ebeid', 'nasr-city', 'Makram Ebeid St', 'مكرم عبيد', ['makram ebeid', 'makram obeid', 'makram ebid']);
street('mostafa-el-nahas', 'nasr-city', 'Mostafa El Nahas St', 'مصطفى النحاس', ['mostafa el nahas', 'mostafa nahas', 'moustafa el nahhas', 'mustafa el nahas']);
street('el-tayaran', 'nasr-city', 'El Tayaran St', 'الطيران', ['el tayaran', 'tayaran street'], { needsParent: false });
street('youssef-abbas', 'nasr-city', 'Youssef Abbas St', 'يوسف عباس', ['youssef abbas', 'yousef abbas']);
street('hassan-el-maamoun', 'nasr-city', 'Hassan El Maamoun St', 'حسن المأمون', ['hassan el maamoun', 'hassan maamoun']);
street('zaker-hussein', 'nasr-city', 'Zaker Hussein St', 'ذاكر حسين', ['zaker hussein', 'zaker hussien']);
street('ahmed-fakhry', 'nasr-city', 'Ahmed Fakhry St', 'أحمد فخري', ['ahmed fakhry', 'ahmed fakhri']);
street('ahmed-el-zomor', 'nasr-city-hay-8', 'Ahmed El Zomor St', 'أحمد الزمر', ['ahmed el zomor', 'ahmed zomor', 'ahmed el zomr', 'el zomor', 'الزمر']);
street('abou-dawood-el-zahery', 'nasr-city', 'Abou Dawood El Zahery St', 'أبو داود الظاهري', ['abou dawood el zahery', 'abu dawood el zahery', 'abou dawoud el zahiry', 'ابو داود الظاهري']);
street('mohamed-el-makrif', 'nasr-city', 'Mohamed El Makrif St', 'محمد المقريف', ['mohamed el makrif', 'mohamed el maqrif', 'el makrif']);
street('hassan-afify', 'nasr-city', 'Hassan Afify St', 'حسن عفيفي', ['hassan afify', 'hassan afifi']);
street('ali-amin', 'nasr-city', 'Ali Amin St', 'علي أمين', ['ali amin street', 'ali amin st', 'شارع علي امين']);
street('el-nasr-road', 'nasr-city', 'El Nasr Road', 'طريق النصر', ['el nasr road', 'nasr road', 'nasr rd', 'طريق النصر']);
street('mostafa-el-nahas-ext', 'nasr-city', 'Mostafa El Nahas Extension', 'امتداد مصطفى النحاس', ['emtedad mostafa el nahas', 'mostafa el nahas extension']);
street('anwar-el-mofty', 'nasr-city', 'Anwar El Mofty St', 'أنور المفتي', ['anwar el mofty', 'anwar mofty']);
mark('city-stars', 'nasr-city', 'City Stars', 'سيتي ستارز', ['city stars', 'citystars', 'سيتى ستارز']);
mark('genena-mall', 'nasr-city', 'Genena Mall', 'جنينة مول', ['genena mall', 'gnena mall']);
mark('tiba-mall', 'nasr-city', 'Tiba Mall', 'طيبة مول', ['tiba mall', 'teba mall']);
mark('cairo-stadium', 'nasr-city', 'Cairo International Stadium', 'استاد القاهرة', ['cairo stadium', 'cairo international stadium', 'stad el qahira']);
mark('intl-garden', 'nasr-city', 'International Garden', 'الحديقة الدولية', ['international garden', 'el hadika el dawlia']);

dist('heliopolis', 'cairo', 'Heliopolis', 'مصر الجديدة', ['heliopolis', 'helio', 'masr el gedida', 'masr el gdida', 'misr el gedida', 'masr gedida', 'masr elgedida', 'مصر الجديده']);
hood('korba', 'heliopolis', 'El Korba', 'الكوربة', ['korba', 'el korba', 'kurba']);
hood('roxy', 'heliopolis', 'Roxy', 'روكسي', ['roxy', 'روكسى']);
hood('ard-el-golf', 'heliopolis', 'Ard El Golf', 'أرض الجولف', ['ard el golf', 'ard al golf', 'golf land']);
hood('almaza', 'heliopolis', 'Almaza', 'ألماظة', ['almaza', 'el maza', 'الماظه']);
hood('saint-fatima', 'heliopolis', 'Saint Fatima', 'سانت فاتيما', ['saint fatima', 'st fatima', 'santa fatima']);
hood('higaz-square', 'heliopolis', 'El Higaz Square', 'ميدان الحجاز', ['higaz square', 'hegaz square', 'midan el higaz']);
hood('manshiet-el-bakry', 'heliopolis', 'Manshiet El Bakry', 'منشية البكري', ['manshiet el bakry', 'manshyet el bakry']);
hood('sabaa-emarat', 'heliopolis', 'El Sabaa Emarat', 'السبع عمارات', ['el sabaa emarat', 'seven buildings']);
hood('emarat-el-obour', 'heliopolis', 'Emarat El Obour', 'عمارات العبور', ['emarat el obour', 'obour buildings']);
hood('triumph', 'heliopolis', 'Triumph', 'التريومف', ['triumph', 'triomph', 'ميدان التريومف']);
street('el-merghany', 'heliopolis', 'El Merghany St', 'الميرغني', ['merghany', 'el merghany', 'mirghani', 'el mirghany']);
street('el-thawra', 'heliopolis', 'El Thawra St', 'شارع الثورة', ['el thawra street', 'thawra street', 'el sawra street'], { needsParent: false });
street('el-hegaz', 'heliopolis', 'El Hegaz St', 'شارع الحجاز', ['el hegaz street', 'hegaz street', 'el higaz street']);
mark('baron-palace', 'heliopolis', 'Baron Palace', 'قصر البارون', ['baron palace', 'qasr el baron']);
mark('merryland', 'heliopolis', 'Merryland', 'الميريلاند', ['merryland', 'mery land', 'ميريلاند']);
mark('heliopolis-club', 'heliopolis', 'Heliopolis Club', 'نادي هليوبوليس', ['heliopolis club', 'nady heliopolis']);
mark('city-centre-almaza', 'almaza', 'City Centre Almaza', 'سيتي سنتر ألماظة', ['city centre almaza', 'city center almaza', 'سيتي سنتر الماظه']);

dist('nozha', 'cairo', 'El Nozha', 'النزهة', ['el nozha', 'nozha', 'nuzha']);
hood('nozha-gedida', 'nozha', 'El Nozha El Gedida', 'النزهة الجديدة', ['el nozha el gedida', 'new nozha', 'nozha gedida']);
hood('masaken-sheraton', 'nozha', 'Masaken Sheraton', 'مساكن شيراتون', ['masaken sheraton', 'sheraton heliopolis', 'sheraton', 'شيراتون', 'el sheraton']);
mark('cairo-airport', 'nozha', 'Cairo Airport', 'مطار القاهرة', ['cairo airport', 'cairo international airport', 'el matar', 'المطار']);

dist('el-salam', 'cairo', 'El Salam City', 'مدينة السلام', ['el salam city', 'salam city', 'madinet el salam']);
dist('el-marg', 'cairo', 'El Marg', 'المرج', ['el marg', 'marg', 'المرج الجديدة']);
hood('ezbet-el-nakhl', 'el-marg', 'Ezbet El Nakhl', 'عزبة النخل', ['ezbet el nakhl', 'ezbet nakhl']);
dist('matareya', 'cairo', 'El Matareya', 'المطرية', ['matareya', 'el matareya', 'mataria', 'el matariya']);
dist('ain-shams', 'cairo', 'Ain Shams', 'عين شمس', ['ain shams', 'ein shams', 'ain chams']);
mark('ain-shams-university', 'abbasia', 'Ain Shams University', 'جامعة عين شمس', ['ain shams university', 'gam3et ain shams']);
dist('zaytoun', 'cairo', 'El Zaytoun', 'الزيتون', ['el zaytoun', 'zaytoun', 'zeitoun', 'el zeitoun']);
hood('hadayek-el-zaytoun', 'zaytoun', 'Hadayek El Zaytoun', 'حدائق الزيتون', ['hadayek el zaytoun', 'hadayek el zeitoun']);
dist('hadayek-el-kobba', 'cairo', 'Hadayek El Kobba', 'حدائق القبة', ['hadayek el kobba', 'hadayek el qobba', 'kobba gardens', 'القبة', 'el kobba', 'كوبري القبة']);
street('masr-wel-sudan', 'hadayek-el-kobba', 'Masr Wel Sudan St', 'شارع مصر والسودان', ['masr wel sudan', 'masr wel sodan', 'misr wel sudan', 'masr w el sudan', 'masr we el sudan', 'masr wl sudan', 'مصر والسودان', 'مصر و السودان']);
dist('el-waili', 'cairo', 'El Waili', 'الوايلي', ['el waili', 'waily', 'el wayli']);
hood('abbasia', 'el-waili', 'El Abbasia', 'العباسية', ['abbasia', 'el abbasia', 'abbasiya', 'el abbaseya', 'abaseya']);
hood('daher', 'el-waili', 'El Daher', 'الظاهر', ['daher', 'el daher', 'el zaher']);
dist('el-amireya', 'cairo', 'El Amireya', 'الأميرية', ['el amireya', 'amireya', 'amiriya']);
dist('zawya-el-hamra', 'cairo', 'El Zawya El Hamra', 'الزاوية الحمراء', ['el zawya el hamra', 'zawya hamra']);
dist('sharabeya', 'cairo', 'El Sharabeya', 'الشرابية', ['el sharabeya', 'sharabia']);
dist('shubra', 'cairo', 'Shubra', 'شبرا', ['shubra', 'shoubra', 'shobra', 'shbra', 'شبرا مصر']);
dist('rod-el-farag', 'cairo', 'Rod El Farag', 'روض الفرج', ['rod el farag', 'rod elfarag']);
dist('el-sahel', 'cairo', 'El Sahel', 'الساحل', ['el sahel cairo', 'el sahel shubra', 'الساحل شبرا']);

// ── Cairo: centre ────────────────────────────────────────────────────────────
dist('downtown', 'cairo', 'Downtown', 'وسط البلد', ['downtown', 'down town', 'wust el balad', 'west el balad', 'wasat el balad', 'قصر النيل', 'qasr el nil', 'kasr el nil']);
mark('tahrir-square', 'downtown', 'Tahrir Square', 'ميدان التحرير', ['tahrir square', 'midan el tahrir']);
street('talaat-harb', 'downtown', 'Talaat Harb St', 'طلعت حرب', ['talaat harb', 'tal3at harb']);
hood('ramses', 'downtown', 'Ramses', 'رمسيس', ['ramses', 'ramsis', 'ميدان رمسيس']);
hood('ataba', 'downtown', 'El Ataba', 'العتبة', ['ataba', 'el ataba']);
dist('garden-city', 'cairo', 'Garden City', 'جاردن سيتي', ['garden city', 'gardencity', 'جاردن سيتى']);
dist('zamalek', 'cairo', 'Zamalek', 'الزمالك', ['zamalek', 'el zamalek', 'zamalik']);
mark('cairo-tower', 'zamalek', 'Cairo Tower', 'برج القاهرة', ['cairo tower', 'borg el qahira']);
mark('gezira-club', 'zamalek', 'Gezira Club', 'نادي الجزيرة', ['gezira club', 'nady el gezira', 'gezira sporting club']);
street('abu-el-feda', 'zamalek', 'Abu El Feda St', 'أبو الفدا', ['abu el feda', 'abou el feda']);
dist('abdeen', 'cairo', 'Abdeen', 'عابدين', ['abdeen', 'abdin']);
dist('sayeda-zeinab', 'cairo', 'El Sayeda Zeinab', 'السيدة زينب', ['sayeda zeinab', 'el sayeda zeinab', 'sayeda zainab', 'sayeda zeynab']);
dist('masr-el-qadima', 'cairo', 'Old Cairo', 'مصر القديمة', ['old cairo', 'masr el qadima', 'masr el adima', 'misr el qadima', 'مصر القديمه']);
hood('manial', 'masr-el-qadima', 'El Manial', 'المنيل', ['manial', 'el manial', 'manyal']);
hood('roda', 'masr-el-qadima', 'El Roda', 'الروضة', ['el roda', 'roda island', 'rawda']);
hood('fustat', 'masr-el-qadima', 'El Fustat', 'الفسطاط', ['fustat', 'el fustat']);
hood('malek-el-saleh', 'masr-el-qadima', 'El Malek El Saleh', 'الملك الصالح', ['malek el saleh', 'el malek el saleh']);
hood('ain-el-sira', 'masr-el-qadima', 'Ain El Sira', 'عين الصيرة', ['ain el sira', 'ein el sira']);
dist('khalifa', 'cairo', 'El Khalifa', 'الخليفة', ['el khalifa', 'khalifa']);
hood('sayeda-nafisa', 'khalifa', 'El Sayeda Nafisa', 'السيدة نفيسة', ['sayeda nafisa', 'el sayeda nafisa']);
hood('sayeda-aisha', 'khalifa', 'El Sayeda Aisha', 'السيدة عائشة', ['sayeda aisha', 'el sayeda aisha', 'السيده عيشه']);
mark('citadel', 'khalifa', 'Salah El Din Citadel', 'قلعة صلاح الدين', ['salah el din citadel', 'saladin citadel', 'cairo citadel', 'qalaat salah el din']);
dist('mokattam', 'cairo', 'El Mokattam', 'المقطم', ['mokattam', 'el mokattam', 'mokatam', 'mukattam', 'moqattam', 'el moqattam', 'هضبة المقطم']);
hood('hadaba-wosta', 'mokattam', 'El Hadaba El Wosta', 'الهضبة الوسطى', ['el hadaba el wosta', 'hadaba wosta', 'middle plateau']);
hood('hadaba-olya', 'mokattam', 'El Hadaba El Olya', 'الهضبة العليا', ['el hadaba el olya', 'hadaba olya', 'upper plateau']);
dist('manshiyat-naser', 'cairo', 'Manshiyat Naser', 'منشية ناصر', ['manshiyat naser', 'manshiet nasser', 'manshiyet nasser']);
dist('darb-el-ahmar', 'cairo', 'El Darb El Ahmar', 'الدرب الأحمر', ['darb el ahmar', 'el darb el ahmar']);
dist('gamaleya', 'cairo', 'El Gamaleya', 'الجمالية', ['gamaleya', 'el gamaleya', 'gamalia']);
hood('hussein', 'gamaleya', 'El Hussein', 'الحسين', ['el hussein', 'sayedna el hussein', 'سيدنا الحسين', 'حي الحسين']);
mark('khan-el-khalili', 'gamaleya', 'Khan El Khalili', 'خان الخليلي', ['khan el khalili', 'khan khalili']);
dist('mosky', 'cairo', 'El Mosky', 'الموسكي', ['mosky', 'el mosky', 'muski']);
dist('bab-el-shaaria', 'cairo', 'Bab El Shaaria', 'باب الشعرية', ['bab el shaaria', 'bab el sha3reya', 'bab el shereya']);
dist('azbakeya', 'cairo', 'El Azbakeya', 'الأزبكية', ['azbakeya', 'el azbakeya', 'ezbekia']);
dist('boulaq', 'cairo', 'Boulaq', 'بولاق أبو العلا', ['boulaq', 'bulaq', 'boulaq abu el ela', 'bulaq abu el ela', 'بولاق']);

// ── Cairo: south ─────────────────────────────────────────────────────────────
dist('maadi', 'cairo', 'Maadi', 'المعادي', ['maadi', 'maady', 'el maadi', 'al maadi', 'maadi cairo', 'meadi']);
hood('degla', 'maadi', 'Degla', 'دجلة', ['degla', 'dejla', 'degla maadi', 'دجلة المعادي']);
hood('sarayat-el-maadi', 'maadi', 'Sarayat El Maadi', 'سرايات المعادي', ['sarayat el maadi', 'sarayat', 'maadi el sarayat', 'المعادي السرايات']);
hood('new-maadi', 'maadi', 'New Maadi', 'المعادي الجديدة', ['new maadi', 'maadi el gedida', 'el maadi el gedida', 'المعادى الجديدة']);
hood('zahraa-el-maadi', 'maadi', 'Zahraa El Maadi', 'زهراء المعادي', ['zahraa el maadi', 'zahraa maadi', 'zahra el maadi', 'zahraa']);
hood('hadayek-el-maadi', 'maadi', 'Hadayek El Maadi', 'حدائق المعادي', ['hadayek el maadi', 'maadi gardens']);
hood('maadi-cornish', 'maadi', 'Maadi Cornish', 'كورنيش المعادي', ['maadi cornish', 'cornish el maadi', 'corniche maadi']);
hood('old-maadi', 'maadi', 'Old Maadi', 'المعادي القديمة', ['old maadi', 'maadi el qadima']);
hood('lasilky', 'new-maadi', 'El Lasilky', 'اللاسلكي', ['lasilky', 'el lasilky', 'laselki']);
hood('arab-el-maadi', 'maadi', 'Arab El Maadi', 'عرب المعادي', ['arab el maadi']);
street('maadi-road-9', 'maadi', 'Road 9', 'شارع 9', ['road 9', 'street 9', 'st 9', '9 street'], { needsParent: true });
mark('maadi-grand-mall', 'maadi', 'Maadi Grand Mall', 'معادي جراند مول', ['maadi grand mall', 'grand mall maadi', 'جراند مول']);
mark('carrefour-maadi', 'maadi', 'Carrefour Maadi', 'كارفور المعادي', ['carrefour maadi', 'carrefour el maadi']);
mark('maadi-city-centre', 'maadi', 'City Centre Maadi', 'سيتي سنتر المعادي', ['city centre maadi', 'city center maadi']);
dist('basatin', 'cairo', 'El Basatin', 'البساتين', ['basatin', 'el basatin', 'basateen']);
hood('maraag', 'basatin', 'El Maraag', 'المعراج', ['maraag', 'el maraag', 'meraag', 'mearag', 'miraj', 'مدينة المعراج']);
dist('dar-el-salam', 'cairo', 'Dar El Salam', 'دار السلام', ['dar el salam', 'dar elsalam', 'dar al salam']);
dist('tora', 'cairo', 'Tora', 'طرة', ['tora', 'tura', 'طره البلد', 'kozzika']);
dist('maasara', 'cairo', 'El Maasara', 'المعصرة', ['maasara', 'el maasara', 'masara']);
dist('helwan', 'cairo', 'Helwan', 'حلوان', ['helwan', 'helwaan', 'hilwan']);
hood('ain-helwan', 'helwan', 'Ain Helwan', 'عين حلوان', ['ain helwan']);
hood('hadayek-helwan', 'helwan', 'Hadayek Helwan', 'حدائق حلوان', ['hadayek helwan']);
hood('wadi-hof', 'helwan', 'Wadi Hof', 'وادي حوف', ['wadi hof', 'wady hof']);
dist('tebbin', 'cairo', 'El Tebbin', 'التبين', ['tebbin', 'el tebbin']);
city('15-may', 'cairo', '15th of May City', 'مدينة 15 مايو', ['15 may', '15 may city', '15th of may', '15 مايو']);

// ── Giza ─────────────────────────────────────────────────────────────────────
dist('dokki', 'giza', 'Dokki', 'الدقي', ['dokki', 'doqqi', 'dokky', 'el dokki', 'duqqi']);
hood('mesaha', 'dokki', 'El Mesaha', 'المساحة', ['mesaha', 'el mesaha', 'mesaha square', 'ميدان المساحة']);
hood('bein-el-sarayat', 'dokki', 'Bein El Sarayat', 'بين السرايات', ['bein el sarayat', 'bein sarayat']);
hood('orman', 'dokki', 'El Orman', 'الأورمان', ['orman', 'el orman']);
street('mossadak', 'dokki', 'Mossadak St', 'مصدق', ['mossadak', 'mosadak', 'mosaddak']);
dist('agouza', 'giza', 'El Agouza', 'العجوزة', ['agouza', 'el agouza', 'agoza', 'el agoza']);
hood('mohandessin', 'agouza', 'Mohandessin', 'المهندسين', ['mohandessin', 'mohandiseen', 'mohandeseen', 'el mohandeseen', 'mohandseen', 'el mohandessin', 'mohandesin', 'مهندسين']);
hood('ard-el-lewa', 'agouza', 'Ard El Lewa', 'أرض اللواء', ['ard el lewa', 'ard ellewa']);
street('gameat-el-dowal', 'mohandessin', 'Gameat El Dowal St', 'جامعة الدول العربية', ['gameat el dowal', 'gameat el dowal el arabia', 'gamet el dowal el arabia', 'gamet el dowal', 'arab league street', 'جامعة الدول', 'gam3et el dewal']);
street('shehab', 'mohandessin', 'Shehab St', 'شهاب', ['shehab street', 'shehab st', 'شارع شهاب']);
street('batal-ahmed', 'mohandessin', 'El Batal Ahmed Abdel Aziz St', 'البطل أحمد عبد العزيز', ['batal ahmed', 'el batal ahmed', 'batal ahmed abdel aziz', 'البطل احمد']);
street('syria-street', 'mohandessin', 'Syria St', 'شارع سوريا', ['syria street', 'souria street']);
mark('lebanon-square', 'mohandessin', 'Lebanon Square', 'ميدان لبنان', ['lebanon square', 'midan lebnan']);
mark('sphinx-square', 'mohandessin', 'Sphinx Square', 'ميدان سفنكس', ['sphinx square', 'midan sphinx', 'سفنكس']);
street('wadi-el-nil', 'mohandessin', 'Wadi El Nil St', 'وادي النيل', ['wadi el nil', 'wady el nil']);
dist('giza-district', 'giza', 'Giza District', 'حي الجيزة', ['giza square', 'midan el giza', 'ميدان الجيزة', 'حي الجيزه']);
mark('cairo-university', 'giza-district', 'Cairo University', 'جامعة القاهرة', ['cairo university', 'gam3et el qahira']);
hood('monib', 'giza-district', 'El Monib', 'المنيب', ['monib', 'el monib', 'mounib']);
hood('saqiet-mekki', 'giza-district', 'Saqiet Mekki', 'ساقية مكي', ['saqiet mekki', 'sakiet mekki']);
dist('omraneya', 'giza', 'El Omraneya', 'العمرانية', ['omraneya', 'el omraneya', 'omrania']);
dist('haram', 'giza', 'El Haram', 'الهرم', ['haram', 'el haram', 'al haram', 'pyramids area']);
hood('faisal', 'haram', 'Faisal', 'فيصل', ['faisal', 'feisal', 'faysal', 'el faisal', 'شارع فيصل', 'faisal street']);
hood('hadayek-el-ahram', 'haram', 'Hadayek El Ahram', 'حدائق الأهرام', ['hadayek el ahram', 'hadayek al ahram', 'pyramids gardens', 'حدايق الاهرام']);
hood('talbia', 'haram', 'El Talbia', 'الطالبية', ['talbia', 'el talbia', 'talbeya']);
hood('mariouteya', 'haram', 'El Mariouteya', 'المريوطية', ['mariouteya', 'el mariouteya', 'maryoutia', 'mariotia']);
hood('remaya', 'haram', 'El Remaya', 'الرماية', ['remaya', 'el remaya', 'remaya square', 'ميدان الرماية']);
hood('nazlet-el-samman', 'haram', 'Nazlet El Samman', 'نزلة السمان', ['nazlet el samman', 'nazlet elsamman']);
street('haram-street', 'haram', 'El Haram St', 'شارع الهرم', ['haram street', 'el haram street', 'pyramids road']);
mark('pyramids', 'haram', 'The Pyramids', 'الأهرامات', ['pyramids', 'the pyramids', 'el ahramat']);
dist('boulaq-dakrour', 'giza', 'Boulaq El Dakrour', 'بولاق الدكرور', ['boulaq el dakrour', 'bulaq el dakrour', 'boulaq dakrour', 'بولاق الدكرور']);
hood('nahia', 'boulaq-dakrour', 'Nahia', 'ناهيا', ['nahia', 'nahya']);
dist('imbaba', 'giza', 'Imbaba', 'إمبابة', ['imbaba', 'embaba', 'imbabah']);
hood('kit-kat', 'imbaba', 'El Kit Kat', 'الكيت كات', ['kit kat', 'kitkat', 'el kit kat', 'الكيت كات']);
hood('mounira-gharbia', 'imbaba', 'El Mounira El Gharbia', 'المنيرة الغربية', ['mounira el gharbia', 'el mounira el gharbeya']);
dist('warraq', 'giza', 'El Warraq', 'الوراق', ['warraq', 'el warraq', 'waraq']);
dist('kerdasa', 'giza', 'Kerdasa', 'كرداسة', ['kerdasa', 'kirdasa']);
dist('abu-rawash', 'giza', 'Abu Rawash', 'أبو رواش', ['abu rawash', 'abou rawash']);
mark('dandy-mall', 'abu-rawash', 'Dandy Mall', 'داندي مول', ['dandy mall', 'dandy']);
dist('hawamdeya', 'giza', 'El Hawamdeya', 'الحوامدية', ['hawamdeya', 'el hawamdeya', 'hawamdia']);
dist('badrashein', 'giza', 'El Badrashein', 'البدرشين', ['badrashein', 'el badrashein', 'badrashin']);
dist('abu-el-nomros', 'giza', 'Abu El Nomros', 'أبو النمرس', ['abu el nomros', 'abou el nomros']);
city('october', 'giza', '6th of October', '6 أكتوبر', [
  '6 october', '6th of october', '6th october', 'october', 'october city', '6 oct', 'sitta october', 'اكتوبر', 'السادس من اكتوبر', 'مدينة 6 اكتوبر', 'مدينه السادس من اكتوبر', '6th of october city',
]);
hood('hadayek-october', 'october', 'Hadayek October', 'حدائق أكتوبر', ['hadayek october', 'hadayek el october', 'october gardens', 'حدائق 6 اكتوبر']);
hood('hosary', 'october', 'El Hosary', 'الحصري', ['hosary', 'el hosary', 'el hosari', 'مسجد الحصري', 'ميدان الحصري']);
hood('motamayez', 'october', 'El Hay El Motamayez', 'الحي المتميز', ['el hay el motamayez', 'motamayez district', 'distinguished district']);
hood('gharb-somid', 'october', 'Gharb Somid', 'غرب سوميد', ['gharb somid', 'west somid']);
hood('ashgar', 'october', 'El Ashgar', 'الأشجار', ['el ashgar'], { needsParent: true });
hood('dreamland', 'october', 'Dreamland', 'دريم لاند', ['dreamland', 'dream land', 'دريملاند']);
comp('palm-hills-october', 'october', 'Palm Hills October', 'بالم هيلز أكتوبر', ['palm hills', 'palm hills october']);
comp('mountain-view-october', 'october', 'Mountain View October', 'ماونتن فيو أكتوبر', ['mountain view october', 'mountain view icity october']);
mark('mall-of-arabia', 'october', 'Mall of Arabia', 'مول العرب', ['mall of arabia', 'mall el arab']);
mark('mall-of-egypt', 'october', 'Mall of Egypt', 'مول مصر', ['mall of egypt', 'mall masr']);
mark('juhayna-square', 'october', 'Juhayna Square', 'ميدان جهينة', ['juhayna square', 'gohayna square', 'جهينة']);
city('sheikh-zayed', 'giza', 'Sheikh Zayed', 'الشيخ زايد', ['sheikh zayed', 'el sheikh zayed', 'shaikh zayed', 'zayed', 'zayed city', 'el sheikh zayed city', 'مدينة الشيخ زايد', 'زايد']);
comp('beverly-hills', 'sheikh-zayed', 'Beverly Hills', 'بيفرلي هيلز', ['beverly hills', 'beverly hills zayed']);
comp('allegria', 'sheikh-zayed', 'Allegria', 'أليجريا', ['allegria', 'sodic allegria']);
comp('westown', 'sheikh-zayed', 'Westown', 'ويستاون', ['westown', 'west town']);
comp('zayed-2000', 'sheikh-zayed', 'Zayed 2000', 'زايد 2000', ['zayed 2000']);
comp('rabwa', 'sheikh-zayed', 'El Rabwa', 'الربوة', ['rabwa', 'el rabwa']);
comp('khamayel', 'sheikh-zayed', 'El Khamayel', 'الخمائل', ['khamayel', 'el khamayel']);
comp('new-giza', 'sheikh-zayed', 'New Giza', 'نيو جيزة', ['new giza', 'newgiza']);
mark('arkan', 'sheikh-zayed', 'Arkan Plaza', 'أركان', ['arkan', 'arkan plaza', 'اركان بلازا']);
mark('hyper-one', 'sheikh-zayed', 'Hyper One', 'هايبر وان', ['hyper one', 'hyperone']);
mark('smart-village', 'sheikh-zayed', 'Smart Village', 'القرية الذكية', ['smart village', 'el karya el zakeya']);

// ── Qalyubia (Greater Cairo) ─────────────────────────────────────────────────
city('shubra-el-kheima', 'qalyubia', 'Shubra El Kheima', 'شبرا الخيمة', ['shubra el kheima', 'shoubra el kheima', 'shobra el kheima', 'shubra kheima']);
hood('bahtim', 'shubra-el-kheima', 'Bahtim', 'بهتيم', ['bahtim', 'bahteem']);
city('obour', 'qalyubia', 'El Obour City', 'مدينة العبور', ['obour', 'el obour', 'obour city', 'el obour city', 'العبور']);
city('qalyub', 'qalyubia', 'Qalyub', 'قليوب', ['qalyub', 'qalyoub', 'kalyoub']);
city('khanka', 'qalyubia', 'El Khanka', 'الخانكة', ['khanka', 'el khanka']);
city('banha', 'qalyubia', 'Banha', 'بنها', ['banha', 'benha']);
city('qanater', 'qalyubia', 'El Qanater El Khayreya', 'القناطر الخيرية', ['qanater', 'el qanater', 'el qanater el khayreya', 'القناطر']);

// Ordinal neighbourhoods used in Nasr City and 6th of October ("Hay 7", "الحي السابع").
const ORDINALS: [number, string, string, string][] = [
  [1, 'first', 'الاول', 'awal'],
  [2, 'second', 'الثاني', 'tany'],
  [3, 'third', 'الثالث', 'talet'],
  [4, 'fourth', 'الرابع', 'rabe'],
  [5, 'fifth', 'الخامس', 'khames'],
  [6, 'sixth', 'السادس', 'sades'],
  [7, 'seventh', 'السابع', 'sabe'],
  [8, 'eighth', 'الثامن', 'tamen'],
  [9, 'ninth', 'التاسع', 'tase'],
  [10, 'tenth', 'العاشر', 'asher'],
  [11, 'eleventh', 'الحادي عشر', 'hadashar'],
  [12, 'twelfth', 'الثاني عشر', 'etnashar'],
];
const SUFFIX = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
for (const [cityId, max] of [['nasr-city', 10], ['october', 12]] as const) {
  for (const [n, en, ar, franco] of ORDINALS) {
    if (n > max) continue;
    hood(
      `${cityId}-hay-${n}`,
      cityId,
      `District ${n}`,
      `الحي ${ar.replace(/^ال/, '')}`,
      [
        `hay ${n}`, `el hay ${n}`, `district ${n}`, `${n}${SUFFIX(n)} district`, `${en} district`,
        `el hay el ${franco}`, `hay el ${franco}`, `الحي ${n}`, `الحي ${ar}`, `حي ${n}`, `المجاورة ${n}`,
      ],
      { needsParent: true },
    );
  }
}

// ── Governorates outside Greater Cairo ───────────────────────────────────────
const OUTSIDE: [string, string, string, string[]][] = [
  ['alexandria', 'Alexandria', 'الإسكندرية', ['alex', 'alexandria', 'اسكندرية', 'اسكندريه', 'smouha', 'سموحة', 'sidi gaber', 'سيدي جابر', 'miami alex', 'agami', 'العجمي']],
  ['dakahlia', 'Dakahlia', 'الدقهلية', ['dakahlia', 'mansoura', 'el mansoura', 'المنصورة', 'منصوره']],
  ['sharqia', 'Sharqia', 'الشرقية', ['sharqia', 'sharkia', 'el sharkia', 'zagazig', 'الزقازيق', '10th of ramadan', 'العاشر من رمضان']],
  ['gharbia', 'Gharbia', 'الغربية', ['gharbia', 'tanta', 'طنطا', 'el mahalla', 'mahalla', 'el mahalla el kubra', 'mahalla el kobra', 'المحلة', 'المحلة الكبرى']],
  ['monufia', 'Monufia', 'المنوفية', ['monufia', 'menoufia', 'menofia', 'shebin el kom', 'shibin el kom', 'shibin al kawm', 'shebin el koum', 'شبين الكوم', 'sadat city', 'مدينة السادات']],
  ['beheira', 'Beheira', 'البحيرة', ['beheira', 'behira', 'damanhour', 'دمنهور', 'kafr el dawar', 'كفر الدوار', 'rosetta', 'rashid', 'rasheed', 'رشيد']],
  ['kafr-el-sheikh', 'Kafr El Sheikh', 'كفر الشيخ', ['kafr el sheikh']],
  ['damietta', 'Damietta', 'دمياط', ['damietta', 'domyat', 'new damietta']],
  ['port-said', 'Port Said', 'بورسعيد', ['port said', 'بور سعيد', 'portsaid']],
  ['ismailia', 'Ismailia', 'الإسماعيلية', ['ismailia', 'ismailiya', 'الاسماعيليه']],
  ['suez', 'Suez', 'السويس', ['suez', 'el suez', 'ain sokhna', 'العين السخنة', 'sokhna']],
  ['fayoum', 'Fayoum', 'الفيوم', ['fayoum', 'faiyum', 'fayum']],
  ['beni-suef', 'Beni Suef', 'بني سويف', ['beni suef', 'bani suef', 'beni sweif']],
  ['minya', 'Minya', 'المنيا', ['minya', 'el minya', 'menya']],
  ['asyut', 'Asyut', 'أسيوط', ['asyut', 'assiut', 'asiut']],
  ['sohag', 'Sohag', 'سوهاج', ['sohag', 'suhag']],
  ['qena', 'Qena', 'قنا', ['qena', 'kena']],
  ['luxor', 'Luxor', 'الأقصر', ['luxor', 'el uqsur']],
  ['aswan', 'Aswan', 'أسوان', ['aswan']],
  ['red-sea', 'Red Sea', 'البحر الأحمر', ['red sea', 'hurghada', 'الغردقة', 'ghardaqa', 'el gouna', 'الجونة', 'marsa alam', 'مرسى علم']],
  ['matrouh', 'Matrouh', 'مطروح', ['matrouh', 'marsa matrouh', 'مرسى مطروح', 'north coast', 'sahel', 'الساحل الشمالي', 'el alamein', 'العلمين']],
  ['north-sinai', 'North Sinai', 'شمال سيناء', ['north sinai', 'el arish', 'العريش']],
  ['south-sinai', 'South Sinai', 'جنوب سيناء', ['south sinai', 'sharm el sheikh', 'شرم الشيخ', 'sharm', 'dahab', 'دهب']],
  ['new-valley', 'New Valley', 'الوادي الجديد', ['new valley', 'el kharga', 'الخارجة']],
];
for (const [id, en, ar, names] of OUTSIDE) gov(id, en, ar, names, false);

// ── Streets: one district, or several (a street alone that runs through several districts,
// or exists in several cities, is unsure and lists them) ─────────────────────
function streets(id: string, parents: string[], en: string, ar: string, names: string[]) {
  for (const parent of parents) street(parents.length === 1 ? id : `${id}--${parent}`, parent, en, ar, names);
}
streets('kasr-el-aini', ['garden-city', 'sayeda-zeinab'], 'Kasr El Aini St', 'شارع القصر العيني', ['kasr el aini', 'qasr el aini', 'kasr el eini', 'القصر العيني', 'قصر العيني']);
streets('el-moez', ['gamaleya'], 'El Moez St', 'شارع المعز', ['el moez', 'moez street', 'el moez le din allah', 'المعز لدين الله']);
streets('el-falaky', ['downtown'], 'El Falaky St', 'شارع الفلكي', ['el falaky', 'falaki', 'el falaki', 'الفلكي']);
streets('champollion', ['downtown'], 'Champollion St', 'شارع شامبليون', ['champollion', 'shampelion', 'شامبليون']);
streets('sherif', ['downtown'], 'Sherif St', 'شارع شريف', ['sherif street', 'sherif st', 'shareef street', 'شارع شريف']);
streets('adly', ['downtown'], 'Adly St', 'شارع عدلي', ['adly', 'adli street', 'عدلي']);
streets('mohamed-farid', ['downtown'], 'Mohamed Farid St', 'شارع محمد فريد', ['mohamed farid', 'mohammed farid', 'محمد فريد']);
streets('el-qalaa', ['darb-el-ahmar'], 'El Qalaa St', 'شارع القلعة', ['el qalaa street', 'el qala a street', 'qalaa street', 'el kalaa street', 'شارع القلعه', 'mohamed ali street', 'شارع محمد علي']);
streets('mohi-el-din-abou-el-ezz', ['dokki'], 'Mohi El Din Abou El Ezz St', 'شارع محيي الدين أبو العز', ['mohi el din abou el ezz', 'mohy el din abo el ezz', 'mohi eldin abu el ezz', 'محي الدين ابو العز', 'محيي الدين ابو العز']);
streets('el-bahr-el-aazam', ['giza-district'], 'El Bahr El Aazam St', 'شارع البحر الأعظم', ['el bahr el aazam', 'bahr el aazam', 'bahr el a3zam', 'البحر الاعظم']);
streets('ahmed-helmy', ['shubra'], 'Ahmed Helmy St', 'شارع أحمد حلمي', ['ahmed helmy', 'ahmed helmi', 'احمد حلمي']);
streets('el-khalafawy', ['shubra'], 'El Khalafawy St', 'شارع الخلفاوي', ['el khalafawy', 'khalafawy', 'el khalafawi', 'الخلفاوي']);
streets('el-mezallat', ['shubra'], 'El Mezallat St', 'شارع المظلات', ['el mezallat', 'mezallat', 'el mazallat', 'المظلات']);
streets('shoubra-street', ['shubra'], 'Shubra St', 'شارع شبرا', ['shoubra street', 'shubra street', 'شارع شبرا']);
streets('el-ahram-heliopolis', ['heliopolis'], 'El Ahram St (Heliopolis)', 'شارع الأهرام مصر الجديدة', ['el ahram street', 'ahram street', 'شارع الاهرام']);
streets('salah-salem', ['heliopolis', 'nasr-city', 'masr-el-qadima'], 'Salah Salem Rd', 'طريق صلاح سالم', ['salah salem', 'salah salim', 'صلاح سالم']);
streets('gesr-el-suez', ['heliopolis', 'ain-shams', 'zaytoun'], 'Gesr El Suez St', 'شارع جسر السويس', ['gesr el suez', 'gisr el suez', 'gesr suez', 'جسر السويس']);
streets('port-said-street', ['sayeda-zeinab', 'bab-el-shaaria'], 'Port Said St (Cairo)', 'شارع بورسعيد', ['port said street', 'portsaid street', 'شارع بورسعيد', 'شارع بور سعيد']);
streets('el-tahrir-street', ['dokki', 'downtown'], 'El Tahrir St', 'شارع التحرير', ['el tahrir street', 'tahrir street', 'tahrir st', 'شارع التحرير']);
streets('26-july', ['zamalek', 'downtown', 'agouza'], '26th of July St', 'شارع 26 يوليو', ['26th of july', '26 july', '26th july', '26 of july', '26 يوليو', 'سته وعشرين يوليو']);
streets('el-gomhouria', ['downtown', 'abdeen'], 'El Gomhouria St', 'شارع الجمهورية', ['el gomhouria', 'gomhoureya', 'el gomhoreya', 'الجمهوريه']);
streets('corniche-el-nil', ['maadi-cornish', 'garden-city', 'masr-el-qadima', 'agouza', 'downtown'], 'Corniche El Nil', 'كورنيش النيل', ['corniche el nil', 'corniche el nile', 'cornish el nil', 'nile corniche', 'كورنيش النيل']);
streets('el-horreya', ['heliopolis', 'alexandria'], 'El Horreya Rd', 'طريق الحرية', ['el horreya', 'horreya road', 'el horria', 'el horeya', 'طريق الحريه', 'شارع الحريه']);
streets('el-nasr-street', ['nasr-city', 'new-maadi'], 'El Nasr St', 'شارع النصر', ['el nasr street', 'el nasr avenue', 'nasr street', 'شارع النصر']);
streets('sudan-street', ['mohandessin', 'boulaq-dakrour'], 'Sudan St', 'شارع السودان', ['sudan street', 'el sudan street', 'sodan street', 'شارع السودان']);
// Heliopolis
streets('khalifa-el-maamoun', ['heliopolis'], 'El Khalifa El Maamoun St', 'شارع الخليفة المأمون', ['el khalifa el maamoun', 'khalifa el maamoun', 'khalifa maamoun', 'الخليفه المامون']);
streets('abdel-hamid-badawy', ['heliopolis'], 'Abdel Hamid Badawy St', 'شارع عبد الحميد بدوي', ['abdel hamid badawy', 'abd el hamid badawi', 'عبد الحميد بدوي']);
streets('othman-ibn-affan', ['heliopolis'], 'Othman Ibn Affan St', 'شارع عثمان بن عفان', ['othman ibn affan', 'osman ibn affan', 'othman bin affan', 'عثمان بن عفان']);
streets('damascus', ['heliopolis'], 'Dimashq St', 'شارع دمشق', ['el damashk', 'damashk street', 'dimashq street', 'damascus street', 'شارع دمشق']);
streets('beirut', ['heliopolis'], 'Beirut St', 'شارع بيروت', ['beirut street', 'beirut st', 'bayrut street', 'شارع بيروت']);
streets('baghdad', ['heliopolis'], 'Baghdad St', 'شارع بغداد', ['baghdad street', 'baghdad st', 'شارع بغداد']);
streets('abu-bakr-el-seddik', ['heliopolis'], 'Abu Bakr El Seddik St', 'شارع أبو بكر الصديق', ['abu bakr el seddik', 'abou bakr el seddik', 'abu bakr el sedeek', 'ابو بكر الصديق']);
streets('abdel-aziz-fahmy', ['heliopolis'], 'Abdel Aziz Fahmy St', 'شارع عبد العزيز فهمي', ['abdel aziz fahmy', 'abd el aziz fahmi', 'عبد العزيز فهمي']);
streets('el-nozha-street', ['heliopolis', 'nozha'], 'El Nozha St', 'شارع النزهة', ['el nozha street', 'nozha street', 'el nozha road', 'شارع النزهه']);
// Zamalek
streets('el-gezira-street', ['zamalek'], 'El Gezira St', 'شارع الجزيرة', ['el gezira street', 'gezira street', 'شارع الجزيره']);
streets('hassan-sabry', ['zamalek'], 'Hassan Sabry St', 'شارع حسن صبري', ['hassan sabry', 'hassan sabri', 'حسن صبري']);
streets('brazil-street', ['zamalek'], 'Brazil St', 'شارع البرازيل', ['brazil street', 'el brazil street', 'شارع البرازيل']);
streets('shagaret-el-dor', ['zamalek'], 'Shagaret El Dor St', 'شارع شجرة الدر', ['shagaret el dor', 'shagarat el dorr', 'shagret el dor', 'شجره الدر']);
streets('mohamed-mazhar', ['zamalek'], 'Mohamed Mazhar St', 'شارع محمد مظهر', ['mohamed mazhar', 'mohammed mazhar', 'محمد مظهر']);
streets('el-saleh-ayoub', ['zamalek'], 'El Saleh Ayoub St', 'شارع الصالح أيوب', ['el saleh ayoub', 'saleh ayoub', 'الصالح ايوب']);
// Dokki and Mohandessin
streets('el-ansar', ['dokki'], 'El Ansar St', 'شارع الأنصار', ['el ansar street', 'ansar street', 'شارع الانصار']);
streets('iran-street', ['dokki'], 'Iran St', 'شارع إيران', ['iran street', 'iran st', 'شارع ايران']);
streets('el-hussein-dokki', ['dokki'], 'El Hussein St (Dokki)', 'شارع الحسين الدقي', ['el hussein street', 'hussein street', 'شارع الحسين']);
streets('el-giza-street', ['dokki', 'giza-district'], 'El Giza St', 'شارع الجيزة', ['el giza street', 'giza street', 'شارع الجيزه']);
streets('dokki-street', ['dokki'], 'Dokki St', 'شارع الدقي', ['dokki street', 'el dokki street', 'شارع الدقي']);
streets('ahmed-orabi', ['mohandessin'], 'Ahmed Orabi St', 'شارع أحمد عرابي', ['ahmed orabi', 'ahmed oraby', 'احمد عرابي']);
streets('lebanon-street', ['mohandessin'], 'Lebanon St', 'شارع لبنان', ['lebanon street', 'lebnan street', 'شارع لبنان']);
streets('geziret-el-arab', ['mohandessin'], 'Geziret El Arab St', 'شارع جزيرة العرب', ['geziret el arab', 'gezirat el arab', 'جزيره العرب']);
// Downtown and Abdeen
streets('sabri-abu-alam', ['downtown'], 'Sabri Abu Alam St', 'شارع صبري أبو علم', ['sabri abu alam', 'sabry abou alam', 'صبري ابو علم']);
streets('kasr-el-nil-street', ['downtown'], 'Kasr El Nil St', 'شارع قصر النيل', ['kasr el nil street', 'qasr el nil street', 'شارع قصر النيل']);
streets('abdel-khaleq-sarwat', ['downtown'], 'Abdel Khaleq Sarwat St', 'شارع عبد الخالق ثروت', ['abdel khaleq sarwat', 'abd el khalek tharwat', 'abdel khalek sarwat', 'عبد الخالق ثروت']);
streets('el-alfi', ['downtown'], 'El Alfi St', 'شارع الألفي', ['el alfi', 'alfi street', 'el alfy', 'الالفي']);
streets('emad-el-din', ['downtown'], 'Emad El Din St', 'شارع عماد الدين', ['emad el din', 'emad eldin', 'عماد الدين']);
streets('el-galaa', ['downtown'], 'El Galaa St', 'شارع الجلاء', ['el galaa', 'galaa street', 'el gala street', 'الجلاء']);
streets('mansour-street', ['downtown'], 'Mansour St', 'شارع منصور', ['mansour street', 'mansour st', 'شارع منصور']);
streets('el-sheikh-rihan', ['abdeen'], 'El Sheikh Rihan St', 'شارع الشيخ ريحان', ['el sheikh rihan', 'sheikh rihan', 'sheikh rehan', 'الشيخ ريحان']);
streets('nubar', ['abdeen'], 'Nubar St', 'شارع نوبار', ['nobar street', 'nubar street', 'nobar', 'nubar', 'نوبار']);
// Shubra, Manial, Islamic Cairo
streets('kholousy', ['shubra'], 'Kholousy St', 'شارع خلوصي', ['khloosy', 'kholousy', 'kholosy', 'khulusi', 'خلوصي']);
streets('abdel-aziz-al-saud', ['manial'], 'Abdel Aziz Al Saud St', 'شارع عبد العزيز آل سعود', ['abdel aziz al saud', 'abdel aziz el saud', 'abd el aziz al saud', 'عبد العزيز ال سعود']);
streets('el-azhar-street', ['gamaleya', 'mosky'], 'El Azhar St', 'شارع الأزهر', ['el azhar street', 'azhar street', 'شارع الازهر']);
streets('gohar-el-qaid', ['gamaleya'], 'Gohar El Qaid St', 'شارع جوهر القائد', ['gohar el qaid', 'gawhar el qaed', 'gohar el kaed', 'جوهر القائد']);
streets('el-khayameya', ['darb-el-ahmar'], 'El Khayameya St', 'شارع الخيامية', ['el khayameya', 'khayameya', 'khayamiya', 'الخياميه']);
streets('bab-el-wazir', ['darb-el-ahmar'], 'Bab El Wazir St', 'شارع باب الوزير', ['bab el wazir', 'bab elwazir', 'باب الوزير']);
// Maadi numbered roads: shared names, decided by the district
for (const n of [9, 77, 82, 105, 151, 200, 206, 213, 233, 250, 254, 270]) {
  if (n === 9) continue;
  street(`maadi-road-${n}`, 'maadi', `Road ${n}`, `شارع ${n}`, [`road ${n}`, `street ${n}`, `st ${n}`, `${n} street`, `${n}th street`], { needsParent: true });
}
hood('mounira', 'sayeda-zeinab', 'El Mounira', 'المنيرة', ['el mounira', 'mounira', 'el monira']);

// Names that several places share. Alone they are unsure and list every option; next to
// another clue (a street, a district) that clue decides.
const SHARED: [string[], string[]][] = [
  [
    ['hadayek', 'hadaiq', 'hada2ek', 'hadaye2', 'haday2', 'hadayk', 'حدائق', 'حدايق', 'الحدائق'],
    ['hadayek-el-kobba', 'hadayek-el-zaytoun', 'hadayek-el-ahram', 'hadayek-october', 'hadayek-el-maadi', 'hadayek-helwan'],
  ],
];
for (const [names, ids] of SHARED) {
  for (const id of ids) {
    const place = P.find((p) => p.id === id);
    if (!place) throw new Error(`Shared name points at unknown place ${id}`);
    place.names = [...(place.names ?? []), ...names];
  }
}

export const PLACES: readonly Place[] = P;
