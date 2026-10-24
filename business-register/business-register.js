/* WeGoGym business registration: wegogym.club/business-register/
 *
 * Creates a gym owner's account, then fills in a DRAFT listing in the live database
 * through the same doors the app uses:
 *   register_venue (creates the draft, the owner membership and the business-owner role)
 *   -> PATCH venues (business, facility and amenity details)
 *   -> venue-photos storage bucket + venue_photos rows.
 * Nothing here submits the listing for review or touches payments: pricing, access,
 * house rules, the fee agreement and payouts are finished later.
 *
 * Plain fetch rather than supabase-js, because the site's Content-Security-Policy only
 * allows scripts from this domain and the library would otherwise have to be vendored.
 */
(function () {
  "use strict";

  // ===== EDIT: the only setting =====
  var CONFIG = {
    url: "https://yxgwywppajvxfmmjudaq.supabase.co",
    // Supabase > Project Settings > API keys > the "publishable" (or legacy "anon") key.
    // It is meant to be public: what a visitor can do is decided by the database's rules.
    key: "sb_publishable_HoGxqewsV4DLLKpUCmtS-g_Ad-3D5o-",
    // Where the link in the confirmation email returns to. Add it to Supabase >
    // Authentication > URL Configuration > Redirect URLs.
    redirect: "https://wegogym.club/business-register/"
  };

  var SESSION_KEY = "wgg-business-session";
  var VENUE_COLS = "id,name,slug,status,country,timezone,description,category_slug,legal_name," +
    "company_number,contact_name,contact_email,contact_phone,address_line1,address_line2," +
    "city,region,postcode,opening_hours,amenities,category_other";
  var PHOTO_MAX_BYTES = 5 * 1024 * 1024; // the bucket's own limit (migration 0011)
  var PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
  var PHOTO_LONG_EDGE = 2400;

  // Every country a facility can register from (Israel deliberately excluded, Palestine
  // included): [ISO code, name, ISO 4217 currency, time zone]. The time zone is the
  // country's own; US, Canada and Australia take theirs from the state or province.
  var COUNTRIES = [
    ["AF", "Afghanistan", "afn", "Asia/Kabul"],
    ["AL", "Albania", "all", "Europe/Tirane"],
    ["DZ", "Algeria", "dzd", "Africa/Algiers"],
    ["AS", "American Samoa", "usd", "Pacific/Pago_Pago"],
    ["AD", "Andorra", "eur", "Europe/Andorra"],
    ["AO", "Angola", "aoa", "Africa/Luanda"],
    ["AI", "Anguilla", "xcd", "America/Anguilla"],
    ["AG", "Antigua and Barbuda", "xcd", "America/Antigua"],
    ["AR", "Argentina", "ars", "America/Argentina/Buenos_Aires"],
    ["AM", "Armenia", "amd", "Asia/Yerevan"],
    ["AW", "Aruba", "awg", "America/Aruba"],
    ["AU", "Australia", "aud", "Australia/Lord_Howe"],
    ["AT", "Austria", "eur", "Europe/Vienna"],
    ["AZ", "Azerbaijan", "azn", "Asia/Baku"],
    ["BS", "Bahamas", "bsd", "America/Nassau"],
    ["BH", "Bahrain", "bhd", "Asia/Bahrain"],
    ["BD", "Bangladesh", "bdt", "Asia/Dhaka"],
    ["BB", "Barbados", "bbd", "America/Barbados"],
    ["BY", "Belarus", "byn", "Europe/Minsk"],
    ["BE", "Belgium", "eur", "Europe/Brussels"],
    ["BZ", "Belize", "bzd", "America/Belize"],
    ["BJ", "Benin", "xof", "Africa/Porto-Novo"],
    ["BM", "Bermuda", "bmd", "Atlantic/Bermuda"],
    ["BT", "Bhutan", "btn", "Asia/Thimphu"],
    ["BO", "Bolivia", "bob", "America/La_Paz"],
    ["BA", "Bosnia and Herzegovina", "bam", "Europe/Sarajevo"],
    ["BW", "Botswana", "bwp", "Africa/Gaborone"],
    ["BR", "Brazil", "brl", "America/Sao_Paulo"],
    ["VG", "British Virgin Islands", "usd", "America/Tortola"],
    ["BN", "Brunei", "bnd", "Asia/Brunei"],
    ["BG", "Bulgaria", "bgn", "Europe/Sofia"],
    ["BF", "Burkina Faso", "xof", "Africa/Ouagadougou"],
    ["BI", "Burundi", "bif", "Africa/Bujumbura"],
    ["KH", "Cambodia", "khr", "Asia/Phnom_Penh"],
    ["CM", "Cameroon", "xaf", "Africa/Douala"],
    ["CA", "Canada", "cad", "America/St_Johns"],
    ["CV", "Cape Verde", "cve", "Atlantic/Cape_Verde"],
    ["BQ", "Caribbean Netherlands", "usd", "America/Kralendijk"],
    ["KY", "Cayman Islands", "kyd", "America/Cayman"],
    ["CF", "Central African Republic", "xaf", "Africa/Bangui"],
    ["TD", "Chad", "xaf", "Africa/Ndjamena"],
    ["CL", "Chile", "clp", "America/Santiago"],
    ["CN", "China", "cny", "Asia/Shanghai"],
    ["CX", "Christmas Island", "aud", "Indian/Christmas"],
    ["CC", "Cocos (Keeling) Islands", "aud", "Indian/Cocos"],
    ["CO", "Colombia", "cop", "America/Bogota"],
    ["KM", "Comoros", "kmf", "Indian/Comoro"],
    ["CK", "Cook Islands", "nzd", "Pacific/Rarotonga"],
    ["CR", "Costa Rica", "crc", "America/Costa_Rica"],
    ["HR", "Croatia", "eur", "Europe/Zagreb"],
    ["CU", "Cuba", "cup", "America/Havana"],
    ["CW", "Curaçao", "xcg", "America/Curacao"],
    ["CY", "Cyprus", "eur", "Asia/Nicosia"],
    ["CZ", "Czechia", "czk", "Europe/Prague"],
    ["CI", "Côte d’Ivoire", "xof", "Africa/Abidjan"],
    ["CD", "Democratic Republic of the Congo", "cdf", "Africa/Kinshasa"],
    ["DK", "Denmark", "dkk", "Europe/Copenhagen"],
    ["DJ", "Djibouti", "djf", "Africa/Djibouti"],
    ["DM", "Dominica", "xcd", "America/Dominica"],
    ["DO", "Dominican Republic", "dop", "America/Santo_Domingo"],
    ["EC", "Ecuador", "usd", "America/Guayaquil"],
    ["EG", "Egypt", "egp", "Africa/Cairo"],
    ["SV", "El Salvador", "usd", "America/El_Salvador"],
    ["GQ", "Equatorial Guinea", "xaf", "Africa/Malabo"],
    ["ER", "Eritrea", "ern", "Africa/Asmara"],
    ["EE", "Estonia", "eur", "Europe/Tallinn"],
    ["SZ", "Eswatini", "szl", "Africa/Mbabane"],
    ["ET", "Ethiopia", "etb", "Africa/Addis_Ababa"],
    ["FK", "Falkland Islands", "fkp", "Atlantic/Stanley"],
    ["FO", "Faroe Islands", "dkk", "Atlantic/Faroe"],
    ["FJ", "Fiji", "fjd", "Pacific/Fiji"],
    ["FI", "Finland", "eur", "Europe/Helsinki"],
    ["FR", "France", "eur", "Europe/Paris"],
    ["GF", "French Guiana", "eur", "America/Cayenne"],
    ["PF", "French Polynesia", "xpf", "Pacific/Tahiti"],
    ["GA", "Gabon", "xaf", "Africa/Libreville"],
    ["GM", "Gambia", "gmd", "Africa/Banjul"],
    ["GE", "Georgia", "gel", "Asia/Tbilisi"],
    ["DE", "Germany", "eur", "Europe/Berlin"],
    ["GH", "Ghana", "ghs", "Africa/Accra"],
    ["GI", "Gibraltar", "gip", "Europe/Gibraltar"],
    ["GR", "Greece", "eur", "Europe/Athens"],
    ["GL", "Greenland", "dkk", "America/Nuuk"],
    ["GD", "Grenada", "xcd", "America/Grenada"],
    ["GP", "Guadeloupe", "eur", "America/Guadeloupe"],
    ["GU", "Guam", "usd", "Pacific/Guam"],
    ["GT", "Guatemala", "gtq", "America/Guatemala"],
    ["GG", "Guernsey", "gbp", "Europe/Guernsey"],
    ["GN", "Guinea", "gnf", "Africa/Conakry"],
    ["GW", "Guinea-Bissau", "xof", "Africa/Bissau"],
    ["GY", "Guyana", "gyd", "America/Guyana"],
    ["HT", "Haiti", "htg", "America/Port-au-Prince"],
    ["HN", "Honduras", "hnl", "America/Tegucigalpa"],
    ["HK", "Hong Kong", "hkd", "Asia/Hong_Kong"],
    ["HU", "Hungary", "huf", "Europe/Budapest"],
    ["IS", "Iceland", "isk", "Atlantic/Reykjavik"],
    ["IN", "India", "inr", "Asia/Kolkata"],
    ["ID", "Indonesia", "idr", "Asia/Jakarta"],
    ["IR", "Iran", "irr", "Asia/Tehran"],
    ["IQ", "Iraq", "iqd", "Asia/Baghdad"],
    ["IE", "Ireland", "eur", "Europe/Dublin"],
    ["IM", "Isle of Man", "gbp", "Europe/Isle_of_Man"],
    ["IT", "Italy", "eur", "Europe/Rome"],
    ["JM", "Jamaica", "jmd", "America/Jamaica"],
    ["JP", "Japan", "jpy", "Asia/Tokyo"],
    ["JE", "Jersey", "gbp", "Europe/Jersey"],
    ["JO", "Jordan", "jod", "Asia/Amman"],
    ["KZ", "Kazakhstan", "kzt", "Asia/Almaty"],
    ["KE", "Kenya", "kes", "Africa/Nairobi"],
    ["KI", "Kiribati", "aud", "Pacific/Tarawa"],
    ["XK", "Kosovo", "eur", "Europe/Belgrade"],
    ["KW", "Kuwait", "kwd", "Asia/Kuwait"],
    ["KG", "Kyrgyzstan", "kgs", "Asia/Bishkek"],
    ["LA", "Laos", "lak", "Asia/Vientiane"],
    ["LV", "Latvia", "eur", "Europe/Riga"],
    ["LB", "Lebanon", "lbp", "Asia/Beirut"],
    ["LS", "Lesotho", "lsl", "Africa/Maseru"],
    ["LR", "Liberia", "lrd", "Africa/Monrovia"],
    ["LY", "Libya", "lyd", "Africa/Tripoli"],
    ["LI", "Liechtenstein", "chf", "Europe/Vaduz"],
    ["LT", "Lithuania", "eur", "Europe/Vilnius"],
    ["LU", "Luxembourg", "eur", "Europe/Luxembourg"],
    ["MO", "Macao", "mop", "Asia/Macau"],
    ["MG", "Madagascar", "mga", "Indian/Antananarivo"],
    ["MW", "Malawi", "mwk", "Africa/Blantyre"],
    ["MY", "Malaysia", "myr", "Asia/Kuala_Lumpur"],
    ["MV", "Maldives", "mvr", "Indian/Maldives"],
    ["ML", "Mali", "xof", "Africa/Bamako"],
    ["MT", "Malta", "eur", "Europe/Malta"],
    ["MH", "Marshall Islands", "usd", "Pacific/Majuro"],
    ["MQ", "Martinique", "eur", "America/Martinique"],
    ["MR", "Mauritania", "mru", "Africa/Nouakchott"],
    ["MU", "Mauritius", "mur", "Indian/Mauritius"],
    ["YT", "Mayotte", "eur", "Indian/Mayotte"],
    ["MX", "Mexico", "mxn", "America/Mexico_City"],
    ["FM", "Micronesia", "usd", "Pacific/Chuuk"],
    ["MD", "Moldova", "mdl", "Europe/Chisinau"],
    ["MC", "Monaco", "eur", "Europe/Monaco"],
    ["MN", "Mongolia", "mnt", "Asia/Ulaanbaatar"],
    ["ME", "Montenegro", "eur", "Europe/Podgorica"],
    ["MS", "Montserrat", "xcd", "America/Montserrat"],
    ["MA", "Morocco", "mad", "Africa/Casablanca"],
    ["MZ", "Mozambique", "mzn", "Africa/Maputo"],
    ["MM", "Myanmar", "mmk", "Asia/Yangon"],
    ["NA", "Namibia", "nad", "Africa/Windhoek"],
    ["NR", "Nauru", "aud", "Pacific/Nauru"],
    ["NP", "Nepal", "npr", "Asia/Kathmandu"],
    ["NL", "Netherlands", "eur", "Europe/Amsterdam"],
    ["NC", "New Caledonia", "xpf", "Pacific/Noumea"],
    ["NZ", "New Zealand", "nzd", "Pacific/Auckland"],
    ["NI", "Nicaragua", "nio", "America/Managua"],
    ["NE", "Niger", "xof", "Africa/Niamey"],
    ["NG", "Nigeria", "ngn", "Africa/Lagos"],
    ["NU", "Niue", "nzd", "Pacific/Niue"],
    ["NF", "Norfolk Island", "aud", "Pacific/Norfolk"],
    ["KP", "North Korea", "kpw", "Asia/Pyongyang"],
    ["MK", "North Macedonia", "mkd", "Europe/Skopje"],
    ["MP", "Northern Mariana Islands", "usd", "Pacific/Saipan"],
    ["NO", "Norway", "nok", "Europe/Oslo"],
    ["OM", "Oman", "omr", "Asia/Muscat"],
    ["PK", "Pakistan", "pkr", "Asia/Karachi"],
    ["PW", "Palau", "usd", "Pacific/Palau"],
    ["PS", "Palestine", "ils", "Asia/Gaza"],
    ["PA", "Panama", "pab", "America/Panama"],
    ["PG", "Papua New Guinea", "pgk", "Pacific/Port_Moresby"],
    ["PY", "Paraguay", "pyg", "America/Asuncion"],
    ["PE", "Peru", "pen", "America/Lima"],
    ["PH", "Philippines", "php", "Asia/Manila"],
    ["PN", "Pitcairn Islands", "nzd", "Pacific/Pitcairn"],
    ["PL", "Poland", "pln", "Europe/Warsaw"],
    ["PT", "Portugal", "eur", "Europe/Lisbon"],
    ["PR", "Puerto Rico", "usd", "America/Puerto_Rico"],
    ["QA", "Qatar", "qar", "Asia/Qatar"],
    ["CG", "Republic of the Congo", "xaf", "Africa/Brazzaville"],
    ["RO", "Romania", "ron", "Europe/Bucharest"],
    ["RU", "Russia", "rub", "Europe/Moscow"],
    ["RW", "Rwanda", "rwf", "Africa/Kigali"],
    ["RE", "Réunion", "eur", "Indian/Reunion"],
    ["WS", "Samoa", "wst", "Pacific/Apia"],
    ["SM", "San Marino", "eur", "Europe/San_Marino"],
    ["SA", "Saudi Arabia", "sar", "Asia/Riyadh"],
    ["SN", "Senegal", "xof", "Africa/Dakar"],
    ["RS", "Serbia", "rsd", "Europe/Belgrade"],
    ["SC", "Seychelles", "scr", "Indian/Mahe"],
    ["SL", "Sierra Leone", "sle", "Africa/Freetown"],
    ["SG", "Singapore", "sgd", "Asia/Singapore"],
    ["SX", "Sint Maarten", "xcg", "America/Lower_Princes"],
    ["SK", "Slovakia", "eur", "Europe/Bratislava"],
    ["SI", "Slovenia", "eur", "Europe/Ljubljana"],
    ["SB", "Solomon Islands", "sbd", "Pacific/Guadalcanal"],
    ["SO", "Somalia", "sos", "Africa/Mogadishu"],
    ["ZA", "South Africa", "zar", "Africa/Johannesburg"],
    ["KR", "South Korea", "krw", "Asia/Seoul"],
    ["SS", "South Sudan", "ssp", "Africa/Juba"],
    ["ES", "Spain", "eur", "Europe/Madrid"],
    ["LK", "Sri Lanka", "lkr", "Asia/Colombo"],
    ["BL", "St Barthélemy", "eur", "America/St_Barthelemy"],
    ["SH", "St Helena", "shp", "Atlantic/St_Helena"],
    ["KN", "St Kitts and Nevis", "xcd", "America/St_Kitts"],
    ["LC", "St Lucia", "xcd", "America/St_Lucia"],
    ["MF", "St Martin", "eur", "America/Marigot"],
    ["PM", "St Pierre and Miquelon", "eur", "America/Miquelon"],
    ["VC", "St Vincent and the Grenadines", "xcd", "America/St_Vincent"],
    ["SD", "Sudan", "sdg", "Africa/Khartoum"],
    ["SR", "Suriname", "srd", "America/Paramaribo"],
    ["SJ", "Svalbard and Jan Mayen", "nok", "Arctic/Longyearbyen"],
    ["SE", "Sweden", "sek", "Europe/Stockholm"],
    ["CH", "Switzerland", "chf", "Europe/Zurich"],
    ["SY", "Syria", "syp", "Asia/Damascus"],
    ["ST", "São Tomé and Príncipe", "stn", "Africa/Sao_Tome"],
    ["TW", "Taiwan", "twd", "Asia/Taipei"],
    ["TJ", "Tajikistan", "tjs", "Asia/Dushanbe"],
    ["TZ", "Tanzania", "tzs", "Africa/Dar_es_Salaam"],
    ["TH", "Thailand", "thb", "Asia/Bangkok"],
    ["TL", "Timor-Leste", "usd", "Asia/Dili"],
    ["TG", "Togo", "xof", "Africa/Lome"],
    ["TK", "Tokelau", "nzd", "Pacific/Fakaofo"],
    ["TO", "Tonga", "top", "Pacific/Tongatapu"],
    ["TT", "Trinidad and Tobago", "ttd", "America/Port_of_Spain"],
    ["TN", "Tunisia", "tnd", "Africa/Tunis"],
    ["TM", "Turkmenistan", "tmt", "Asia/Ashgabat"],
    ["TC", "Turks and Caicos Islands", "usd", "America/Grand_Turk"],
    ["TV", "Tuvalu", "aud", "Pacific/Funafuti"],
    ["TR", "Türkiye", "try", "Europe/Istanbul"],
    ["VI", "US Virgin Islands", "usd", "America/St_Thomas"],
    ["UG", "Uganda", "ugx", "Africa/Kampala"],
    ["UA", "Ukraine", "uah", "Europe/Kyiv"],
    ["AE", "United Arab Emirates", "aed", "Asia/Dubai"],
    ["GB", "United Kingdom", "gbp", "Europe/London"],
    ["US", "United States", "usd", "America/New_York"],
    ["UY", "Uruguay", "uyu", "America/Montevideo"],
    ["UZ", "Uzbekistan", "uzs", "Asia/Tashkent"],
    ["VU", "Vanuatu", "vuv", "Pacific/Efate"],
    ["VA", "Vatican City", "eur", "Europe/Vatican"],
    ["VE", "Venezuela", "ves", "America/Caracas"],
    ["VN", "Vietnam", "vnd", "Asia/Ho_Chi_Minh"],
    ["WF", "Wallis and Futuna", "xpf", "Pacific/Wallis"],
    ["EH", "Western Sahara", "mad", "Africa/El_Aaiun"],
    ["YE", "Yemen", "yer", "Asia/Aden"],
    ["ZM", "Zambia", "zmw", "Africa/Lusaka"],
    ["ZW", "Zimbabwe", "usd", "Africa/Harare"],
    ["AX", "Åland Islands", "eur", "Europe/Mariehamn"]
  ];
  var REGIONS = {
    US: { label: "State", zones: {"Alabama": "America/Chicago", "Alaska": "America/Anchorage", "Arizona": "America/Phoenix", "Arkansas": "America/Chicago", "California": "America/Los_Angeles", "Colorado": "America/Denver", "Connecticut": "America/New_York", "Delaware": "America/New_York", "District of Columbia": "America/New_York", "Florida": "America/New_York", "Georgia": "America/New_York", "Hawaii": "Pacific/Honolulu", "Idaho": "America/Boise", "Illinois": "America/Chicago", "Indiana": "America/Indiana/Indianapolis", "Iowa": "America/Chicago", "Kansas": "America/Chicago", "Kentucky": "America/New_York", "Louisiana": "America/Chicago", "Maine": "America/New_York", "Maryland": "America/New_York", "Massachusetts": "America/New_York", "Michigan": "America/Detroit", "Minnesota": "America/Chicago", "Mississippi": "America/Chicago", "Missouri": "America/Chicago", "Montana": "America/Denver", "Nebraska": "America/Chicago", "Nevada": "America/Los_Angeles", "New Hampshire": "America/New_York", "New Jersey": "America/New_York", "New Mexico": "America/Denver", "New York": "America/New_York", "North Carolina": "America/New_York", "North Dakota": "America/Chicago", "Ohio": "America/New_York", "Oklahoma": "America/Chicago", "Oregon": "America/Los_Angeles", "Pennsylvania": "America/New_York", "Rhode Island": "America/New_York", "South Carolina": "America/New_York", "South Dakota": "America/Chicago", "Tennessee": "America/Chicago", "Texas": "America/Chicago", "Utah": "America/Denver", "Vermont": "America/New_York", "Virginia": "America/New_York", "Washington": "America/Los_Angeles", "West Virginia": "America/New_York", "Wisconsin": "America/Chicago", "Wyoming": "America/Denver"} },
    CA: { label: "Province or territory", zones: {"Alberta": "America/Edmonton", "British Columbia": "America/Vancouver", "Manitoba": "America/Winnipeg", "New Brunswick": "America/Moncton", "Newfoundland and Labrador": "America/St_Johns", "Northwest Territories": "America/Edmonton", "Nova Scotia": "America/Halifax", "Nunavut": "America/Iqaluit", "Ontario": "America/Toronto", "Prince Edward Island": "America/Halifax", "Quebec": "America/Toronto", "Saskatchewan": "America/Regina", "Yukon": "America/Whitehorse"} },
    AU: { label: "State or territory", zones: {"Australian Capital Territory": "Australia/Sydney", "New South Wales": "Australia/Sydney", "Northern Territory": "Australia/Darwin", "Queensland": "Australia/Brisbane", "South Australia": "Australia/Adelaide", "Tasmania": "Australia/Hobart", "Victoria": "Australia/Melbourne", "Western Australia": "Australia/Perth"} }
  };
  // No table backs amenities: packages/shared AMENITIES is the vocabulary. Keep in step.
   // Most common first (in order of how common they are), then the rest A to Z.
  var AMENITIES = [
    ["showers", "Showers", true],
    ["changing_rooms", "Changing rooms", true],
    ["lockers", "Lockers", true],
    ["toilets", "Toilets", true],
    ["free_weights", "Free weights", true],
    ["cardio_equipment", "Cardio equipment", true],
    ["machines", "Machines", true],
    ["classes", "Classes", true],
    ["parking", "Parking", true],
    ["wifi", "Wi-Fi", true],
    ["drinking_water", "Drinking water", true],
    ["air_conditioning", "Air conditioning", true],
    ["personal_training", "Personal training", true],
    ["towels", "Towels provided", true],
    ["pool", "Swimming pool", true],
    ["sauna", "Sauna", true],
    ["accessible_changing", "Accessible changing room"],
    ["accessible_toilet", "Accessible toilet"],
    ["assault_bikes", "Air bikes"],
    ["aqua_classes", "Aqua classes"],
    ["auto_belay", "Auto-belay"],
    ["baby_changing", "Baby changing"],
    ["badminton_courts", "Badminton courts"],
    ["barre_studio", "Barre studio"],
    ["basketball_court", "Basketball court"],
    ["battle_ropes", "Battle ropes"],
    ["beauty_treatments", "Beauty treatments"],
    ["bike_storage", "Bike storage"],
    ["body_composition", "Body composition scans"],
    ["boxing_ring", "Boxing ring"],
    ["cable_machines", "Cable machines"],
    ["cafe", "Cafe or juice bar"],
    ["chalk_allowed", "Chalk allowed"],
    ["childcare", "Childcare or creche"],
    ["childrens_pool", "Children's pool"],
    ["chiropractic", "Chiropractic"],
    ["climbing_wall", "Climbing or bouldering wall"],
    ["coworking", "Co-working space"],
    ["cold_plunge", "Cold plunge or ice bath"],
    ["compression_boots", "Compression boots"],
    ["cricket_nets", "Cricket nets"],
    ["cryotherapy", "Cryotherapy"],
    ["cycle_studio", "Cycle studio"],
    ["dance_studio", "Dance studio"],
    ["diving_pool", "Diving pool"],
    ["ev_charging", "Electric car charging"],
    ["equipment_hire", "Equipment hire"],
    ["family_changing", "Family changing room"],
    ["fitness_assessments", "Fitness assessments"],
    ["float_tank", "Float tank"],
    ["football_pitch", "Football pitch"],
    ["induction", "Free induction"],
    ["functional_area", "Functional training area"],
    ["gender_neutral_changing", "Gender-neutral changing"],
    ["golf_simulator", "Golf simulator"],
    ["grappling_mats", "Grappling mats"],
    ["hair_dryers", "Hair dryers"],
    ["hammam", "Hammam"],
    ["hearing_loop", "Hearing loop"],
    ["heated_studio", "Heated studio"],
    ["hot_tub", "Hot tub"],
    ["hydrotherapy_pool", "Hydrotherapy pool"],
    ["inclusive_equipment", "Inclusive fitness equipment"],
    ["infrared_sauna", "Infrared sauna"],
    ["kettlebells", "Kettlebells"],
    ["kids_classes", "Kids' classes"],
    ["kit_shop", "Kit shop"],
    ["lane_swimming", "Lane swimming"],
    ["learner_pool", "Learner pool"],
    ["lift", "Lift"],
    ["lifting_platforms", "Lifting platforms"],
    ["lounge", "Lounge area"],
    ["massage", "Massage"],
    ["mats", "Mats provided"],
    ["mirrored_studio", "Mirrored studio"],
    ["mma_cage", "MMA cage"],
    ["netball_court", "Netball court"],
    ["nutrition_advice", "Nutrition advice"],
    ["open_24_hours", "Open 24 hours"],
    ["osteopathy", "Osteopathy"],
    ["outdoor_pool", "Outdoor pool"],
    ["outdoor_area", "Outdoor training area"],
    ["padel_courts", "Padel courts"],
    ["phone_charging", "Phone charging"],
    ["physiotherapy", "Physiotherapy"],
    ["reformers", "Pilates reformers"],
    ["pilates_equipment", "Pilates towers or Cadillac"],
    ["plate_loaded", "Plate-loaded machines"],
    ["plyo_boxes", "Plyo boxes"],
    ["prayer_room", "Prayer room"],
    ["private_cubicles", "Private changing cubicles"],
    ["calisthenics_rig", "Pull-up or calisthenics rig"],
    ["punch_bags", "Punch bags"],
    ["recovery_area", "Recovery area"],
    ["red_light_therapy", "Red light therapy"],
    ["relaxation_room", "Relaxation room"],
    ["rowing_machines", "Rowing machines"],
    ["running_track", "Running track"],
    ["salt_room", "Salt room"],
    ["ski_ergs", "Ski ergs"],
    ["sled_track", "Sled track or turf"],
    ["small_group_training", "Small group training"],
    ["smith_machine", "Smith machine"],
    ["sports_courts", "Sports courts"],
    ["sports_hall", "Sports hall"],
    ["sports_massage", "Sports massage"],
    ["sprung_floor", "Sprung floor"],
    ["squash_courts", "Squash courts"],
    ["squat_racks", "Squat racks"],
    ["staffed_reception", "Staffed reception"],
    ["steam_room", "Steam room"],
    ["step_free_access", "Step-free access"],
    ["stretching_area", "Stretching area"],
    ["strongman_equipment", "Strongman equipment"],
    ["suspension_trainers", "Suspension trainers"],
    ["swimming_lessons", "Swimming lessons"],
    ["table_tennis", "Table tennis"],
    ["tennis_courts", "Tennis courts"],
    ["toiletries", "Toiletries"],
    ["towel_hire", "Towel hire"],
    ["treadmills", "Treadmills"],
    ["treatment_rooms", "Treatment rooms"],
    ["vending_machines", "Vending machines"],
    ["virtual_classes", "Virtual classes"],
    ["water_slides", "Water slides or flumes"],
    ["women_only_area", "Women-only area"],
    ["women_only_sessions", "Women-only sessions"],
    ["yoga_props", "Yoga props"]
  ];
  var OTHER_PREFIX = "other:"; // an owner's own amenity, stored as other:<their words>
  var OTHER_MAX = 10;
  var DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
    ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
  var STEPS = [["place", "Name and address"], ["business", "Your business"],
    ["facility", "Your facility"], ["amenities", "What you offer"], ["photos", "Photos"]];
  // Facility-type headings, in the order the list shows them (venue_categories.category_group).
  var CATEGORY_GROUPS = ["Fitness", "Mind and body", "Dance and movement", "Combat sports", "Water",
    "Climbing", "Racket and court sports", "Pitches and outdoor sports", "Wellness and recovery"];
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  var state = { session: null, venue: null, photos: [], categories: [], pendingEmail: null };
  var running = false; // synchronous latch: register_venue is limited to 3 an hour

  function $(id) { return document.getElementById(id); }
  function stepEl(name) { return document.querySelector('.br-step[data-step="' + name + '"]'); }

  // ===== Errors =====
  function AppError(status, code, message, details) {
    this.status = status; this.code = code; this.message = message || ""; this.details = details || "";
  }

  var COPY = {
    WGG40: "Some details were not accepted. Check this step and try again.",
    WGG42: "We are not open in that country yet.",
    WGG64: "You need to be 18 or over to register a business.",
    RL001: "Too many attempts in a short time. Wait an hour and try again.",
    WGG21: "This account cannot change that listing. Log out, then log in with the account that created it.",
    "42501": "This account cannot change that listing. Log out, then log in with the account that created it.",
    user_already_exists: "There is already an account with that email. Choose “I already have one” to log in.",
    email_exists: "There is already an account with that email. Choose “I already have one” to log in.",
    invalid_credentials: "That email and password do not match. Check both and try again.",
    invalid_grant: "That email and password do not match. Check both and try again.",
    weak_password: "Choose a longer password, at least 8 characters.",
    over_email_send_rate_limit: "We have sent several emails to that address already. Wait a few minutes, then try again.",
    over_request_rate_limit: "Too many attempts in a short time. Wait a few minutes and try again.",
    otp_expired: "That code is wrong or has expired. Send a new code and try again.",
    validation_failed: "Check the email address and try again.",
    signup_disabled: "We are not taking new accounts on this page yet. Please check back shortly.",
    network: "We could not reach WeGoGym. Check your internet connection and try again.",
    session: "You have been logged out. Log in again to carry on where you left off."
  };

  function messageFor(err) {
    if (err && err.code && COPY[err.code]) return COPY[err.code];
    if (err && (err.status === 413 || err.code === "413")) return "That photo is too large. Try a smaller one.";
    return "That did not save. Try again, and email hello@wegogym.club if it keeps happening.";
  }

  function showAlert(text) { $("br-alert").textContent = text || ""; }
  function announce(text) { $("br-live").textContent = text; }

  // ===== HTTP =====
  async function http(path, opts, retried) {
    opts = opts || {};
    var headers = { apikey: CONFIG.key };
    if (opts.auth !== false) {
      var token = await accessToken(retried);
      headers.Authorization = "Bearer " + token;
    }
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });

    var res;
    try {
      res = await fetch(CONFIG.url + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body
      });
    } catch (e) {
      throw new AppError(0, "network", "network");
    }
    var text = await res.text();
    var data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    // The server says the token is no good before our clock did (clock skew, revoked):
    // get a fresh one once and try again rather than reporting a failed save.
    var expired = res.status === 401 || /jwt expired/i.test(text);
    if (expired && opts.auth !== false && !retried) {
      return http(path, opts, true);
    }
    if (!res.ok) {
      var b = data || {};
      // GoTrue: {error_code, msg} or {error, error_description}; PostgREST: {code, message,
      // details}; Storage: {statusCode, error, message}.
      var code = b.error_code || (typeof b.code === "string" ? b.code : null) || b.error || String(res.status);
      throw new AppError(res.status, code, b.msg || b.message || b.error_description, b.details);
    }
    return data;
  }

  // ===== Session =====
  function saveSession(s) {
    state.session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* private mode: the session lasts as long as the tab */ }
  }

  function fromAuthResponse(d) {
    if (!d || !d.access_token) return null;
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600),
      // Only what the page needs: the browser keeps this until logout, so it does not
      // hold the date of birth or anything else from the account.
      user: d.user ? { id: d.user.id, email: d.user.email,
        user_metadata: { full_name: (d.user.user_metadata || {}).full_name } } : null
    };
  }

  var refreshing = null; // one refresh at a time

  async function accessToken(force) {
    var s = state.session;
    if (!s) throw new AppError(401, "session");
    if (!force && s.expires_at * 1000 - 60000 > Date.now()) return s.access_token;
    // Another tab may already have refreshed. Refresh tokens are single-use, so reusing
    // the old one here would make the server end the session in every tab.
    try {
      var stored = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (stored && stored.refresh_token !== s.refresh_token && stored.expires_at * 1000 - 60000 > Date.now() &&
          stored.user && s.user && stored.user.id === s.user.id) {
        state.session = stored;
        return stored.access_token;
      }
    } catch (e) { /* no storage: carry on with this tab's token */ }
    if (!refreshing) {
      refreshing = (async function () {
        try {
          var d = await http("/auth/v1/token?grant_type=refresh_token",
            { method: "POST", auth: false, json: { refresh_token: s.refresh_token } });
          var next = fromAuthResponse(d);
          if (!next) throw new AppError(401, "session");
          saveSession(next);
          return next.access_token;
        } catch (e) {
          // Only a refused token ends the session; an outage or rate limit does not.
          if (e.status === 400 || e.status === 401 || e.code === "session") {
            endSession();
            throw new AppError(401, "session");
          }
          throw e;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  function endSession() {
    saveSession(null);
    state.venue = null; state.photos = [];
    $("br-signout").hidden = true;
    // A shared computer: nothing the last person typed may carry over to the next account.
    document.querySelectorAll("form").forEach(function (f) { f.reset(); clearErrors(f); });
    $("f-photos").textContent = "";
  }

  // ===== Field errors =====
  function clearErrors(scope) {
    scope.querySelectorAll(".br-field-error").forEach(function (p) { p.remove(); });
    scope.querySelectorAll("[aria-invalid]").forEach(function (el) {
      el.removeAttribute("aria-invalid");
      var d = (el.getAttribute("aria-describedby") || "").split(" ").filter(function (x) { return x && !/-err$/.test(x); });
      if (d.length) el.setAttribute("aria-describedby", d.join(" ")); else el.removeAttribute("aria-describedby");
    });
    showAlert("");
  }

  // `target` is an input, or a fieldset for a group of chips. `focusEl` picks which input
  // in a group is marked, so focus lands on the one that is actually wrong.
  function fieldError(target, text, focusEl) {
    var p = document.createElement("p");
    p.className = "br-field-error";
    p.id = (target.id || "f") + "-err";
    p.textContent = text;
    if (target.tagName === "FIELDSET") {
      target.appendChild(p);
      var first = focusEl || target.querySelector("input");
      if (first) {
        first.setAttribute("aria-invalid", "true");
        var fd = first.getAttribute("aria-describedby");
        first.setAttribute("aria-describedby", (fd ? fd + " " : "") + p.id);
      }
    } else {
      // A checkbox sits inside its label: the message goes after the whole label.
      (target.type === "checkbox" ? target.closest("label") : target).insertAdjacentElement("afterend", p);
      target.setAttribute("aria-invalid", "true");
      var d = target.getAttribute("aria-describedby");
      target.setAttribute("aria-describedby", (d ? d + " " : "") + p.id);
    }
  }

  function focusFirstError(scope) {
    var el = scope.querySelector('[aria-invalid="true"]');
    if (el) el.focus();
  }

  function val(id) { return $(id).value.trim(); }
  function orNull(s) { return s === "" ? null : s; }

  function setBusy(form, on, label) {
    form.querySelectorAll('button[type="submit"]').forEach(function (b) {
      if (on) { b.dataset.label = b.textContent; b.textContent = label || "Saving…"; }
      else if (b.dataset.label) { b.textContent = b.dataset.label; }
      b.disabled = on;
    });
  }

  // One submit handler shape for every form: latch, busy state, error banner.
  function onSubmit(form, label, fn) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (running) return;
      running = true;
      setBusy(form, true, label);
      try { await fn(); }
      catch (err) { handleError(err, form); }
      finally { running = false; setBusy(form, false); }
    });
  }

  function handleError(err, form) {
    if (err && err.code === "session") { showStep("account"); showAlert(COPY.session); return; }
    showAlert(messageFor(err));
    if (form) focusFirstError(form);
  }

  // ===== Step display =====
  function showStep(name) {
    document.querySelectorAll(".br-step").forEach(function (s) { s.hidden = s.dataset.step !== name; });
    var index = STEPS.findIndex(function (s) { return s[0] === name; });
    $("br-progress-wrap").hidden = index < 0;
    if (index >= 0) {
      $("br-progress-bar").style.width = ((index + 1) / STEPS.length * 100) + "%";
      $("br-progress-text").textContent = "Step " + (index + 1) + " of " + STEPS.length + ": " + STEPS[index][1];
    }
    if (name === "place") fillPlace();
    if (name === "business") fillBusiness();
    if (name === "facility") fillFacility();
    if (name === "amenities") fillAmenities();
    if (name === "photos") renderPhotos();
    if (name === "done") {
      $("done-name").textContent = state.venue ? state.venue.name : "";
      $("done-email").textContent = state.venue ? (state.venue.contact_email || "") : "";
      showMarketState();
    }
    var h = stepEl(name).querySelector("h2");
    if (h) h.focus();
  }

  // Whether WeGoGym is open in the venue's country decides what "next" honestly is.
  async function showMarketState() {
    var open = $("done-open"), closed = $("done-closed");
    open.hidden = false; closed.hidden = true;
    if (!state.venue) return;
    try {
      var rows = await http("/rest/v1/rpc/get_venue_terms_state", { method: "POST", json: { p_venue_id: state.venue.id } });
      var r = Array.isArray(rows) ? rows[0] : rows;
      if (r && r.schedule_complete === false) {
        var c = country(state.venue.country);
        $("done-country").textContent = c ? c[1] : "your country";
        open.hidden = true; closed.hidden = false;
      }
    } catch (e) { /* the general wording stays: it is true of every market */ }
  }

  function previous(name) {
    var i = STEPS.findIndex(function (s) { return s[0] === name; });
    return i > 0 ? STEPS[i - 1][0] : name;
  }

  // ===== Account =====
  function selectTab(which) {
    var create = which === "create";
    $("tab-create").setAttribute("aria-selected", String(create));
    $("tab-login").setAttribute("aria-selected", String(!create));
    $("tab-create").tabIndex = create ? 0 : -1;
    $("tab-login").tabIndex = create ? -1 : 0;
    $("panel-create").hidden = !create;
    $("panel-login").hidden = create;
    showAlert("");
  }

  function ageOn(dobIso) {
    var dob = new Date(dobIso + "T00:00:00");
    var now = new Date();
    var age = now.getFullYear() - dob.getFullYear();
    var m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }

  async function signUp() {
    var form = $("panel-create");
    clearErrors(form);
    var name = val("su-name"), email = val("su-email"), pw = $("su-password").value, dob = $("su-dob").value;
    if (!name) fieldError($("su-name"), "Enter your name.");
    if (!EMAIL.test(email)) fieldError($("su-email"), "Enter an email address like name@example.com.");
    if (pw.length < 8) fieldError($("su-password"), "Use at least 8 characters.");
    if ($("su-password2").value !== pw) fieldError($("su-password2"), "The two passwords do not match.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) fieldError($("su-dob"), "Enter your date of birth.");
    else if (ageOn(dob) < 18) fieldError($("su-dob"), "You need to be 18 or over to register a business.");
    else if (ageOn(dob) > 120) fieldError($("su-dob"), "Check the year of your date of birth.");
    if (!$("su-terms").checked) fieldError($("su-terms"), "Tick this to continue.");
    if (form.querySelector(".br-field-error")) { focusFirstError(form); return; }

    // The profile is created by a database trigger, so name and date of birth travel as
    // sign-up metadata (migration 0034 refuses an email sign-up without a date of birth).
    var d = await http("/auth/v1/signup?redirect_to=" + encodeURIComponent(CONFIG.redirect), {
      method: "POST", auth: false,
      json: { email: email, password: pw, data: {
        full_name: name, date_of_birth: dob,
        // What was agreed and when. Recorded on the account, since the tick itself
        // otherwise never leaves this page.
        business_signup_confirmed_at: new Date().toISOString(),
        business_signup_source: "wegogym.club/business-register"
      } }
    });
    $("su-password").value = ""; $("su-password2").value = "";
    var s = fromAuthResponse(d);
    if (s) { saveSession(s); await afterLogin(); return; }
    // No session: the project asks new accounts to confirm their email first.
    state.pendingEmail = email;
    $("cf-email").textContent = email;
    showStep("confirm");
  }

  async function logIn() {
    var form = $("panel-login");
    clearErrors(form);
    var email = val("li-email"), pw = $("li-password").value;
    if (!EMAIL.test(email)) fieldError($("li-email"), "Enter the email address you registered with.");
    if (!pw) fieldError($("li-password"), "Enter your password.");
    if (form.querySelector(".br-field-error")) { focusFirstError(form); return; }
    try {
      var d = await http("/auth/v1/token?grant_type=password",
        { method: "POST", auth: false, json: { email: email, password: pw } });
      $("li-password").value = "";
      saveSession(fromAuthResponse(d));
      await afterLogin();
    } catch (err) {
      if (err.code === "email_not_confirmed") {
        state.pendingEmail = email;
        $("cf-email").textContent = email;
        showStep("confirm");
        showAlert("Confirm your email first. Choose “Send a new code” if you cannot find the email.");
        return;
      }
      throw err;
    }
  }

  async function confirmCode() {
    var form = $("cf-form");
    clearErrors(form);
    var code = val("cf-code").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) { fieldError($("cf-code"), "Enter the 6 numbers from the email."); focusFirstError(form); return; }
    var d = await http("/auth/v1/verify", {
      method: "POST", auth: false, json: { type: "email", email: state.pendingEmail, token: code }
    });
    var s = fromAuthResponse(d);
    if (!s) throw new AppError(400, "otp_expired");
    saveSession(s);
    await afterLogin();
  }

  async function resendCode() {
    var b = $("cf-resend");
    if (b.disabled) return;
    b.disabled = true;
    try {
      await http("/auth/v1/resend?redirect_to=" + encodeURIComponent(CONFIG.redirect), { method: "POST", auth: false, json: { type: "signup", email: state.pendingEmail } });
      showAlert("");
      announce("A new code is on its way.");
      $("cf-resend").textContent = "Sent. Check your inbox";
      setTimeout(function () { b.disabled = false; b.textContent = "Send a new code"; }, 60000);
    } catch (err) {
      b.disabled = false;
      handleError(err);
    }
  }

  async function signOut() {
    var token = state.session && state.session.access_token;
    endSession();
    if (token) {
      // Local scope: logging out here must not log the owner out of the app on their phone.
      fetch(CONFIG.url + "/auth/v1/logout?scope=local", {
        method: "POST", headers: { apikey: CONFIG.key, Authorization: "Bearer " + token }
      }).catch(function () {});
    }
    selectTab("login");
    showStep("account");
    announce("Logged out.");
  }

  // ===== Loading the owner's listing =====
  function uid() { return state.session.user.id; }

  async function afterLogin() {
    $("br-signout").hidden = false;
    showAlert("");
    var members = await http("/rest/v1/venue_members?select=venue_id&profile_id=eq." + uid());
    var venues = [];
    if (members.length) {
      var ids = members.map(function (m) { return m.venue_id; }).join(",");
      venues = await http("/rest/v1/venues?select=" + VENUE_COLS + "&id=in.(" + ids + ")");
    }
    var draft = venues.find(function (v) { return v.status === "draft" || v.status === "changes_requested"; });
    if (!draft && venues.length) {
      $("sub-text").textContent = venues[0].status === "pending"
        ? venues[0].name + " has been sent for review, so it can no longer be changed on this page."
        : venues[0].name + " already has a listing with us, so it cannot be changed on this page.";
      showStep("submitted");
      return;
    }
    state.venue = draft || null;
    await Promise.all([loadCategories(), state.venue ? loadPhotos() : Promise.resolve()]);
    showStep(resumeStep());
  }

  function resumeStep() {
    var v = state.venue;
    if (!v || !v.name || !v.address_line1 || !v.city || !v.postcode || (REGIONS[v.country] && !v.region)) return "place";
    if (!v.legal_name || !v.contact_email) return "business";
    if (!v.category_slug || !v.description || (v.category_slug === "other" && !v.category_other)) return "facility";
    if (!state.photos.length) return "amenities";
    return "done";
  }

  async function loadCategories() {
    if (state.categories.length) return;
    state.categories = await http("/rest/v1/venue_categories?select=slug,name,category_group&order=name.asc");
  }

  async function loadPhotos() {
    // A photo an admin took down is "rejected" and its file is gone: it does not count.
    state.photos = await http("/rest/v1/venue_photos?select=id,storage_path,is_cover,position&venue_id=eq." +
      state.venue.id + "&status=neq.rejected&order=position.asc.nullslast,created_at.asc");
  }

  // PATCH the draft and take the values from the row the server returns.
  async function patchVenue(patch) {
    var rows = await http("/rest/v1/venues?id=eq." + state.venue.id + "&select=" + VENUE_COLS, {
      method: "PATCH", json: patch, headers: { Prefer: "return=representation" }
    });
    // An empty answer means no row was changed (the database's rules filtered it out),
    // which is a failure even though the request itself succeeded.
    if (!rows || !rows.length) throw new AppError(403, "42501");
    state.venue = rows[0];
  }

  // ===== Step 1: name and address =====
  function slugify(name) {
    return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  }

  function country(code) { return COUNTRIES.find(function (c) { return c[0] === code; }); }

  function option(value, label, selected) {
    var o = document.createElement("option");
    o.value = value; o.textContent = label; o.selected = !!selected;
    return o;
  }

  // The time zone is never asked: it follows from where the facility is.
  function timezoneFor(code, region) {
    var r = REGIONS[code];
    if (r && r.zones[region]) return r.zones[region];
    var c = country(code);
    return c ? c[3] : null;
  }

  // The region box adapts to the country: a list of states or provinces where the time
  // zone depends on it, a free box (optional) everywhere else.
  function renderRegion(code, value) {
    var r = REGIONS[code];
    var input = $("f-region"), select = $("f-region-select");
    input.hidden = !!r; select.hidden = !r;
    $("f-region-label").htmlFor = r ? "f-region-select" : "f-region";
    $("f-region-label").innerHTML = r ? "" : 'County or region <span class="wl-optional">(optional)</span>';
    if (r) {
      $("f-region-label").textContent = r.label;
      select.textContent = "";
      select.appendChild(option("", "Choose…", !value));
      Object.keys(r.zones).forEach(function (name) { select.appendChild(option(name, name, name === value)); });
    } else {
      input.value = value || "";
    }
    $("f-postcode-label").textContent = code === "US" ? "ZIP code" : "Postcode";
  }

  function randomTag() { return Math.random().toString(36).slice(2, 8); }

  // The listing's web address is made from the name. A name with no A to Z letters or
  // numbers (Москва Фитнес, 健身房) falls back to the city, then to a random one; a name
  // someone else already uses gets the city added, then a random tag. The public name
  // the owner typed is never changed.
  async function registerDraft(name, city, code, currency, timezone) {
    var base = slugify(name) || slugify(city) || "venue";
    var tries = slugify(name) ? [base, slugify(name + " " + city), base + "-" + randomTag()] : [base + "-" + randomTag()];
    tries = tries.filter(function (s, i) { return s && tries.indexOf(s) === i; });
    for (var i = 0; i < tries.length; i++) {
      try {
        var res = await http("/rest/v1/rpc/register_venue", {
          method: "POST",
          json: { p_name: name, p_slug: tries[i].slice(0, 80).replace(/-+$/, ""), p_country: code, p_currency: currency, p_timezone: timezone }
        });
        var row = Array.isArray(res) ? res[0] : res;
        if (!row || !row.venue_id) throw new AppError(500, "unknown");
        return row.venue_id;
      } catch (err) {
        if (err.code !== "WGG41" || i === tries.length - 1) throw err;
      }
    }
  }

  function regionValue(code) { return REGIONS[code] ? $("f-region-select").value : val("f-region"); }

  function fillPlace() {
    var v = state.venue || {};
    $("f-name").value = v.name || "";
    var sel = $("f-country");
    sel.textContent = "";
    sel.appendChild(option("", "Choose a country…", !v.country));
    COUNTRIES.slice().sort(function (a, b) { return a[1].localeCompare(b[1], "en-GB"); })
      .forEach(function (c) { sel.appendChild(option(c[0], c[1], c[0] === v.country)); });
    // The country fixes the currency, so it is locked once the draft exists.
    sel.disabled = !!v.id;
    $("f-country-hint").hidden = !v.id;
    if (v.id) sel.setAttribute("aria-describedby", "f-country-hint"); else sel.removeAttribute("aria-describedby");
    $("f-addr1").value = v.address_line1 || "";
    $("f-addr2").value = v.address_line2 || "";
    $("f-city").value = v.city || "";
    $("f-postcode").value = v.postcode || "";
    renderRegion(v.country || "", v.region);
  }

  async function savePlace() {
    var form = stepEl("place");
    clearErrors(form);
    var v = state.venue;
    var name = val("f-name");
    var code = v ? v.country : $("f-country").value;
    var c = country(code);
    var region = orNull(regionValue(code));
    var a1 = val("f-addr1"), a2 = orNull(val("f-addr2")), city = val("f-city"), pc = val("f-postcode");

    if (!name) fieldError($("f-name"), "Enter the name of your facility.");
    if (!c) fieldError($("f-country"), "Choose the country your facility is in.");
    if (!a1) fieldError($("f-addr1"), "Enter the street address.");
    if (!city) fieldError($("f-city"), "Enter the town or city.");
    if (c && REGIONS[code] && !region) fieldError($("f-region-select"), "Choose the " + REGIONS[code].label.toLowerCase() + ".");
    if (!pc) fieldError($("f-postcode"), code === "US" ? "Enter the ZIP code." : "Enter the postcode, or write “none”.");
    if (form.querySelector(".br-field-error")) { focusFirstError(form); return; }

    var timezone = timezoneFor(code, region);
    if (!v) {
      state.venue = v = { id: await registerDraft(name, city, code, c[2], timezone), country: code };
    }
    var patch = { name: name, address_line1: a1, address_line2: a2, city: city, region: region, postcode: pc };
    // The time zone is only (re)derived when it could have changed: on the first save,
    // or when a state or province changes. Otherwise a correction made by an admin stays.
    if (!v.timezone || region !== v.region) patch.timezone = timezone;
    // A map pin belongs to the address that produced it: a changed address drops it,
    // so members are never shown the gym somewhere it is not.
    if (a1 !== v.address_line1 || a2 !== v.address_line2 || city !== v.city || pc !== v.postcode || region !== v.region) {
      patch.lat = null; patch.lng = null;
    }
    // If this save fails after the draft was created, pressing the button again only
    // repeats this save: state.venue now holds the id.
    await patchVenue(patch);
    announce("Saved.");
    showStep("business");
  }

  // ===== Step 2: business =====
  function fillBusiness() {
    var v = state.venue;
    var user = state.session.user || {};
    var meta = user.user_metadata || {};
    $("f-legal").value = v.legal_name || "";
    $("f-company").value = v.company_number || "";
    // Until they are saved once, the contact details default to this account's own.
    $("f-contact").value = v.contact_email ? v.contact_name || "" : meta.full_name || "";
    $("f-cemail").value = v.contact_email || user.email || "";
    $("f-phone").value = v.contact_phone || "";
  }

  async function saveBusiness() {
    var form = stepEl("business");
    clearErrors(form);
    var legal = val("f-legal"), email = val("f-cemail");
    if (!legal) fieldError($("f-legal"), "Enter the registered business name, as on your paperwork.");
    if (!EMAIL.test(email)) fieldError($("f-cemail"), "Enter an email address we can reach you on.");
    if (form.querySelector(".br-field-error")) { focusFirstError(form); return; }
    await patchVenue({
      legal_name: legal, company_number: orNull(val("f-company")),
      contact_name: orNull(val("f-contact")), contact_email: email, contact_phone: orNull(val("f-phone"))
    });
    await loadCategories();
    announce("Saved.");
    showStep("facility");
  }

  // ===== Step 3: facility =====
  function renderCategories(selected) {
    var sel = $("f-category");
    sel.textContent = "";
    sel.appendChild(option("", "Choose…", !selected));
    var groups = {};
    state.categories.forEach(function (c) {
      if (c.slug === "other") return;
      var g = c.category_group || "More";
      (groups[g] = groups[g] || []).push(c);
    });
    var order = CATEGORY_GROUPS.filter(function (g) { return groups[g]; })
      .concat(Object.keys(groups).filter(function (g) { return CATEGORY_GROUPS.indexOf(g) < 0; }).sort());
    order.forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g;
      groups[g].sort(function (a, b) { return a.name.localeCompare(b.name, "en-GB"); })
        .forEach(function (c) { og.appendChild(option(c.slug, c.name, c.slug === selected)); });
      sel.appendChild(og);
    });
    if (state.categories.some(function (c) { return c.slug === "other"; })) {
      sel.appendChild(option("other", "Other (tell us what it is)", selected === "other"));
    }
    $("f-cat-other-wrap").hidden = sel.value !== "other";
  }

  function fillFacility() {
    var v = state.venue;
    renderCategories(v.category_slug);
    $("f-cat-other").value = v.category_other || "";
    $("f-desc").value = v.description || "";

    var hours = $("f-hours");
    hours.textContent = "";
    DAYS.forEach(function (d) {
      var parts = ((v.opening_hours || {})[d[0]] || "").split("-");
      var row = document.createElement("div");
      row.className = "br-day";
      row.innerHTML = '<span></span><input type="time"><span class="br-to">to</span><input type="time">';
      row.children[0].textContent = d[1];
      row.children[0].id = "hours-" + d[0];
      var open = row.children[1], close = row.children[3];
      open.id = "hours-" + d[0] + "-open"; close.id = "hours-" + d[0] + "-close";
      open.setAttribute("aria-label", d[1] + " opens");
      close.setAttribute("aria-label", d[1] + " closes");
      open.value = HHMM.test(parts[0] || "") ? parts[0] : "";
      close.value = HHMM.test(parts[1] || "") ? parts[1] : "";
      hours.appendChild(row);
    });
  }

  function readHours() {
    var result = {}, bad = null, badEl = null;
    DAYS.forEach(function (d) {
      var oe = $("hours-" + d[0] + "-open"), ce = $("hours-" + d[0] + "-close");
      var o = oe.value, c = ce.value;
      if (!o && !c) return;
      if (!HHMM.test(o) || !HHMM.test(c)) {
        if (!bad) { bad = d[1]; badEl = HHMM.test(o) ? ce : oe; }
        return;
      }
      result[d[0]] = o + "-" + c;
    });
    return { hours: result, bad: bad, badEl: badEl };
  }

  async function saveFacility() {
    var form = stepEl("facility");
    clearErrors(form);
    var category = $("f-category").value;
    var other = val("f-cat-other");
    var desc = val("f-desc");
    if (!category) fieldError($("f-category"), "Choose the kind of place this is.");
    else if (category === "other" && other.length < 2) fieldError($("f-cat-other"), "Tell us what kind of place it is, for example “Ninja warrior gym”.");
    if (!desc) fieldError($("f-desc"), "Write a few sentences about training there.");
    var h = readHours();
    if (h.bad) fieldError($("f-hours-group"), "Add both an opening and a closing time for " + h.bad + ", or leave both empty if you are closed.", h.badEl);
    if (form.querySelector(".br-field-error")) { focusFirstError(form); return; }

    await patchVenue({
      category_slug: category, category_other: category === "other" ? other : null,
      description: desc, opening_hours: h.hours
    });
    announce("Saved.");
    showStep("amenities");
  }

  // ===== Step 3: amenities =====
  // A compact checklist. Collapsed, it shows the most common amenities plus anything
  // already ticked; "Show all" opens the full list, and the search box looks across all.
  var amenExpanded = false;

  function amenRow(value, label, checked, common) {
    var li = document.createElement("li");
    li.dataset.label = label.toLowerCase();
    if (common) li.dataset.common = "1";
    var l = document.createElement("label");
    var i = document.createElement("input");
    i.type = "checkbox"; i.name = "amenity"; i.value = value; i.checked = !!checked;
    var s = document.createElement("span");
    s.textContent = label;
    l.appendChild(i); l.appendChild(s); li.appendChild(l);
    return li;
  }

  function amenSep(text, key) {
    var li = document.createElement("li");
    li.className = "br-amen-sep"; li.dataset.sep = key; li.setAttribute("aria-hidden", "true");
    li.textContent = text;
    return li;
  }

  function fillAmenities() {
    var have = state.venue.amenities || [];
    var box = $("f-amenities");
    box.textContent = "";
    amenExpanded = false;
    $("f-amen-search").value = "";
    $("f-other").value = "";
    $("f-other-row").hidden = true;
    $("f-other-open").setAttribute("aria-expanded", "false");
    box.appendChild(amenSep("Most common", "common"));
    AMENITIES.filter(function (a) { return a[2]; }).forEach(function (a) {
      box.appendChild(amenRow(a[0], a[1], have.indexOf(a[0]) >= 0, true));
    });
    box.appendChild(amenSep("Your own", "own"));
    have.filter(function (s) { return s.indexOf(OTHER_PREFIX) === 0; }).forEach(function (s) {
      box.appendChild(amenRow(s, s.slice(OTHER_PREFIX.length), true, true));
    });
    box.appendChild(amenSep("Everything else, A to Z", "rest"));
    AMENITIES.filter(function (a) { return !a[2]; }).forEach(function (a) {
      box.appendChild(amenRow(a[0], a[1], have.indexOf(a[0]) >= 0, false));
    });
    updateAmenities();
  }

  function updateAmenities() {
    var q = $("f-amen-search").value.trim().toLowerCase();
    var shown = { common: 0, own: 0, rest: 0 }, group = "common", any = 0;
    $("f-amenities").querySelectorAll("li").forEach(function (li) {
      if (li.dataset.sep) { group = li.dataset.sep; return; }
      var checked = li.querySelector("input").checked;
      var visible = q ? li.dataset.label.indexOf(q) >= 0
        : amenExpanded || li.dataset.common === "1" || checked;
      li.hidden = !visible;
      if (visible) { shown[group]++; any++; }
    });
    $("f-amenities").querySelectorAll(".br-amen-sep").forEach(function (li) { li.hidden = !shown[li.dataset.sep]; });
    $("f-amen-empty").hidden = !(q && !any);
    countAmenities();
    var toggle = $("f-amen-toggle");
    toggle.hidden = !!q;
    toggle.textContent = amenExpanded ? "Show fewer" : "Show all " + AMENITIES.length + " amenities";
    toggle.setAttribute("aria-expanded", String(amenExpanded));
  }

  // Only the count changes on a tick: hiding a row the owner just unticked would make
  // it vanish under their finger.
  function countAmenities() {
    var ticked = $("f-amenities").querySelectorAll("input:checked").length;
    $("f-amen-count").textContent = ticked === 1 ? "1 selected" : ticked + " selected";
  }

  function addOther() {
    var input = $("f-other");
    var group = $("f-amen-group");
    group.querySelectorAll(".br-field-error").forEach(function (p) { p.remove(); });
    input.removeAttribute("aria-invalid");
    var text = input.value.replace(/\s+/g, " ").trim();
    if (text.length < 2) { fieldError(input, "Type what it is, for example “Golf simulator”."); input.focus(); return; }
    var lower = text.toLowerCase();
    // Already on the list: tick that one rather than adding a copy in the owner's words.
    var same = Array.prototype.find.call($("f-amenities").querySelectorAll("li:not(.br-amen-sep)"),
      function (li) { return li.dataset.label === lower; });
    if (same) {
      same.querySelector("input").checked = true;
      input.value = "";
      updateAmenities();
      announce(same.textContent.trim() + " is on the list and is now ticked.");
      return;
    }
    if ($("f-amenities").querySelectorAll('input[value^="' + OTHER_PREFIX + '"]').length >= OTHER_MAX) {
      fieldError(input, "You can add up to " + OTHER_MAX + " of your own. Remove one to add another.");
      input.focus();
      return;
    }
    var row = amenRow(OTHER_PREFIX + text, text, true, true);
    var rest = $("f-amenities").querySelector('[data-sep="rest"]');
    $("f-amenities").insertBefore(row, rest);
    input.value = "";
    updateAmenities();
    announce(text + " added.");
    input.focus();
  }

  async function saveAmenities() {
    var known = AMENITIES.map(function (a) { return a[0]; });
    // Keep any amenity this page cannot show, rather than silently deleting it. The
    // owner's own ("other:") ones are on screen, so the boxes decide those.
    var kept = (state.venue.amenities || []).filter(function (s) {
      return known.indexOf(s) < 0 && s.indexOf(OTHER_PREFIX) !== 0;
    });
    var ticked = Array.prototype.map.call(document.querySelectorAll('input[name="amenity"]:checked'), function (i) { return i.value; });
    await patchVenue({ amenities: kept.concat(ticked) });
    announce("Saved.");
    showStep("photos");
  }

  // ===== Step 4: photos =====
  function publicUrl(path) {
    return CONFIG.url + "/storage/v1/object/public/venue-photos/" + path.split("/").map(encodeURIComponent).join("/");
  }

  function renderPhotos() {
    var list = $("f-photos");
    list.textContent = "";
    state.photos.forEach(function (p, i) {
      var li = document.createElement("li");
      li.className = "br-photo" + (p.is_cover ? " is-cover" : "");
      var img = document.createElement("img");
      img.src = publicUrl(p.storage_path);
      img.alt = p.is_cover ? "Photo " + (i + 1) + ", cover" : "Photo " + (i + 1);
      img.loading = "lazy";
      var bar = document.createElement("div");
      bar.className = "br-photo-bar";
      var badge = document.createElement("span");
      badge.className = "br-badge";
      badge.textContent = p.is_cover ? "Cover" : "";
      bar.appendChild(badge);
      if (!p.is_cover) bar.appendChild(photoButton("Make cover", "Make photo " + (i + 1) + " the cover", function () { return setCover(p.id); }));
      bar.appendChild(photoButton("Remove", "Remove photo " + (i + 1), function () { return removePhoto(p); }));
      li.appendChild(img); li.appendChild(bar);
      list.appendChild(li);
    });
  }

  function photoButton(text, label, action) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = text; b.setAttribute("aria-label", label);
    b.addEventListener("click", async function () {
      if (running) return;
      running = true; b.disabled = true; showAlert("");
      try {
        await action(); renderPhotos();
        // The button pressed no longer exists: keep keyboard users in the same place.
        var label = document.querySelector('label[for="f-photo-input"]');
        $("f-photo-input").focus();
        if (document.activeElement !== $("f-photo-input") && label) label.focus();
      }
      catch (err) { b.disabled = false; handleError(err); }
      finally { running = false; }
    });
    return b;
  }

  // Every photo is redrawn and saved fresh. That shrinks phone photos under the 5 MB
  // limit and, just as important, drops hidden details such as where it was taken,
  // because the photo bucket is public.
  async function preparePhoto(file) {
    if (PHOTO_TYPES.indexOf(file.type) < 0) throw new AppError(400, "type");
    var bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { throw new AppError(400, "unreadable"); }
    var long = Math.max(bitmap.width, bitmap.height);
    var scale = Math.min(1, PHOTO_LONG_EDGE / long);
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // a transparent PNG would otherwise turn black as a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close && bitmap.close();
    for (var q = 0.85; q >= 0.55; q -= 0.15) {
      var blob = await new Promise(function (r) { canvas.toBlob(r, "image/jpeg", q); });
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    throw new AppError(413, "413");
  }

  async function addPhotos(files) {
    var status = $("f-photo-status");
    var failed = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      status.textContent = "Uploading " + (i + 1) + " of " + files.length + "…";
      try {
        var blob = await preparePhoto(file);
        var ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[blob.type] || "jpg";
        // First folder must be the venue id: the storage rules check membership of it.
        var path = state.venue.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
        await http("/storage/v1/object/venue-photos/" + path, {
          method: "POST", body: blob, headers: { "Content-Type": blob.type, "x-upsert": "false" }
        });
        // The row goes in second: an unused file in storage is invisible, a row
        // pointing at nothing is a broken image.
        // Older photos may have no position: count them by their place in the list.
        var position = state.photos.reduce(function (m, p, i) { return Math.max(m, p.position || 0, i + 1); }, 0) + 1;
        var rows = await http("/rest/v1/venue_photos?select=id,storage_path,is_cover,position", {
          method: "POST", json: { venue_id: state.venue.id, storage_path: path, position: position },
          headers: { Prefer: "return=representation" }
        });
        state.photos.push(rows[0]);
        if (!state.photos.some(function (p) { return p.is_cover; })) await setCover(rows[0].id);
        renderPhotos();
      } catch (err) {
        if (err.code === "session" || err.code === "network") { status.textContent = ""; throw err; }
        failed.push(file.name + ": " + (err.code === "type" ? "not a JPEG, PNG or WebP photo"
          : err.code === "unreadable" ? "this browser could not open it"
          : err.code === "413" || err.status === 413 ? "too large even after shrinking" : "did not upload"));
      }
    }
    status.textContent = "";
    if (failed.length) showAlert("Some photos were not added. " + failed.join(". ") + ".");
    else announce(files.length === 1 ? "Photo added." : files.length + " photos added.");
  }

  // Exactly one cover: clear the old one first, so a failure in between leaves none, not two.
  async function setCover(photoId) {
    await http("/rest/v1/venue_photos?venue_id=eq." + state.venue.id + "&is_cover=eq.true",
      { method: "PATCH", json: { is_cover: false } });
    var rows = await http("/rest/v1/venue_photos?id=eq." + photoId + "&select=id",
      { method: "PATCH", json: { is_cover: true }, headers: { Prefer: "return=representation" } });
    if (!rows || !rows.length) throw new AppError(403, "42501");
    state.photos.forEach(function (p) { p.is_cover = p.id === photoId; });
    announce("Cover photo changed.");
  }

  async function removePhoto(photo) {
    var rows = await http("/rest/v1/venue_photos?id=eq." + photo.id + "&select=id",
      { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (!rows || !rows.length) throw new AppError(403, "42501");
    state.photos = state.photos.filter(function (p) { return p.id !== photo.id; });
    // The listing no longer shows it; tidying the file is best effort.
    http("/storage/v1/object/venue-photos", { method: "DELETE", json: { prefixes: [photo.storage_path] } }).catch(function () {});
    if (photo.is_cover && state.photos.length) await setCover(state.photos[0].id);
    announce("Photo removed.");
  }

  async function finishPhotos() {
    var form = stepEl("photos");
    clearErrors(form);
    if (!state.photos.length) {
      showAlert("Add at least one photo so people can see the place.");
      $("f-photo-input").focus();
      return;
    }
    showStep("done");
  }

  // ===== Wiring =====
  // A confirmation link lands here with a session in the address. It is deliberately NOT
  // used: anyone can craft such a link to sign a visitor into the sender's account, and
  // the visitor's business details would then go into the sender's draft. Clicking the
  // link has already confirmed the email, so logging in is all that is left.
  function readHashLink() {
    if (!location.hash || location.hash.length < 2) return false;
    var p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("error_description")) {
      showAlert(p.get("error_code") === "otp_expired"
        ? "That email link has expired. Log in, and we will send you a new code."
        : "That email link did not work. Log in to carry on.");
      return true;
    }
    if (p.get("access_token")) {
      selectTab("login");
      announce("Your email is confirmed. Log in to carry on.");
      showAlert("");
      $("li-email").setAttribute("aria-describedby", "br-confirmed");
      var note = document.createElement("p");
      note.id = "br-confirmed"; note.className = "wl-hint br-hint-top";
      note.textContent = "Your email is confirmed. Log in to carry on.";
      $("panel-login").prepend(note);
      return true;
    }
    return false;
  }

  async function start() {
    // Refuse to run inside another site's frame (a meta CSP cannot forbid framing).
    if (window.top !== window.self) { showStep("offline"); return; }
    if (/PASTE_/.test(CONFIG.key)) { showStep("offline"); return; }

    $("tab-create").addEventListener("click", function () { selectTab("create"); });
    $("tab-login").addEventListener("click", function () { selectTab("login"); });
    document.querySelector(".br-tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var toLogin = $("tab-create").getAttribute("aria-selected") === "true";
      selectTab(toLogin ? "login" : "create");
      $(toLogin ? "tab-login" : "tab-create").focus();
    });
    onSubmit($("panel-create"), "Creating…", signUp);
    onSubmit($("panel-login"), "Logging in…", logIn);
    onSubmit($("cf-form"), "Checking…", confirmCode);
    $("cf-resend").addEventListener("click", resendCode);
    $("cf-back").addEventListener("click", function () { selectTab("create"); showStep("account"); });
    $("br-signout").addEventListener("click", signOut);

    onSubmit(stepEl("place"), null, savePlace);
    onSubmit(stepEl("business"), null, saveBusiness);
    onSubmit(stepEl("facility"), null, saveFacility);
    onSubmit(stepEl("amenities"), null, saveAmenities);
    onSubmit(stepEl("photos"), null, finishPhotos);
    document.querySelectorAll("[data-back]").forEach(function (b) {
      b.addEventListener("click", function () { showAlert(""); showStep(previous(b.closest(".br-step").dataset.step)); });
    });
    document.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { showStep(b.dataset.goto); });
    });
    $("f-country").addEventListener("change", function () { renderRegion($("f-country").value, null); });
    $("f-category").addEventListener("change", function () {
      $("f-cat-other-wrap").hidden = $("f-category").value !== "other";
      if ($("f-category").value === "other") $("f-cat-other").focus();
    });
    $("f-hours-copy").addEventListener("click", function () {
      var o = $("hours-mon-open").value, c = $("hours-mon-close").value;
      DAYS.forEach(function (d) { $("hours-" + d[0] + "-open").value = o; $("hours-" + d[0] + "-close").value = c; });
      announce("Monday's hours copied to every day.");
    });
    $("f-amen-search").addEventListener("input", updateAmenities);
    $("f-amen-search").addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
    $("f-amenities").addEventListener("change", countAmenities);
    $("f-amen-toggle").addEventListener("click", function () {
      amenExpanded = !amenExpanded;
      updateAmenities();
    });
    $("f-other-open").addEventListener("click", function () {
      var row = $("f-other-row");
      row.hidden = !row.hidden;
      $("f-other-open").setAttribute("aria-expanded", String(!row.hidden));
      if (!row.hidden) $("f-other").focus();
    });
    $("f-other-add").addEventListener("click", addOther);
    $("f-other").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addOther(); } });
    $("f-photo-input").addEventListener("change", async function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = "";
      if (!files.length) return;
      if (running) { showAlert("Wait for the last change to finish, then add those photos again."); return; }
      running = true; showAlert("");
      try { await addPhotos(files); }
      catch (err) { handleError(err); }
      finally { running = false; }
    });

    if (readHashLink()) { saveSession(null); showStep("account"); return; }
    try { state.session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { state.session = null; }
    if (!state.session) { showStep("account"); return; }
    try {
      if (!state.session.user) {
        var u = await http("/auth/v1/user");
        state.session.user = { id: u.id, email: u.email, user_metadata: { full_name: (u.user_metadata || {}).full_name } };
        saveSession(state.session);
      }
      await afterLogin();
    } catch (err) {
      showStep("account");
      if (err.code === "session") showAlert(COPY.session); else handleError(err);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
