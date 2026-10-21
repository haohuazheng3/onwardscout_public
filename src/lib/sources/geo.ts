/*
 * Location reading for ingested opportunities (job boards and curated programs).
 *
 * Job boards describe places as free text: "New York, NY; San Mateo, CA", "Remote - US",
 * "Bangalore, India", "Hybrid (London)", "Remote (EMEA)", "Toronto, ON", "上海". This module
 * turns that into the `opportunities.geo` shape — ISO country codes, city names, a remote mode
 * and a worldwide flag — and is deliberately conservative: when a string cannot be read, the
 * field stays empty (unknown) instead of being guessed.
 *
 * Pure data + functions (no I/O); tested in tests/sources-geo.test.ts.
 */
import type { OpportunityGeo, RemoteMode } from "@/lib/core/types";

/* ------------------------------------------------------------------ countries */

/**
 * ISO 3166-1 alpha-2 codes with their English short name first, then common aliases.
 * `|` separates countries, `,` separates names. Lower-cased when indexed.
 */
const COUNTRY_DATA =
  "AD Andorra|AE United Arab Emirates,UAE,U.A.E.,Emirates,阿联酋|AF Afghanistan|AG Antigua and Barbuda|AI Anguilla|AL Albania|AM Armenia|AO Angola|" +
  "AQ Antarctica|AR Argentina,阿根廷|AS American Samoa|AT Austria,Österreich,Oesterreich,奥地利|AU Australia,澳大利亚,澳洲|AW Aruba|AX Aland Islands|" +
  "AZ Azerbaijan|BA Bosnia and Herzegovina,Bosnia|BB Barbados|BD Bangladesh,孟加拉国|BE Belgium,Belgique,België,比利时|BF Burkina Faso|BG Bulgaria|" +
  "BH Bahrain|BI Burundi|BJ Benin|BL Saint Barthelemy|BM Bermuda|BN Brunei,Brunei Darussalam|BO Bolivia|BQ Caribbean Netherlands|BR Brazil,Brasil,巴西|" +
  "BS Bahamas|BT Bhutan|BW Botswana|BY Belarus|BZ Belize|CA Canada,加拿大|CD Democratic Republic of the Congo,DR Congo,DRC|CF Central African Republic|" +
  "CG Republic of the Congo,Congo|CH Switzerland,Schweiz,Suisse,Svizzera,瑞士|CI Ivory Coast,Côte d'Ivoire,Cote d'Ivoire,Côte d’Ivoire|CK Cook Islands|" +
  "CL Chile,智利|CM Cameroon|CN China,Mainland China,PRC,People's Republic of China,P.R. China,中国,中国大陆,中华人民共和国|CO Colombia,哥伦比亚|" +
  "CR Costa Rica|CU Cuba|CV Cape Verde,Cabo Verde|CW Curacao,Curaçao|CY Cyprus|CZ Czechia,Czech Republic,捷克|DE Germany,Deutschland,德国|DJ Djibouti|" +
  "DK Denmark,Danmark,丹麦|DM Dominica|DO Dominican Republic|DZ Algeria|EC Ecuador|EE Estonia,爱沙尼亚|EG Egypt,埃及|EH Western Sahara|ER Eritrea|" +
  "ES Spain,España,Espana,西班牙|ET Ethiopia|FI Finland,Suomi,芬兰|FJ Fiji|FK Falkland Islands|FM Micronesia|FO Faroe Islands|FR France,法国|GA Gabon|" +
  "GB United Kingdom,UK,U.K.,Great Britain,Britain,England,Scotland,Wales,Northern Ireland,英国|GD Grenada|GE Georgia (country)|GF French Guiana|" +
  "GG Guernsey|GH Ghana|GI Gibraltar|GL Greenland|GM Gambia|GN Guinea|GP Guadeloupe|GQ Equatorial Guinea|GR Greece,希腊|GT Guatemala|GU Guam|" +
  "GW Guinea-Bissau|GY Guyana|HK Hong Kong,Hong Kong SAR,Hong Kong SAR China,HKSAR,香港,中国香港|HN Honduras|HR Croatia,Hrvatska|HT Haiti|" +
  "HU Hungary,Magyarország,匈牙利|ID Indonesia,印度尼西亚,印尼|IE Ireland,Éire,爱尔兰|IL Israel,以色列|IM Isle of Man|IN India,印度|IQ Iraq|IR Iran|" +
  "IS Iceland|IT Italy,Italia,意大利|JE Jersey|JM Jamaica|JO Jordan|JP Japan,日本|KE Kenya,肯尼亚|KG Kyrgyzstan|KH Cambodia|KI Kiribati|KM Comoros|" +
  "KN Saint Kitts and Nevis|KP North Korea|KR South Korea,Korea,Republic of Korea,Korea (South),韩国|KW Kuwait|KY Cayman Islands|KZ Kazakhstan|LA Laos|" +
  "LB Lebanon|LC Saint Lucia|LI Liechtenstein|LK Sri Lanka|LR Liberia|LS Lesotho|LT Lithuania,Lietuva|LU Luxembourg,卢森堡|LV Latvia|LY Libya|" +
  "MA Morocco,Maroc,摩洛哥|MC Monaco|MD Moldova|ME Montenegro|MF Saint Martin|MG Madagascar|MH Marshall Islands|MK North Macedonia,Macedonia|ML Mali|" +
  "MM Myanmar,Burma|MN Mongolia|MO Macau,Macao,Macau SAR,澳门|MP Northern Mariana Islands|MQ Martinique|MR Mauritania|MS Montserrat|MT Malta|MU Mauritius|" +
  "MV Maldives|MW Malawi|MX Mexico,México,墨西哥|MY Malaysia,马来西亚|MZ Mozambique|NA Namibia|NC New Caledonia|NE Niger|NF Norfolk Island|NG Nigeria,尼日利亚|" +
  "NI Nicaragua|NL Netherlands,The Netherlands,Holland,Nederland,荷兰|NO Norway,Norge,挪威|NP Nepal|NR Nauru|NU Niue|NZ New Zealand,Aotearoa,新西兰|OM Oman|" +
  "PA Panama|PE Peru,Perú,秘鲁|PF French Polynesia|PG Papua New Guinea|PH Philippines,菲律宾|PK Pakistan,巴基斯坦|PL Poland,Polska,波兰|" +
  "PM Saint Pierre and Miquelon|PN Pitcairn Islands|PR Puerto Rico|PS Palestine,Palestinian Territories|PT Portugal,葡萄牙|PW Palau|PY Paraguay|QA Qatar,卡塔尔|" +
  "RE Reunion,Réunion|RO Romania,România,罗马尼亚|RS Serbia|RU Russia,Russian Federation,俄罗斯|RW Rwanda|SA Saudi Arabia,KSA,Kingdom of Saudi Arabia,沙特,沙特阿拉伯|" +
  "SB Solomon Islands|SC Seychelles|SD Sudan|SE Sweden,Sverige,瑞典|SG Singapore,新加坡|SH Saint Helena|SI Slovenia|SK Slovakia|SL Sierra Leone|SM San Marino|" +
  "SN Senegal|SO Somalia|SR Suriname|SS South Sudan|ST Sao Tome and Principe|SV El Salvador|SX Sint Maarten|SY Syria|SZ Eswatini,Swaziland|" +
  "TC Turks and Caicos Islands|TD Chad|TG Togo|TH Thailand,泰国|TJ Tajikistan|TL Timor-Leste,East Timor|TM Turkmenistan|TN Tunisia|TO Tonga|" +
  "TR Turkey,Türkiye,Turkiye,土耳其|TT Trinidad and Tobago|TV Tuvalu|TW Taiwan,台湾,中国台湾|TZ Tanzania|UA Ukraine,乌克兰|UG Uganda|" +
  "US United States,United States of America,USA,U.S.A.,U.S.,US,America,美国|UY Uruguay|UZ Uzbekistan|VA Vatican City|VC Saint Vincent and the Grenadines|" +
  "VE Venezuela|VG British Virgin Islands|VI U.S. Virgin Islands|VN Vietnam,Viet Nam,越南|VU Vanuatu|WF Wallis and Futuna|WS Samoa|XK Kosovo|YE Yemen|" +
  "YT Mayotte|ZA South Africa,南非|ZM Zambia|ZW Zimbabwe";

