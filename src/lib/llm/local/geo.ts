/*
 * Small geography knowledge for the local engine: country names (en/zh) → ISO codes, major
 * cities → country, US states and Chinese provinces. Used to read "San Francisco, CA",
 * "北京市朝阳区", "Remote (EU)" off a résumé and to compare locations in matching.
 */

export const COUNTRIES: Array<{ code: string; names: string[] }> = [
  { code: "US", names: ["united states", "united states of america", "usa", "u.s.", "u.s.a.", "us", "america", "美国"] },
  { code: "CN", names: ["china", "mainland china", "prc", "people's republic of china", "中国", "中国大陆", "中华人民共和国"] },
  { code: "HK", names: ["hong kong", "hong kong sar", "香港"] },
  { code: "TW", names: ["taiwan", "台湾"] },
  { code: "MO", names: ["macau", "macao", "澳门"] },
  { code: "GB", names: ["united kingdom", "uk", "u.k.", "great britain", "england", "scotland", "wales", "britain", "英国"] },
  { code: "CA", names: ["canada", "加拿大"] },
  { code: "AU", names: ["australia", "澳大利亚", "澳洲"] },
  { code: "NZ", names: ["new zealand", "新西兰"] },
  { code: "SG", names: ["singapore", "新加坡"] },
  { code: "JP", names: ["japan", "日本"] },
  { code: "KR", names: ["south korea", "korea", "republic of korea", "韩国"] },
  { code: "IN", names: ["india", "印度"] },
  { code: "DE", names: ["germany", "deutschland", "德国"] },
  { code: "FR", names: ["france", "法国"] },
  { code: "NL", names: ["netherlands", "the netherlands", "holland", "荷兰"] },
  { code: "IE", names: ["ireland", "爱尔兰"] },
  { code: "ES", names: ["spain", "西班牙"] },
  { code: "IT", names: ["italy", "意大利"] },
  { code: "PT", names: ["portugal", "葡萄牙"] },
  { code: "CH", names: ["switzerland", "瑞士"] },
  { code: "SE", names: ["sweden", "瑞典"] },
  { code: "NO", names: ["norway", "挪威"] },
  { code: "DK", names: ["denmark", "丹麦"] },
  { code: "FI", names: ["finland", "芬兰"] },
  { code: "BE", names: ["belgium", "比利时"] },
  { code: "AT", names: ["austria", "奥地利"] },
  { code: "PL", names: ["poland", "波兰"] },
  { code: "IL", names: ["israel", "以色列"] },
  { code: "AE", names: ["united arab emirates", "uae", "阿联酋"] },
  { code: "SA", names: ["saudi arabia", "沙特", "沙特阿拉伯"] },
  { code: "BR", names: ["brazil", "brasil", "巴西"] },
  { code: "MX", names: ["mexico", "墨西哥"] },
  { code: "AR", names: ["argentina", "阿根廷"] },
  { code: "CL", names: ["chile", "智利"] },
  { code: "CO", names: ["colombia", "哥伦比亚"] },
  { code: "ZA", names: ["south africa", "南非"] },
  { code: "NG", names: ["nigeria", "尼日利亚"] },
  { code: "KE", names: ["kenya", "肯尼亚"] },
  { code: "EG", names: ["egypt", "埃及"] },
  { code: "MY", names: ["malaysia", "马来西亚"] },
  { code: "TH", names: ["thailand", "泰国"] },
  { code: "VN", names: ["vietnam", "viet nam", "越南"] },
  { code: "ID", names: ["indonesia", "印度尼西亚", "印尼"] },
  { code: "PH", names: ["philippines", "菲律宾"] },
  { code: "TR", names: ["turkey", "türkiye", "土耳其"] },
  { code: "RU", names: ["russia", "russian federation", "俄罗斯"] },
  { code: "UA", names: ["ukraine", "乌克兰"] },
  { code: "CZ", names: ["czech republic", "czechia", "捷克"] },
  { code: "GR", names: ["greece", "希腊"] },
  { code: "HU", names: ["hungary", "匈牙利"] },
  { code: "RO", names: ["romania", "罗马尼亚"] },
  { code: "EE", names: ["estonia", "爱沙尼亚"] },
  { code: "PK", names: ["pakistan", "巴基斯坦"] },
  { code: "BD", names: ["bangladesh", "孟加拉国"] },
];

