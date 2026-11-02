// Reference data for the demo month: two more merchants with Egyptian style catalogs,
// customer names, streets and the extra team members. Prices are integer piastres.

export interface DemoProduct {
  sku: string;
  titleEn: string;
  titleAr: string;
  pricePiastres: number;
  weightGrams: number;
}

export interface DemoMerchant {
  name: string;
  contactEmail: string;
  contactPhone: string;
  /** The merchant's own 60 minute delivery price */
  expressPricePiastres: number;
  user: { email: string; name: string; phone: string };
  /** First 7 digits of the EAN-13 barcodes */
  barcodePrefix: string;
  products: DemoProduct[];
}

const p = (sku: string, titleEn: string, titleAr: string, egp: number, grams: number) => ({
  sku,
  titleEn,
  titleAr,
  pricePiastres: egp * 100,
  weightGrams: grams,
});

export const DEMO_MERCHANTS: DemoMerchant[] = [
  {
    name: 'Nile Pantry',
    contactEmail: 'hello@nilepantry.example',
    contactPhone: '+201000000501',
    expressPricePiastres: 3900,
    user: { email: 'ops@nilepantry.example', name: 'Nile Pantry Ops', phone: '+201000000502' },
    barcodePrefix: '6223001',
    products: [
      p('NP-001', 'Siwa Dates 1 kg', 'تمر سيوي 1 كجم', 165, 1050),
      p('NP-002', 'Medjool Dates 500 g', 'تمر مجدول 500 جم', 240, 520),
      p('NP-003', 'Clover Honey 500 g', 'عسل برسيم 500 جم', 185, 600),
      p('NP-004', 'Citrus Blossom Honey 500 g', 'عسل موالح 500 جم', 210, 600),
      p('NP-005', 'Tahini 450 g', 'طحينة 450 جم', 95, 480),
      p('NP-006', 'Halawa with Pistachio 400 g', 'حلاوة طحينية بالفستق 400 جم', 120, 420),
      p('NP-007', 'Turkish Coffee with Cardamom 250 g', 'بن تركي محوج 250 جم', 145, 260),
      p('NP-008', 'Hibiscus (Karkade) 200 g', 'كركديه 200 جم', 60, 210),
      p('NP-009', 'Dukkah Spice Mix 150 g', 'دقة 150 جم', 75, 160),
      p('NP-010', 'Cumin Ground 100 g', 'كمون مطحون 100 جم', 45, 110),
      p('NP-011', 'Extra Virgin Olive Oil 1 L', 'زيت زيتون بكر ممتاز 1 لتر', 450, 1000),
      p('NP-012', 'Black Seed Oil 250 ml', 'زيت حبة البركة 250 مل', 135, 270),
      p('NP-013', 'Ful Medames 400 g', 'فول مدمس 400 جم', 35, 430),
      p('NP-014', 'Mixed Nuts Roasted 500 g', 'مكسرات مشكلة محمصة 500 جم', 390, 520),
      p('NP-015', 'Freekeh 1 kg', 'فريك 1 كجم', 85, 1020),
      p('NP-016', 'Molokhia Dried 200 g', 'ملوخية ناشفة 200 جم', 55, 210),
      p('NP-017', 'Pickled Lemons 500 g', 'ليمون مخلل 500 جم', 50, 560),
      p('NP-018', 'Feta Cheese Istanbuli 500 g', 'جبنة إسطنبولي 500 جم', 90, 520),
      p('NP-019', 'Basbousa Tray 1 kg', 'بسبوسة صينية 1 كجم', 220, 1050),
      p('NP-020', 'Kahk with Agameya 500 g', 'كحك بالعجمية 500 جم', 260, 520),
    ],
  },
  {
    name: 'Bayt Home & Care',
    contactEmail: 'care@bayt.example',
    contactPhone: '+201100000501',
    expressPricePiastres: 4900,
    user: { email: 'ops@bayt.example', name: 'Bayt Home Ops', phone: '+201100000502' },
    barcodePrefix: '6223002',
    products: [
      p('BH-001', 'Argan Oil Shampoo 400 ml', 'شامبو بزيت الأرجان 400 مل', 175, 430),
      p('BH-002', 'Argan Oil Conditioner 400 ml', 'بلسم بزيت الأرجان 400 مل', 175, 430),
      p('BH-003', 'Olive Oil Soap Bar 125 g', 'صابون زيت الزيتون 125 جم', 40, 130),
      p('BH-004', 'Glycerin Hand Soap 500 ml', 'صابون يد جلسرين 500 مل', 65, 540),
      p('BH-005', 'Laundry Detergent 3 kg', 'مسحوق غسيل أوتوماتيك 3 كجم', 320, 3050),
      p('BH-006', 'Fabric Softener Jasmine 2 L', 'منعم ملابس ياسمين 2 لتر', 140, 2050),
      p('BH-007', 'Dishwashing Liquid Lemon 1 L', 'سائل أطباق ليمون 1 لتر', 70, 1050),
      p('BH-008', 'Floor Cleaner Pine 2 L', 'منظف أرضيات صنوبر 2 لتر', 95, 2050),
      p('BH-009', 'Bamboo Kitchen Towels 6 rolls', 'مناديل مطبخ بامبو 6 لفات', 110, 900),
      p('BH-010', 'Facial Tissues 5 boxes', 'مناديل وجه 5 علب', 125, 800),
      p('BH-011', 'Baby Wipes Sensitive 72 pcs', 'مناديل أطفال مبللة 72 قطعة', 60, 420),
      p('BH-012', 'Sunscreen SPF 50 100 ml', 'واقي شمس SPF 50 100 مل', 385, 130),
      p('BH-013', 'Aloe Vera Gel 250 ml', 'جل الصبار 250 مل', 115, 270),
      p('BH-014', 'Toothpaste Herbal 100 ml', 'معجون أسنان أعشاب 100 مل', 55, 140),
      p('BH-015', 'Bakhoor Oud Incense 50 g', 'بخور عود 50 جم', 150, 80),
      p('BH-016', 'Scented Candle Amber', 'شمعة معطرة عنبر', 230, 350),
      p('BH-017', 'Cotton Bath Towel Large', 'فوطة حمام قطن مقاس كبير', 290, 650),
      p('BH-018', 'Egyptian Cotton Pillowcase Pair', 'كيس مخدة قطن مصري زوج', 340, 400),
      p('BH-019', 'Garbage Bags 50 pcs', 'أكياس قمامة 50 كيس', 45, 450),
      p('BH-020', 'Air Freshener Rose 300 ml', 'معطر جو ورد 300 مل', 85, 330),
    ],
  },
];