export const COUNTRY_NAMES: Readonly<Record<string, string>> = {};
const COUNTRY_BY_NAME = new Map<string, string>();
for (const row of COUNTRY_DATA.split("|")) {
  const code = row.slice(0, 2);
  const names = row.slice(3).split(",").map((n) => n.trim());
  (COUNTRY_NAMES as Record<string, string>)[code] = names[0].replace(/ \(country\)$/, "");
  for (const n of names) COUNTRY_BY_NAME.set(key(n), code);
}
/** Valid ISO codes (the table above). */
export const ISO_COUNTRIES: ReadonlySet<string> = new Set(Object.keys(COUNTRY_NAMES));

/** Non-ISO codes people use for countries. */
const CODE_ALIASES: Record<string, string> = { UK: "GB", EL: "GR", USA: "US", UAE: "AE", KSA: "SA" };

function key(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^the\s+/, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Germany" → DE, "UK" → GB, "美国" → US; null when unknown. */
export function countryFromName(name: string): string | null {
  const k = key(name);
  if (!k) return null;
  return COUNTRY_BY_NAME.get(k) ?? null;
}

/** Normalises an ISO-ish code ("uk" → GB); null when not a country. */
export function normalizeCountryCode(code: string): string | null {
  const c = code.trim().toUpperCase();
  const mapped = CODE_ALIASES[c] ?? c;
  return ISO_COUNTRIES.has(mapped) ? mapped : null;
}

/* ------------------------------------------------------------------ subdivisions */

export const US_STATES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico",
};
const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
const AU_STATES: Record<string, string> = { NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", WA: "Western Australia", SA: "South Australia", TAS: "Tasmania", ACT: "Australian Capital Territory", NT: "Northern Territory" };
/** Region names that only ever mean one country (state/province names, Indian/Chinese/German regions). */
const REGION_NAMES = new Map<string, string>();
for (const n of Object.values(US_STATES)) if (n !== "Georgia" && n !== "Washington") REGION_NAMES.set(key(n), "US");
for (const n of Object.values(CA_PROVINCES)) REGION_NAMES.set(key(n), "CA");
for (const n of Object.values(AU_STATES)) if (n !== "Victoria") REGION_NAMES.set(key(n), "AU");
for (const n of ["Karnataka", "Maharashtra", "Telangana", "Tamil Nadu", "Haryana", "Uttar Pradesh", "Delhi NCR", "NCR", "Kerala", "Gujarat", "West Bengal"]) REGION_NAMES.set(key(n), "IN");
for (const n of ["Bavaria", "Bayern", "Berlin", "Hesse", "Hessen", "North Rhine-Westphalia", "Northrhine-Westfalia", "Nordrhein-Westfalen", "Baden-Württemberg", "Baden-Wurttemberg", "Lower Saxony", "Saxony"]) REGION_NAMES.set(key(n), "DE");
for (const n of ["Ile-de-France", "Île-de-France"]) REGION_NAMES.set(key(n), "FR");
for (const n of ["North Holland", "Noord-Holland", "South Holland", "Zuid-Holland", "Utrecht"]) REGION_NAMES.set(key(n), "NL");
for (const n of ["Catalonia", "Catalunya", "Community of Madrid", "Comunidad de Madrid"]) REGION_NAMES.set(key(n), "ES");
for (const n of ["Ontario", "Quebec", "Québec"]) REGION_NAMES.set(key(n), "CA");
for (const n of ["Guangdong", "Zhejiang", "Jiangsu", "广东", "浙江", "江苏"]) REGION_NAMES.set(key(n), "CN");

/* ------------------------------------------------------------------ cities */

/** City → country. Ambiguous names map to the place job boards almost always mean. */
const CITY_DATA: Record<string, string> = {};
const addCities = (code: string, names: string) => {
  for (const n of names.split(",")) CITY_DATA[key(n)] = code;
};
addCities("US", "New York,New York City,NYC,Manhattan,Brooklyn,San Francisco,SF,San Francisco Bay Area,Bay Area,Silicon Valley,San Jose,Palo Alto,Mountain View,Menlo Park,Sunnyvale,Santa Clara,Cupertino,Redwood City,San Mateo,Foster City,South San Francisco,Oakland,Berkeley,Emeryville,Fremont,Pleasanton,Los Angeles,LA,Santa Monica,Culver City,Irvine,Pasadena,El Segundo,Hawthorne,Long Beach,San Diego,Sacramento,Seattle,Redmond,Bellevue,Kirkland,Tacoma,Portland,Boston,Cambridge MA,Somerville,Waltham,Burlington,Chicago,Evanston,Austin,Dallas,Houston,San Antonio,Fort Worth,Plano,Irving,Denver,Boulder,Colorado Springs,Atlanta,Miami,Fort Lauderdale,Tampa,Orlando,Jacksonville,Washington DC,Washington D.C.,Washington,D.C.,Arlington,Reston,McLean,Herndon,Alexandria,Bethesda,Philadelphia,Pittsburgh,Salt Lake City,Lehi,Provo,Draper,Phoenix,Scottsdale,Tempe,Chandler,Minneapolis,St. Paul,Detroit,Ann Arbor,Nashville,Raleigh,Durham,Charlotte,Research Triangle Park,Baltimore,St. Louis,Kansas City,Columbus,Cleveland,Cincinnati,Indianapolis,Milwaukee,Madison,Las Vegas,Albuquerque,Princeton,New Haven,Stamford,Hartford,Jersey City,Newark,Hoboken,Ithaca,Rochester,Buffalo,Stanford,Honolulu,Anchorage,Boise,Omaha,Des Moines,Louisville,Richmond,Charleston,Greenville,Birmingham AL,Huntsville,New Orleans,Oklahoma City,Tulsa,Spokane,Bozeman,Cape Canaveral,McGregor,Starbase,Brownsville,Carlsbad,Costa Mesa,Torrance,Woodinville,Everett,Kent");
addCities("CA", "Toronto,Vancouver,Montreal,Montréal,Waterloo,Kitchener,Ottawa,Calgary,Edmonton,Quebec City,Victoria BC,Halifax,Winnipeg,Mississauga,Markham,Burnaby,Saskatoon,Regina,London ON");
addCities("GB", "London,Manchester,Edinburgh,Oxford,Cambridge UK,Bristol,Birmingham,Glasgow,Leeds,Liverpool,Newcastle,Belfast,Cardiff,Sheffield,Nottingham,Reading,Brighton,Bath,Milton Keynes,Southampton,Aberdeen,Dundee,York,Guildford,Harwell");
addCities("IE", "Dublin,Cork,Galway,Limerick");
addCities("DE", "Berlin,Munich,München,Muenchen,Hamburg,Frankfurt,Frankfurt am Main,Cologne,Köln,Koeln,Stuttgart,Düsseldorf,Dusseldorf,Leipzig,Dresden,Heidelberg,Karlsruhe,Nuremberg,Nürnberg,Hannover,Bonn,Aachen,Darmstadt,Potsdam,Mannheim,Ulm,Jena");
addCities("FR", "Paris,Lyon,Marseille,Toulouse,Nice,Nantes,Bordeaux,Lille,Grenoble,Montpellier,Strasbourg,Rennes,Sophia Antipolis");
addCities("NL", "Amsterdam,Rotterdam,The Hague,Den Haag,Eindhoven,Utrecht,Delft,Leiden,Groningen");
addCities("BE", "Brussels,Bruxelles,Antwerp,Ghent,Gent,Leuven");
addCities("LU", "Luxembourg City");
addCities("CH", "Zurich,Zürich,Geneva,Genève,Lausanne,Basel,Bern,Zug,Lugano");
addCities("AT", "Vienna,Wien,Graz,Linz,Salzburg,Innsbruck");
addCities("SE", "Stockholm,Gothenburg,Göteborg,Malmö,Malmo,Uppsala,Lund");
addCities("DK", "Copenhagen,København,Aarhus");
addCities("NO", "Oslo,Bergen,Trondheim");
addCities("FI", "Helsinki,Espoo,Tampere,Oulu");
addCities("IS", "Reykjavik,Reykjavík");
addCities("ES", "Madrid,Barcelona,Valencia,Seville,Sevilla,Malaga,Málaga,Bilbao");
addCities("PT", "Lisbon,Lisboa,Porto,Braga,Coimbra");
addCities("IT", "Milan,Milano,Rome,Roma,Turin,Torino,Bologna,Florence,Firenze,Naples,Napoli,Padua,Pisa,Trento");
addCities("PL", "Warsaw,Warszawa,Krakow,Kraków,Wroclaw,Wrocław,Gdansk,Gdańsk,Poznan,Poznań,Lodz,Łódź,Katowice");
addCities("CZ", "Prague,Praha,Brno");
addCities("SK", "Bratislava");
addCities("HU", "Budapest");
addCities("RO", "Bucharest,Cluj-Napoca,Cluj,Iasi,Iași");
addCities("BG", "Sofia");
addCities("RS", "Belgrade,Novi Sad");
addCities("HR", "Zagreb");
addCities("SI", "Ljubljana");
addCities("GR", "Athens,Thessaloniki");
addCities("CY", "Limassol,Nicosia");
addCities("MT", "Valletta");
addCities("EE", "Tallinn,Tartu");
addCities("LV", "Riga");
addCities("LT", "Vilnius,Kaunas");
addCities("UA", "Kyiv,Kiev,Lviv,Kharkiv,Odesa,Odessa");
addCities("TR", "Istanbul,İstanbul,Ankara,Izmir,İzmir");
addCities("IL", "Tel Aviv,Tel Aviv-Yafo,Jerusalem,Haifa,Herzliya,Ra'anana,Raanana,Petah Tikva,Beersheba");
addCities("AE", "Dubai,Abu Dhabi,Sharjah");
addCities("SA", "Riyadh,Jeddah,Dammam,Khobar,NEOM");
addCities("QA", "Doha");
addCities("BH", "Manama");
addCities("KW", "Kuwait City");
addCities("OM", "Muscat");
addCities("JO", "Amman");
addCities("LB", "Beirut");
addCities("EG", "Cairo,Alexandria Egypt,Giza");
addCities("MA", "Casablanca,Rabat,Marrakech");
addCities("TN", "Tunis");
addCities("NG", "Lagos,Abuja");
addCities("GH", "Accra");
addCities("KE", "Nairobi,Mombasa");
addCities("UG", "Kampala");
addCities("RW", "Kigali");
addCities("ET", "Addis Ababa");
addCities("TZ", "Dar es Salaam");
addCities("ZA", "Cape Town,Johannesburg,Pretoria,Durban,Stellenbosch");
addCities("SN", "Dakar");
addCities("IN", "Bangalore,Bengaluru,Mumbai,Bombay,Delhi,New Delhi,Gurgaon,Gurugram,Noida,Hyderabad,Pune,Chennai,Kolkata,Ahmedabad,Jaipur,Kochi,Thiruvananthapuram,Chandigarh,Indore,Coimbatore,Mysore,Mysuru");
addCities("PK", "Karachi,Lahore,Islamabad");
addCities("BD", "Dhaka");
addCities("LK", "Colombo");
addCities("NP", "Kathmandu");
addCities("SG", "Singapore");
addCities("MY", "Kuala Lumpur,Penang,Cyberjaya,Petaling Jaya");
addCities("TH", "Bangkok,Chiang Mai");
addCities("VN", "Ho Chi Minh City,Saigon,Hanoi,Da Nang");
addCities("ID", "Jakarta,Bandung,Surabaya,Bali,Denpasar");
addCities("PH", "Manila,Makati,Taguig,Cebu,Quezon City");
addCities("JP", "Tokyo,Osaka,Kyoto,Yokohama,Nagoya,Fukuoka,Sapporo,Kobe,Sendai,Tsukuba,东京,東京,大阪,京都,横浜,名古屋,福岡,札幌,神戸,仙台");
addCities("KR", "Seoul,Busan,Incheon,Pangyo,Seongnam,Daejeon,首尔");
addCities("TW", "Taipei,New Taipei,Hsinchu,Taichung,Kaohsiung,Tainan,台北,新竹");
addCities("HK", "Hong Kong,Kowloon,香港");
addCities("MO", "澳门");
addCities("CN", "Beijing,Shanghai,Shenzhen,Guangzhou,Hangzhou,Chengdu,Nanjing,Wuhan,Xi'an,Xian,Suzhou,Tianjin,Chongqing,Xiamen,Qingdao,Dalian,Changsha,Hefei,Zhuhai,Dongguan,Ningbo,Zhengzhou,Jinan,Shenyang,Harbin,Kunming,Fuzhou,Wuxi,Foshan,北京,上海,深圳,广州,杭州,成都,南京,武汉,西安,苏州,天津,重庆,厦门,青岛,大连,长沙,合肥,珠海,东莞,宁波,郑州,济南,沈阳,哈尔滨,昆明,福州,无锡,佛山,南宁,贵阳,兰州,太原,石家庄,长春,南昌,海口");
addCities("AU", "Sydney,Melbourne,Brisbane,Perth,Adelaide,Canberra,Gold Coast,Hobart,Darwin,Newcastle NSW");
addCities("NZ", "Auckland,Wellington,Christchurch");
addCities("BR", "São Paulo,Sao Paulo,Rio de Janeiro,Belo Horizonte,Curitiba,Porto Alegre,Brasília,Brasilia,Florianópolis,Florianopolis,Recife,Campinas");
addCities("MX", "Mexico City,Ciudad de México,CDMX,Guadalajara,Monterrey,Querétaro,Queretaro,Tijuana,Puebla");
addCities("AR", "Buenos Aires,Córdoba,Cordoba,Rosario,Mendoza");
addCities("CL", "Santiago,Santiago de Chile,Valparaíso,Valparaiso");
addCities("CO", "Bogotá,Bogota,Medellín,Medellin,Cali,Barranquilla");
addCities("PE", "Lima");
addCities("UY", "Montevideo");
addCities("EC", "Quito,Guayaquil");
addCities("CR", "San José Costa Rica");
addCities("PA", "Panama City");
addCities("GT", "Guatemala City");
addCities("DO", "Santo Domingo");
addCities("PR", "San Juan");

/** CJK city names, longest first (matched as substrings of run-together addresses). */
const CJK_CITIES = Object.keys(CITY_DATA)
  .filter((c) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(c))
  .sort((a, b) => b.length - a.length);

/** "Bengaluru" → IN; null when the city is not in the table. */
export function countryOfCity(name: string): string | null {
  return CITY_DATA[key(stripCitySuffix(name))] ?? null;
}

function stripCitySuffix(s: string): string {
  return s.replace(/^(greater|metro)\s+/i, "").replace(/\s+(area|metro|metropolitan area|region|office|hq|headquarters)$/i, "").replace(/\s*市$/, "");
}

/* ------------------------------------------------------------------ regions */

interface RegionDef {
  re: RegExp;
  label: string;
  countries: string[];
  worldwide?: boolean;
}

/** Multi-country regions. Expanding to countries only where the region is unambiguous. */
const REGIONS: RegionDef[] = [
  // "Anywhere in France" is remote within France, not worldwide.
  { re: /\b(world ?wide|global(ly)?|international|all countries)\b|\banywhere\b(?!\s+(?:in|within|across)\b)|全球/i, label: "Worldwide", countries: [], worldwide: true },
  { re: /\bemea\b/i, label: "EMEA", countries: [] },
  { re: /\b(apac|asia[- ]pacific|asia pac)\b/i, label: "APAC", countries: [] },
  { re: /\b(latam|latin america|south america|central america)\b/i, label: "Latin America", countries: [] },
  { re: /\bamericas\b/i, label: "Americas", countries: [] },
  { re: /\b(north america|us\s*(?:&|and|\/)\s*canada|usa?\s*\/\s*can(?:ada)?)\b/i, label: "North America", countries: ["US", "CA"] },
  { re: /\b(europe|european union|\beu\b|eu only|eu-based)\b/i, label: "Europe", countries: [] },
  { re: /\bdach\b/i, label: "DACH", countries: ["DE", "AT", "CH"] },
  { re: /\b(nordics?|scandinavia)\b/i, label: "Nordics", countries: ["SE", "NO", "DK", "FI", "IS"] },
  { re: /\bbenelux\b/i, label: "Benelux", countries: ["BE", "NL", "LU"] },
  { re: /\b(anz|australia\s*(?:&|and|\/)\s*new zealand)\b/i, label: "ANZ", countries: ["AU", "NZ"] },
  { re: /\b(uk\s*(?:&|and)\s*i(reland)?|uki)\b/i, label: "UK & Ireland", countries: ["GB", "IE"] },
  { re: /\b(mena|middle east)\b/i, label: "Middle East", countries: [] },
  { re: /\b(southeast asia|south[- ]east asia|sea region)\b/i, label: "Southeast Asia", countries: [] },
  { re: /\b(cee|central (?:and|&) eastern europe|eastern europe)\b/i, label: "Central & Eastern Europe", countries: [] },
  { re: /\bafrica\b/i, label: "Africa", countries: [] },
  { re: /\basia\b/i, label: "Asia", countries: [] },
];

/* ------------------------------------------------------------------ parsing */

export interface ParsedLocation {
  countries: string[];
  cities: string[];
  remote: RemoteMode | null;
  worldwide: boolean;
  /** Region labels found ("EMEA", "Europe"…), useful as tags. */
  regions: string[];
}

const REMOTE_RE = /\b(remote|remotely|anywhere|work from home|wfh|telecommute|distributed|home[- ]based|fully remote|100% remote)\b|远程|在家办公|リモート/i;
const HYBRID_RE = /\bhybrid\b|混合办公|ハイブリッド/i;
const ONSITE_RE = /\b(on-?site|in[- ]office|in[- ]person|office[- ]based)\b|现场|驻场/i;

/** Words stripped from a segment before reading places. */
const NOISE_RE =
  /\b(anywhere (?:in|within|across)|remote|remotely|hybrid|on-?site|in[- ]office|in[- ]person|office[- ]based|fully|100%|work from home|wfh|telecommute|distributed|home[- ]based|based|only|preferred|flexible|location|locations|multiple|various|several|offices?|hq|headquarters|available|open to|candidates in|must be located in|within|from|any|other|time ?zones?|timezone|friendly|first|-first)\b|远程|混合办公/gi;

function titleCaseCity(s: string): string {
  if (/[一-鿿]/.test(s)) return s.replace(/\s*市$/, "");
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s; // already cased by the source
  return s.toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Reads one place segment ("San Mateo, CA", "Bangalore, India", "London", "Remote - US") into
 * a country and a city. Returns null fields when unknown.
 */
export function parsePlace(segment: string): { country: string | null; city: string | null } {
  const cleaned = segment.replace(NOISE_RE, " ").replace(/[()[\]{}]/g, ",").replace(/\s+[-–—:]\s+|\s+[-–—]|[-–—]\s+/g, ",").replace(/\s+/g, " ");
  const parts = cleaned
    .split(/[,，、]/)
    .map((p) => p.trim().replace(/^[-–—:.\s]+|[-–—:.\s]+$/g, ""))
    .filter((p) => p.length > 0 && !/^\d+$/.test(p));
  if (!parts.length) return { country: null, city: null };

  let country: string | null = null;
  let countryIdx = -1;
  // Explicit country names win, scanning from the end ("Bengaluru, Karnataka, India").
  for (let i = parts.length - 1; i >= 0; i--) {
    const c = countryFromName(parts[i]);
    if (c && !(parts.length > 1 && i === 0 && /^[A-Z]{2}$/.test(parts[i]))) {
      country = c;
      countryIdx = i;
      break;
    }
  }
  const first = parts[0];
  const firstCityCountry = countryOfCity(first);
  // State / province codes after a city: "Austin, TX", "Toronto, ON", "Perth, WA".
  if (!country && parts.length > 1) {
    for (let i = parts.length - 1; i >= 1; i--) {
      const p = parts[i].replace(/\./g, "").toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(p)) {
        const r = REGION_NAMES.get(key(parts[i]));
        if (r) {
          country = r;
          countryIdx = i;
          break;
        }
        continue;
      }
      if (firstCityCountry === "AU" && AU_STATES[p]) country = "AU";
      else if (firstCityCountry && firstCityCountry !== "US" && normalizeCountryCode(p) === firstCityCountry) country = firstCityCountry;
      else if (US_STATES[p]) country = "US";
      else if (CA_PROVINCES[p]) country = "CA";
      else if (AU_STATES[p]) country = "AU";
      else country = normalizeCountryCode(p);
      if (country) {
        countryIdx = i;
        break;
      }
    }
  }
  // A lone ISO code ("US", "UK") or a lone region name ("California", "Ontario").
  if (!country && parts.length === 1) {
    const p = parts[0];
    if (/^[A-Za-z]{2,3}$/.test(p) && p === p.toUpperCase()) country = normalizeCountryCode(p);
    if (!country) country = REGION_NAMES.get(key(p)) ?? null;
    if (country) countryIdx = 0;
  }

  let city: string | null = null;
  if (countryIdx !== 0) {
    const candidate = stripCitySuffix(first).trim();
    const looksLikePlace = /^[\p{L}][\p{L}\p{M} .'’-]{1,40}$/u.test(candidate) && !/\b(and|or|with|team|role|position)\b/i.test(candidate);
    const known = looksLikePlace ? countryOfCity(candidate) : null;
    // A known city wins over a same-named region ("New York, NY", "Berlin, DE").
    if (looksLikePlace && (known || (!countryFromName(candidate) && !REGION_NAMES.has(key(candidate)) && !REGIONS.some((r) => r.re.test(candidate))))) {
      // Unknown words only count as a city when a country/state was read next to them.
      if (known || country) {
        city = titleCaseCity(candidate);
        if (!country) country = known;
      }
    }
  }
  return { country, city };
}

/**
 * Parses one free-text location (possibly listing several places) into countries, cities, a
 * remote mode and a worldwide flag. Examples:
 *   "New York, NY; San Mateo, CA" → US, [New York, San Mateo], remote null
 *   "Remote - United States"      → US, [], remote
 *   "Remote (EMEA)"               → [], [], remote, regions [EMEA]
 *   "Hybrid - London, UK"         → GB, [London], hybrid
 *   "Anywhere"                    → [], [], remote, worldwide
 */
export function parseLocation(raw: string | null | undefined): ParsedLocation {
  const out: ParsedLocation = { countries: [], cities: [], remote: null, worldwide: false, regions: [] };
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return out;

  const isRemote = REMOTE_RE.test(text);
  const isHybrid = HYBRID_RE.test(text);
  const isOnsite = ONSITE_RE.test(text);
  out.remote = isHybrid ? "hybrid" : isRemote ? "remote" : isOnsite ? "onsite" : null;

  for (const r of REGIONS) {
    if (!r.re.test(text)) continue;
    out.regions.push(r.label);
    out.countries.push(...r.countries);
    if (r.worldwide) out.worldwide = true;
  }
  // "Remote" with "worldwide"/"anywhere" means open to everyone; "Global" alone (a talent pool) too.
  if (out.worldwide && out.remote === null) out.remote = /\b(global|international)\b/i.test(text) ? null : "remote";

  const cjkKnown = /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? CJK_CITIES.filter((c) => text.includes(c)) : [];
  const segments = text.split(/\s*(?:;|\||\/|•|·|\bor\b|\n)\s*|\s+&\s+(?=[A-Z])|\s+and\s+(?=[A-Z][a-z]+,)/);
  for (const seg of segments) {
    if (!seg.trim()) continue;
    // "Remote (US)" / "United States (Remote)": read the bracket content as its own place too.
    const inner = /\(([^)]+)\)/.exec(seg)?.[1];
    for (const piece of inner ? [seg.replace(/\([^)]*\)/g, " "), inner] : [seg]) {
      // "Anywhere in France, Belgium, Spain": a list of countries.
      const list = piece.replace(NOISE_RE, " ").split(/[,，、]|\band\b/).map((p) => p.trim()).filter(Boolean);
      const listed = list.map((p) => countryFromName(p));
      if (list.length > 1 && listed.every(Boolean)) {
        out.countries.push(...(listed as string[]));
        continue;
      }
      const { country, city } = parsePlace(piece);
      if (country) out.countries.push(country);
      if (city) out.cities.push(city);
    }
  }
  // "福岡県福岡市", "東京都港区": Chinese/Japanese addresses run together without separators.
  for (const c of cjkKnown) {
    const code = CITY_DATA[key(c)];
    if (!out.countries.length && code) out.countries.push(code);
    if (!out.cities.length) out.cities.push(c);
  }
  out.countries = uniq(out.countries);
  out.cities = uniq(out.cities).slice(0, 12);
  out.regions = uniq(out.regions);
  return out;
}