/** City → ISO country code. Lower-case keys; Chinese names included. */
export const CITIES: Record<string, string> = {
  // United States
  "new york": "US", "new york city": "US", nyc: "US", brooklyn: "US", "san francisco": "US", sf: "US", "bay area": "US", "san jose": "US",
  "palo alto": "US", "mountain view": "US", "menlo park": "US", sunnyvale: "US", oakland: "US", berkeley: "US", "los angeles": "US", la: "US",
  "san diego": "US", seattle: "US", redmond: "US", bellevue: "US", portland: "US", boston: "US", cambridge: "US", chicago: "US", austin: "US",
  dallas: "US", houston: "US", denver: "US", boulder: "US", atlanta: "US", miami: "US", "washington": "US", "washington dc": "US", "washington, d.c.": "US",
  philadelphia: "US", pittsburgh: "US", "salt lake city": "US", phoenix: "US", minneapolis: "US", detroit: "US", "ann arbor": "US", nashville: "US",
  "raleigh": "US", durham: "US", baltimore: "US", "st. louis": "US", princeton: "US", "new haven": "US", ithaca: "US", stanford: "US",
  // Canada
  toronto: "CA", vancouver: "CA", montreal: "CA", "montréal": "CA", waterloo: "CA", ottawa: "CA", calgary: "CA",
  // UK / Ireland
  london: "GB", manchester: "GB", edinburgh: "GB", oxford: "GB", bristol: "GB", birmingham: "GB", glasgow: "GB", dublin: "IE",
  // Europe
  berlin: "DE", munich: "DE", "münchen": "DE", hamburg: "DE", frankfurt: "DE", paris: "FR", lyon: "FR", amsterdam: "NL", rotterdam: "NL",
  "the hague": "NL", eindhoven: "NL", zurich: "CH", "zürich": "CH", geneva: "CH", lausanne: "CH", stockholm: "SE", copenhagen: "DK", oslo: "NO",
  helsinki: "FI", madrid: "ES", barcelona: "ES", lisbon: "PT", milan: "IT", rome: "IT", vienna: "AT", brussels: "BE", warsaw: "PL", prague: "CZ",
  tallinn: "EE", athens: "GR", budapest: "HU",
  // Asia-Pacific
  singapore: "SG", tokyo: "JP", osaka: "JP", kyoto: "JP", seoul: "KR", bangalore: "IN", bengaluru: "IN", mumbai: "IN", delhi: "IN", "new delhi": "IN",
  hyderabad: "IN", pune: "IN", chennai: "IN", sydney: "AU", melbourne: "AU", brisbane: "AU", perth: "AU", auckland: "NZ", "kuala lumpur": "MY",
  bangkok: "TH", jakarta: "ID", manila: "PH", "ho chi minh city": "VN", hanoi: "VN", "tel aviv": "IL", dubai: "AE", "abu dhabi": "AE", riyadh: "SA",
  istanbul: "TR", taipei: "TW", "hong kong": "HK",
  // China (pinyin + characters)
  beijing: "CN", shanghai: "CN", shenzhen: "CN", guangzhou: "CN", hangzhou: "CN", chengdu: "CN", nanjing: "CN", wuhan: "CN", "xi'an": "CN", xian: "CN",
  suzhou: "CN", tianjin: "CN", chongqing: "CN", xiamen: "CN", qingdao: "CN", dalian: "CN", changsha: "CN", hefei: "CN", zhuhai: "CN", dongguan: "CN",
  北京: "CN", 上海: "CN", 深圳: "CN", 广州: "CN", 杭州: "CN", 成都: "CN", 南京: "CN", 武汉: "CN", 西安: "CN", 苏州: "CN", 天津: "CN", 重庆: "CN",
  厦门: "CN", 青岛: "CN", 大连: "CN", 长沙: "CN", 合肥: "CN", 珠海: "CN", 东莞: "CN", 宁波: "CN", 郑州: "CN", 济南: "CN", 沈阳: "CN", 哈尔滨: "CN",
  昆明: "CN", 福州: "CN", 无锡: "CN", 佛山: "CN", 南宁: "CN", 贵阳: "CN", 兰州: "CN", 太原: "CN", 石家庄: "CN", 长春: "CN", 南昌: "CN", 海口: "CN",
  香港: "HK", 台北: "TW", 澳门: "MO",
  // Latin America / Africa
  "são paulo": "BR", "sao paulo": "BR", "rio de janeiro": "BR", "mexico city": "MX", "buenos aires": "AR", santiago: "CL", "bogotá": "CO", bogota: "CO",
  lagos: "NG", nairobi: "KE", "cape town": "ZA", johannesburg: "ZA", cairo: "EG",
};

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