/** Extra team members so every store has staff and at least two riders. */
export const DEMO_TEAM: {
  email: string;
  name: string;
  phone: string;
  role: 'store_staff' | 'rider';
  storeCode: string;
  badgeCode?: string;
}[] = [
  {
    email: 'demo.staff.zamalek@shiplynow.local',
    name: 'Hoda Ragab',
    phone: '+201000000901',
    role: 'store_staff',
    storeCode: 'ZAM',
  },
  {
    email: 'demo.rider1.newcairo@shiplynow.local',
    name: 'Mostafa Gamal',
    phone: '+201100000901',
    role: 'rider',
    storeCode: 'NCR',
    badgeCode: 'RDR-0901',
  },
  {
    email: 'demo.rider2.newcairo@shiplynow.local',
    name: 'Islam Saeed',
    phone: '+201100000902',
    role: 'rider',
    storeCode: 'NCR',
    badgeCode: 'RDR-0902',
  },
  {
    email: 'demo.rider1.maadi@shiplynow.local',
    name: 'Hany Abdelaziz',
    phone: '+201100000903',
    role: 'rider',
    storeCode: 'MAA',
    badgeCode: 'RDR-0903',
  },
  {
    email: 'demo.rider1.zamalek@shiplynow.local',
    name: 'Walid Shaker',
    phone: '+201100000904',
    role: 'rider',
    storeCode: 'ZAM',
    badgeCode: 'RDR-0904',
  },
  {
    email: 'demo.rider2.zamalek@shiplynow.local',
    name: 'Tamer Farouk',
    phone: '+201100000905',
    role: 'rider',
    storeCode: 'ZAM',
    badgeCode: 'RDR-0905',
  },
];