/** Local or alternate spellings → the English name job boards use most. */
const CITY_CANONICAL: Record<string, string> = {
  bangalore: "Bengaluru", bombay: "Mumbai", gurgaon: "Gurugram", münchen: "Munich", muenchen: "Munich", köln: "Cologne", koeln: "Cologne", wien: "Vienna",
  praha: "Prague", warszawa: "Warsaw", lisboa: "Lisbon", milano: "Milan", roma: "Rome", torino: "Turin", firenze: "Florence", napoli: "Naples",
  københavn: "Copenhagen", göteborg: "Gothenburg", zürich: "Zurich", genève: "Geneva", montréal: "Montreal", "sao paulo": "São Paulo", bogota: "Bogotá",
  medellin: "Medellín", saigon: "Ho Chi Minh City", nyc: "New York", "new york city": "New York", manhattan: "New York", sf: "San Francisco",
  bruxelles: "Brussels", "den haag": "The Hague", kiev: "Kyiv", odessa: "Odesa", "frankfurt am main": "Frankfurt", "tel aviv-yafo": "Tel Aviv",
  "washington d.c": "Washington", "washington dc": "Washington", "d.c": "Washington", "ciudad de méxico": "Mexico City", cdmx: "Mexico City",
  "kraków": "Krakow", "wrocław": "Wroclaw", "gdańsk": "Gdansk", "poznań": "Poznan", "łódź": "Lodz", "malmö": "Malmo", "málaga": "Malaga",
  "reykjavík": "Reykjavik", "brasília": "Brasilia", "florianópolis": "Florianopolis", "querétaro": "Queretaro", "valparaíso": "Valparaiso", "córdoba": "Cordoba",
  "iași": "Iasi", "i̇stanbul": "Istanbul", "i̇zmir": "Izmir", raanana: "Ra'anana",
};