export const CN_PROVINCES = [
  "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东",
  "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门",
];

const COUNTRY_INDEX = new Map<string, string>();
for (const c of COUNTRIES) for (const n of c.names) COUNTRY_INDEX.set(n, c.code);

export function countryCodeFromName(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/\.$/, "");
  return COUNTRY_INDEX.get(key) ?? null;
}

export function countryName(code: string, lang: "en" | "zh" = "en"): string {
  const c = COUNTRIES.find((x) => x.code === code.toUpperCase());
  if (!c) return code;
  if (lang === "zh") return c.names.find((n) => /[一-鿿]/.test(n)) ?? code;
  const n = c.names[0];
  return n.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()).replace(/\bOf\b/g, "of");
}

/**
 * Reads a location string and returns its country when recognisable: "Austin, TX" → US,
 * "Berlin, Germany" → DE, "上海市浦东新区" → CN, "Remote" → null.
 */
export function countryOfLocation(location: string): string | null {
  const s = location.trim();
  if (!s) return null;
  const parts = s.split(/[,，/|·]/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const byName = countryCodeFromName(p);
    if (byName) return byName;
    if (/^[A-Z]{2}$/.test(p) && US_STATES[p]) return "US";
    const lower = p.toLowerCase().replace(/^greater\s+|\s+(area|metro|metropolitan area)$/g, "");
    if (CITIES[lower]) return CITIES[lower];
    if (Object.values(US_STATES).some((st) => st.toLowerCase() === lower)) return "US";
  }
  for (const [city, code] of Object.entries(CITIES)) {
    if (/[一-鿿]/.test(city) && s.includes(city)) return code;
  }
  if (CN_PROVINCES.some((p) => s.startsWith(p))) return s.startsWith("香港") ? "HK" : s.startsWith("澳门") ? "MO" : s.startsWith("台湾") ? "TW" : "CN";
  return null;
}

/** Does this line look like a location ("San Francisco, CA", "London, UK", "北京", "Remote")? */
export function looksLikeLocation(line: string): boolean {
  const s = line.trim().replace(/^(location|address|based in|现居|所在地|城市|地址)\s*[:：]?\s*/i, "");
  if (!s || s.length > 60) return false;
  if (/^(remote|hybrid|远程)\b/i.test(s)) return true;
  if (countryOfLocation(s)) return true;
  return /^[A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}(\s+\d{5})?$/.test(s);
}

/** City names found in a text (lower-case keys of CITIES). */
export function citiesIn(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const city of Object.keys(CITIES)) {
    if (city.length < 3) continue;
    if (/[一-鿿]/.test(city) ? text.includes(city) : new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) out.push(city);
  }
  return out;
}

/** Country codes mentioned in a text by name. */
export function countriesIn(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const out = new Set<string>();
  for (const c of COUNTRIES) {
    for (const n of c.names) {
      if (n.length <= 3 && n !== "uk" && n !== "usa") continue; // "us", "la" are too ambiguous in prose
      if (/[一-鿿]/.test(n) ? text.includes(n) : new RegExp(`[^a-z]${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(lower)) out.add(c.code);
    }
  }
  return [...out];
}