/** A second finance person, so whatever needs two people gets a different approver. */
export const DEMO_APPROVER = {
  email: 'demo.finance.approver@shiplynow.local',
  name: 'Omar Lotfy',
  phone: '+201500000901',
};

export const FIRST_NAMES = [
  'Ahmed',
  'Mohamed',
  'Mahmoud',
  'Mostafa',
  'Omar',
  'Youssef',
  'Karim',
  'Hassan',
  'Ali',
  'Amr',
  'Tarek',
  'Sherif',
  'Khaled',
  'Hossam',
  'Ibrahim',
  'Ziad',
  'Adham',
  'Seif',
  'Nour',
  'Mariam',
  'Sara',
  'Yasmin',
  'Nada',
  'Salma',
  'Habiba',
  'Farida',
  'Malak',
  'Laila',
  'Dina',
  'Rana',
  'Heba',
  'Aya',
  'Menna',
  'Reem',
  'Shahd',
  'Jana',
  'Hana',
  'Noha',
  'Rania',
  'Ghada',
];

export const LAST_NAMES = [
  'Hassan',
  'Mahmoud',
  'Ibrahim',
  'Abdelrahman',
  'El Sayed',
  'Mostafa',
  'Fathy',
  'Salah',
  'Gamal',
  'Adel',
  'Kamal',
  'Fouad',
  'Hamdy',
  'Saber',
  'Nabil',
  'Shawky',
  'Ragab',
  'Zaki',
  'El Masry',
  'Soliman',
  'Farag',
  'Lotfy',
  'Hegazy',
  'Abdallah',
  'Osman',
  'Helmy',
  'Badawy',
];

export const STREETS = [
  'Street 9',
  'Street 77',
  'Road 233',
  'El Nasr Street',
  'Gamal Abdel Nasser Street',
  'El Tesseen Street',
  'Mohamed Naguib Axis',
  'Abu Bakr El Seddik Street',
  'El Laselki Street',
  'Hassan Sabry Street',
  'Brazil Street',
  'Mohamed Mazhar Street',
  'Shagaret El Dor Street',
  'Taha Hussein Street',
  'El Gezira Street',
  'Ismail Mohamed Street',
  'Road 250',
  'El Nahda Street',
  'Street 82',
  'El Thawra Street',
];

export const CANCEL_REASONS = [
  'Customer asked to cancel',
  'Customer ordered twice by mistake',
  'Customer changed the address to another city',
];

export const COLLECTORS = ['Ashraf Nagy', 'Samy Fekry'];

/** Small JPEGs (32 x 24) standing in for the pack and door photos. */
export const PACK_PHOTO_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDTnlEEW8qzchQq4ySSAOv1qP7RL/z5XH/fUf8A8VRff6hf+u0X/oa1Yrz+h2dSv9ol/wCfK4/76j/+KqSCUTxbwrLyVKtjIIJB6fSpKr2P+ob/AK7S/wDobUdA6kk8Qni2FmXkMGXGQQQR1+lR/Z5f+f24/wC+Y/8A4miilcLB9nl/5/bj/vmP/wCJqSCIQRbAzNyWLNjJJJJ6fWiii4WP/9k=';

export const DOOR_PHOTO_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBssgjTcQW5AwOpycUzzX/59pfzX/Gi5/1Q/wCuif8AoQqatjMh81/+faX81/xp8UgkTcAV5IweowcU+obb/VH/AK6P/wChGgB8sYkTaSV5ByOowc0zyn/5+ZfyX/CiimAeU/8Az8y/kv8AhT4oxGm0EtyTk9Tk5oooA//Z';