/** The canonical spelling of a city name (unknown names unchanged). */
export function canonicalCity(name: string): string {
  return CITY_CANONICAL[key(name)] ?? name;
}

/** Combines several readings (primary location, secondary locations, offices, ATS fields). */
export function mergeLocations(readings: Array<Partial<ParsedLocation> | null | undefined>): ParsedLocation {
  const out: ParsedLocation = { countries: [], cities: [], remote: null, worldwide: false, regions: [] };
  const modes: RemoteMode[] = [];
  for (const r of readings) {
    if (!r) continue;
    out.countries.push(...(r.countries ?? []));
    out.cities.push(...(r.cities ?? []));
    out.regions.push(...(r.regions ?? []));
    if (r.worldwide) out.worldwide = true;
    if (r.remote) modes.push(r.remote);
  }
  // The most flexible mode stated anywhere wins: a role listed as "Remote" and "New York" is remote-friendly.
  out.remote = modes.includes("remote") ? "remote" : modes.includes("hybrid") ? "hybrid" : modes.includes("onsite") ? "onsite" : null;
  out.countries = uniq(out.countries).filter((c) => ISO_COUNTRIES.has(c));
  out.cities = uniq(out.cities.map(canonicalCity)).slice(0, 12);
  out.regions = uniq(out.regions);
  return out;
}

/** The `opportunities.geo` value for a parsed location. */
export function toGeo(p: ParsedLocation): OpportunityGeo {
  return { countries: p.countries.slice(0, 30), cities: p.cities.slice(0, 12), remote: p.remote, worldwide: p.worldwide };
}

/** Maps an ATS workplace-type field ("Remote", "on-site", "OnSite", "hybrid", "unspecified") to a remote mode. */
export function workplaceMode(value: string | null | undefined): RemoteMode | null {
  const v = (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (v === "remote") return "remote";
  if (v === "hybrid") return "hybrid";
  if (v === "onsite" || v === "inoffice" || v === "office") return "onsite";
  return null;
}
