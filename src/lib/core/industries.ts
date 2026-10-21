/**
 * Industry taxonomy (plan §3): 20 top-level industries and their second-level fields.
 * Codes: top level `software-internet`, second level `software-internet.saas`. Profiles and
 * opportunities may store either level. `keywords` (plus both labels) feed `mapIndustry()`.
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { createPhraseMatcher, type MatchOptions, type PhraseMatch } from "./text";

export interface IndustryDef {
  code: string;
  label: Bilingual;
  /** Parent code for second-level fields; null for top level. */
  parent: string | null;
  keywords: string[];
}

export interface IndustryTreeNode extends IndustryDef {
  children: IndustryDef[];
}

const codeRe = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)?$/;

export const industryDefSchema = z.object({
  code: z.string().regex(codeRe),
  label: bilingualSchema,
  parent: z.string().nullable(),
  keywords: z.array(z.string().min(1)),
});

type Sub = [slug: string, en: string, zh: string, keywords: string[]];
type Top = [slug: string, en: string, zh: string, keywords: string[], subs: Sub[]];

const DATA: Top[] = [
  ["software-internet", "Software & Internet", "软件与互联网", ["software", "internet", "tech company", "互联网", "软件", "科技公司"], [
    ["application-software", "Application software", "应用软件", ["app", "application software", "mobile app", "应用软件", "app开发"]],
    ["saas", "SaaS", "SaaS（软件即服务）", ["saas", "b2b software", "enterprise software", "企业服务", "企业软件", "to b"]],
    ["consumer-internet", "Consumer internet", "消费互联网", ["consumer app", "marketplace", "o2o", "本地生活", "消费互联网"]],
    ["ecommerce", "E-commerce platforms", "电商平台", ["ecommerce", "e commerce", "online retail", "cross border ecommerce", "电商", "跨境电商", "网店"]],
    ["social-content", "Social & content platforms", "社交与内容", ["social network", "social media platform", "content platform", "community app", "社交", "内容平台", "社区"]],
    ["gaming", "Games", "游戏", ["game", "gaming", "video game", "mobile game", "game studio", "游戏", "手游", "游戏公司"]],
    ["developer-tools", "Developer tools", "开发者工具", ["developer tools", "devtools", "open source", "api platform", "开发者工具", "开源"]],
    ["cloud-infrastructure", "Cloud & infrastructure", "云与基础设施", ["cloud", "infrastructure", "data center", "kubernetes", "云计算", "云服务", "数据中心"]],
    ["cybersecurity", "Cybersecurity", "网络安全", ["cybersecurity", "security", "infosec", "网络安全", "信息安全"]],
    ["blockchain", "Blockchain & Web3", "区块链", ["blockchain", "web3", "crypto", "defi", "区块链", "加密货币", "数字资产"]],
  ]],
  ["ai-data", "AI & Data", "人工智能与数据", ["artificial intelligence", "ai", "machine learning", "人工智能", "ai公司"], [
    ["generative-ai", "Foundation models & generative AI", "大模型与生成式 AI", ["llm", "large language model", "generative ai", "genai", "foundation model", "大模型", "生成式ai", "aigc"]],
    ["ml-platforms", "Machine learning platforms", "机器学习平台", ["mlops", "machine learning platform", "ai infrastructure", "机器学习平台", "ai平台"]],
    ["computer-vision", "Computer vision", "计算机视觉", ["computer vision", "image recognition", "视觉识别", "计算机视觉", "图像识别"]],
    ["speech-nlp", "Speech & NLP", "语音与自然语言处理", ["nlp", "natural language processing", "speech recognition", "语音识别", "自然语言处理"]],
    ["data-science", "Data science & analytics", "数据科学与分析", ["data analytics", "big data", "business intelligence", "数据分析", "大数据", "商业智能"]],
    ["robotics-autonomy", "Robotics & autonomous driving", "机器人与自动驾驶", ["robotics", "autonomous driving", "self driving", "drone", "机器人", "自动驾驶", "无人机", "具身智能"]],
  ]],
  ["hardware-electronics", "Hardware & Electronics", "硬件与电子", ["hardware", "electronics", "硬件", "电子"], [
    ["semiconductors", "Semiconductors & chips", "半导体与芯片", ["semiconductor", "chip", "integrated circuit", "fab", "eda", "半导体", "芯片", "集成电路", "晶圆"]],
    ["consumer-electronics", "Consumer electronics", "消费电子", ["consumer electronics", "smartphone", "wearable", "消费电子", "手机", "智能硬件", "可穿戴"]],
    ["iot", "Internet of things", "物联网", ["iot", "internet of things", "smart home", "embedded", "物联网", "智能家居", "嵌入式"]],
    ["telecom-equipment", "Telecom equipment", "通信设备", ["telecom", "5g", "networking equipment", "通信", "通信设备", "运营商"]],
    ["optoelectronics", "Optoelectronics & displays", "光电与显示", ["optoelectronics", "display", "photonics", "laser", "光电", "显示面板", "激光"]],
    ["precision-instruments", "Precision instruments", "精密仪器", ["precision instrument", "measurement", "test equipment", "精密仪器", "仪器仪表", "检测设备"]],
  ]],
  ["advanced-manufacturing", "Advanced Manufacturing & Industry", "先进制造与工业", ["manufacturing", "industrial", "factory", "制造业", "工业", "工厂"], [
    ["automotive-ev", "Automotive & EVs", "汽车与新能源车", ["automotive", "electric vehicle", "ev", "car maker", "auto parts", "汽车", "新能源车", "新能源汽车", "汽车零部件"]],
    ["machinery", "Machinery & equipment", "机械装备", ["machinery", "industrial equipment", "heavy equipment", "机械", "装备制造", "工程机械"]],
    ["aerospace", "Aerospace", "航空航天", ["aerospace", "aviation manufacturing", "satellite", "space", "航空航天", "卫星", "商业航天"]],
    ["advanced-materials", "Advanced materials", "新材料", ["advanced materials", "composites", "polymers", "新材料", "复合材料", "高分子"]],
    ["industrial-software", "Industrial software", "工业软件", ["industrial software", "cad", "cae", "plm", "mes", "工业软件", "工业互联网"]],
    ["additive-manufacturing", "Additive manufacturing", "增材制造", ["3d printing", "additive manufacturing", "3d打印", "增材制造"]],
  ]],
  ["energy-environment", "Energy & Environment", "能源与环境", ["energy", "climate", "cleantech", "能源", "新能源", "环保"], [
    ["solar-wind", "Solar & wind", "太阳能与风能", ["solar", "photovoltaic", "wind power", "renewable", "光伏", "风电", "太阳能", "可再生能源"]],
    ["energy-storage", "Energy storage & batteries", "储能与电池", ["battery", "energy storage", "lithium", "储能", "电池", "锂电"]],
    ["power-grid", "Power & grid", "电网与电力", ["power grid", "utility", "electricity", "电网", "电力", "国家电网"]],
    ["hydrogen", "Hydrogen", "氢能", ["hydrogen", "fuel cell", "氢能", "燃料电池"]],
    ["oil-gas", "Oil & gas", "油气", ["oil and gas", "petroleum", "lng", "石油", "天然气", "油气"]],
    ["environment-carbon", "Environmental protection & carbon management", "环保与碳管理", ["carbon", "esg", "sustainability", "recycling", "water treatment", "碳中和", "双碳", "环保", "碳管理", "污水处理"]],
  ]],
  ["life-sciences-healthcare", "Life Sciences & Healthcare", "生物医药与医疗健康", ["healthcare", "life sciences", "biotech", "medical", "医疗", "医药", "生物医药", "大健康"], [
    ["pharma", "Drug discovery & pharma", "创新药", ["pharmaceutical", "pharma", "drug discovery", "biologics", "创新药", "制药", "药企", "生物药"]],
    ["medical-devices", "Medical devices", "医疗器械", ["medical device", "medtech", "医疗器械", "器械"]],
    ["diagnostics-genomics", "Diagnostics & genomics", "诊断与基因", ["diagnostics", "genomics", "sequencing", "ivd", "诊断", "基因", "测序", "体外诊断"]],
    ["digital-health", "Digital health", "数字医疗", ["digital health", "telemedicine", "health tech", "数字医疗", "互联网医疗", "医疗信息化"]],
    ["hospitals-clinical", "Hospitals & clinical care", "医院与临床", ["hospital", "clinic", "clinical care", "医院", "诊所", "临床"]],
    ["consumer-health", "Health management & consumer healthcare", "健康管理与消费医疗", ["wellness", "health management", "consumer health", "dental clinic", "aesthetic medicine", "健康管理", "消费医疗", "医美", "口腔连锁"]],
    ["public-health", "Public health", "公共卫生", ["public health", "epidemiology", "global health", "公共卫生", "疾控", "流行病"]],
  ]],
  ["finance", "Finance", "金融", ["finance", "financial services", "金融", "金融机构"], [
    ["banking", "Banking", "银行", ["bank", "banking", "retail banking", "commercial bank", "银行", "商业银行"]],
    ["securities-ib", "Securities & investment banking", "证券与投行", ["investment banking", "securities", "brokerage", "证券", "投行", "券商"]],
    ["asset-management", "Asset management & funds", "资产管理与基金", ["asset management", "hedge fund", "mutual fund", "wealth management", "资产管理", "基金", "公募", "私募证券"]],
    ["insurance", "Insurance", "保险", ["insurance", "reinsurance", "insurtech", "保险", "寿险", "财险"]],
    ["fintech-payments", "Fintech & payments", "金融科技与支付", ["fintech", "payments", "digital banking", "金融科技", "支付", "第三方支付"]],
    ["vc-pe", "Venture capital & private equity", "风险投资与私募", ["venture capital", "private equity", "vc", "pe fund", "风险投资", "私募股权", "创投", "投资机构"]],
    ["accounting-audit", "Accounting & audit", "会计与审计", ["accounting firm", "audit firm", "big four", "会计师事务所", "审计", "四大"]],
  ]],
  ["consumer-retail", "Consumer & Retail", "消费与零售", ["consumer goods", "retail", "brand", "消费品", "零售", "品牌"], [
    ["fmcg", "Fast-moving consumer goods", "快消", ["fmcg", "cpg", "consumer packaged goods", "快消", "快消品"]],
    ["food-beverage", "Food & beverage", "食品饮料", ["food and beverage", "beverage", "snacks", "食品", "饮料", "酒水"]],
    ["beauty-personal-care", "Beauty & personal care", "美妆个护", ["beauty", "cosmetics", "skincare", "personal care", "美妆", "化妆品", "护肤", "个护"]],
    ["fashion-luxury", "Apparel & luxury", "服饰与奢侈品", ["fashion", "apparel", "luxury", "footwear", "服装", "服饰", "奢侈品", "鞋履"]],
    ["retail-chains", "Retail chains", "零售连锁", ["retail chain", "supermarket", "convenience store", "department store", "连锁", "超市", "便利店", "商超"]],
    ["home-appliances", "Home & appliances", "家居家电", ["home furnishing", "furniture", "appliances", "家居", "家电", "家具"]],
    ["pets", "Pets", "宠物", ["pet", "pet food", "veterinary clinic", "宠物", "宠物食品", "宠物医院"]],
  ]],
  ["media-entertainment", "Media, Culture & Entertainment", "文化传媒与娱乐", ["media", "entertainment", "culture", "传媒", "文娱", "文化"], [
    ["film-tv", "Film & TV", "影视", ["film", "television", "movie", "production company", "streaming", "影视", "电影", "电视剧", "影视公司"]],
    ["music", "Music", "音乐", ["music", "record label", "concert", "音乐", "唱片", "演出"]],
    ["publishing", "Publishing", "出版", ["publishing", "publisher", "books", "出版", "出版社", "图书"]],
    ["news-media", "News media", "新闻媒体", ["news", "journalism", "newspaper", "magazine", "新闻", "媒体", "杂志", "报社"]],
    ["advertising-marketing", "Advertising & marketing", "广告与营销", ["advertising", "marketing agency", "ad agency", "广告", "营销", "广告公司", "4a"]],
    ["live-streaming-short-video", "Live streaming & short video", "直播与短视频", ["live streaming", "short video", "mcn", "livestream", "直播", "短视频", "mcn机构"]],
    ["sports-esports", "Sports & esports", "体育与电竞", ["sports", "esports", "athletics", "体育", "电竞", "赛事"]],
  ]],
  ["design-arts", "Design & Arts", "设计与艺术", ["design", "art", "creative studio", "设计", "艺术"], [
    ["ux-product-design", "UI/UX & product design", "UI/UX 与产品设计", ["ux", "ui", "user experience", "product design", "交互设计", "用户体验", "ui设计"]],
    ["industrial-design", "Industrial design", "工业设计", ["industrial design", "product styling", "工业设计", "外观设计"]],
    ["architecture-landscape", "Architecture & landscape", "建筑与景观", ["architecture", "landscape architecture", "interior design", "建筑设计", "景观设计", "室内设计"]],
    ["fashion-design", "Fashion design", "时尚设计", ["fashion design", "textile design", "服装设计", "时装设计"]],
    ["visual-arts", "Visual arts", "视觉艺术", ["visual arts", "fine art", "gallery", "illustration", "graphic design", "视觉艺术", "当代艺术", "画廊", "插画", "平面设计"]],
    ["photography", "Photography", "摄影", ["photography", "photo studio", "摄影", "影楼"]],
    ["crafts", "Crafts", "工艺", ["crafts", "handmade", "ceramics", "jewelry", "工艺", "手工艺", "陶瓷", "珠宝"]],
  ]],
  ["education", "Education & Training", "教育与培训", ["education", "school", "training", "教育", "培训", "学校"], [
    ["k12", "K-12", "K12 教育", ["k12", "k 12", "primary school", "secondary school", "kindergarten", "中小学", "幼儿园", "k12"]],
    ["higher-education", "Higher education", "高等教育", ["university", "college", "higher education", "高校", "大学", "高等教育"]],
    ["vocational-education", "Vocational education", "职业教育", ["vocational", "technical school", "职业教育", "职业院校", "职业培训"]],
    ["edtech", "Online education & EdTech", "在线教育与教育科技", ["edtech", "online learning", "e learning", "在线教育", "教育科技"]],
    ["study-abroad", "Study-abroad services", "留学服务", ["study abroad", "admissions consulting", "留学", "留学中介", "留学咨询"]],
    ["language-training", "Language training", "语言培训", ["language school", "english training", "test prep", "语言培训", "英语培训", "雅思培训"]],
  ]],
  ["law-government", "Law, Government & Public Affairs", "法律与政务", ["law", "government", "public affairs", "法律", "政务"], [
    ["law-firms", "Law firms", "律师事务所", ["law firm", "legal practice", "律所", "律师事务所"]],
    ["corporate-legal", "Corporate legal", "企业法务", ["in house legal", "corporate legal", "legal department", "法务部", "企业法务"]],
    ["government", "Government & public sector", "政府与公共部门", ["government", "public sector", "ministry", "agency", "政府", "机关", "公共部门", "事业单位"]],
    ["international-organizations", "International organisations", "国际组织", ["united nations", "world bank", "international organization", "un agency", "联合国", "国际组织", "世界银行"]],
    ["ngo", "NGOs & nonprofits", "NGO 与公益", ["ngo", "nonprofit", "non profit", "charity", "公益", "非营利", "ngo"]],
    ["policy-research", "Policy research", "政策研究", ["think tank", "policy research", "public policy", "智库", "政策研究"]],
  ]],
  ["professional-services", "Professional Services & Consulting", "专业服务与咨询", ["professional services", "consulting", "专业服务", "咨询"], [
    ["management-consulting", "Management consulting", "管理咨询", ["management consulting", "strategy consulting", "mbb", "管理咨询", "战略咨询", "咨询公司"]],
    ["hr-recruiting", "HR & executive search", "人力资源与猎头", ["staffing", "recruitment agency", "executive search", "hr services", "人力资源服务", "猎头", "人力外包"]],
    ["public-relations", "Public relations", "公关", ["public relations", "pr agency", "communications agency", "公关", "公关公司"]],
    ["market-research", "Market research", "市场研究", ["market research", "consumer research", "survey", "市场调研", "市场研究"]],
    ["translation-localization", "Translation & localisation", "翻译与本地化", ["translation", "localization", "localisation", "翻译公司", "本地化"]],
  ]],
  ["real-estate-construction", "Real Estate & Construction", "房地产与建筑工程", ["real estate", "construction", "property", "房地产", "建筑", "工程"], [
    ["real-estate-development", "Real estate development", "地产开发", ["real estate developer", "property development", "地产", "房地产开发", "开发商"]],
    ["building-design-engineering", "Building design & engineering", "建筑设计与工程", ["engineering design", "civil engineering", "construction company", "general contractor", "建筑设计院", "施工", "土木工程", "总包"]],
    ["property-facilities", "Property & facilities management", "物业与设施", ["property management", "facility management", "物业", "设施管理"]],
    ["urban-planning", "Urban planning", "城市规划", ["urban planning", "city planning", "城市规划", "规划院"]],
    ["building-materials", "Building materials", "建材", ["building materials", "cement", "glass", "建材", "水泥", "玻璃"]],
  ]],
  ["transport-logistics", "Transport, Logistics & Supply Chain", "交通物流与供应链", ["logistics", "transportation", "supply chain", "物流", "交通", "供应链"], [
    ["logistics-express", "Logistics & express delivery", "物流与快递", ["logistics", "courier", "express delivery", "warehousing", "3pl", "物流", "快递", "仓储"]],
    ["shipping-ports", "Shipping & ports", "航运与港口", ["shipping", "port", "maritime", "freight forwarding", "航运", "港口", "海运", "货代"]],
    ["aviation-airports", "Aviation & airports", "航空与机场", ["airline", "airport", "aviation", "航空公司", "机场", "民航"]],
    ["rail-transit", "Rail & urban transit", "铁路与城轨", ["railway", "metro", "rail transit", "铁路", "地铁", "城轨", "高铁"]],
    ["supply-chain-management", "Supply chain management", "供应链管理", ["supply chain", "procurement", "sourcing", "trade", "供应链", "采购", "外贸"]],
  ]],
  ["agriculture-food", "Agriculture & Food Tech", "农业与食品科技", ["agriculture", "farming", "food tech", "农业", "食品科技"], [
    ["modern-agriculture", "Modern agriculture", "现代农业", ["farm", "agriculture", "greenhouse", "种植", "农场", "现代农业"]],
    ["agtech", "Agricultural technology", "农业科技", ["agtech", "precision agriculture", "seeds", "农业科技", "智慧农业", "种业"]],
    ["food-tech", "Food technology", "食品科技", ["food technology", "alternative protein", "food science", "食品科技", "替代蛋白", "食品研发"]],
    ["aquaculture-livestock", "Aquaculture & livestock", "水产与畜牧", ["aquaculture", "livestock", "dairy", "poultry", "水产", "畜牧", "养殖"]],
    ["agri-trade", "Agricultural trade", "农产品贸易", ["agricultural trade", "commodities", "grain", "农产品贸易", "粮食贸易"]],
  ]],
  ["basic-sciences", "Basic Sciences", "基础科学", ["science", "research institute", "基础科学", "科研院所"], [
    ["mathematics", "Mathematics", "数学", ["mathematics", "math", "statistics", "数学", "统计学"]],
    ["physics", "Physics", "物理", ["physics", "quantum", "物理", "量子"]],
    ["chemistry", "Chemistry", "化学", ["chemistry", "chemical", "化学"]],
    ["biology", "Biology", "生物", ["biology", "life science", "neuroscience", "生物", "生命科学", "神经科学"]],
    ["earth-space", "Earth & space sciences", "地球与空间科学", ["geology", "climate science", "astronomy", "space science", "地质", "气象", "天文", "空间科学"]],
    ["materials-science", "Materials science", "材料科学", ["materials science", "材料科学", "材料学"]],
  ]],
  ["social-sciences-humanities", "Social Sciences & Humanities", "社会科学与人文", ["social science", "humanities", "社会科学", "人文"], [
    ["economics", "Economics", "经济学", ["economics", "econometrics", "经济学", "计量经济"]],
    ["psychology", "Psychology", "心理学", ["psychology", "cognitive science", "心理学", "认知科学"]],
    ["sociology-anthropology", "Sociology & anthropology", "社会学与人类学", ["sociology", "anthropology", "社会学", "人类学"]],
    ["history-philosophy", "History & philosophy", "历史与哲学", ["history", "philosophy", "archaeology", "历史", "哲学", "考古"]],
    ["language-literature", "Languages & literature", "语言与文学", ["linguistics", "literature", "语言学", "文学"]],
    ["politics-ir", "Politics & international relations", "政治与国际关系", ["political science", "international relations", "政治学", "国际关系"]],
  ]],
  ["hospitality-lifestyle", "Travel, Hospitality & Lifestyle Services", "旅游酒店与生活服务", ["hospitality", "travel", "lifestyle services", "旅游", "酒店", "生活服务"], [
    ["hotels-homestays", "Hotels & homestays", "酒店与民宿", ["hotel", "resort", "homestay", "酒店", "民宿", "度假村"]],
    ["travel-airline-services", "Travel & airline services", "旅游与航空服务", ["travel agency", "tour operator", "airline service", "旅行社", "旅游", "航空服务"]],
    ["food-service", "Restaurants & food service", "餐饮", ["restaurant", "catering", "food service", "cafe", "餐饮", "餐厅", "咖啡店", "茶饮"]],
    ["fitness-sports", "Fitness & sports", "健身与运动", ["fitness", "gym", "sports club", "健身", "健身房", "运动"]],
    ["beauty-wellness", "Beauty & wellness", "美容与养生", ["salon", "spa", "beauty salon", "美容", "美发", "养生", "美甲"]],
    ["weddings-events", "Weddings & events", "婚庆与活动", ["wedding", "event planning", "events agency", "婚庆", "婚礼", "活动策划"]],
  ]],
  ["public-nonprofit", "Public Interest & Nonprofit", "公共事业与非营利", ["nonprofit", "public interest", "公益", "非营利"], [
    ["education-philanthropy", "Education philanthropy", "教育公益", ["education nonprofit", "teach for", "教育公益", "支教"]],
    ["environmental-nonprofit", "Environmental nonprofits", "环保公益", ["environmental nonprofit", "conservation", "环保公益", "环保组织", "自然保护"]],
    ["community-services", "Community services", "社区服务", ["community service", "social services", "social work", "社区服务", "社工", "社会服务"]],
    ["charities-foundations", "Charities & foundations", "慈善与基金会", ["foundation", "charity", "philanthropy", "基金会", "慈善"]],
  ]],
];

export const INDUSTRY_TREE: readonly IndustryTreeNode[] = DATA.map(([slug, en, zh, keywords, subs]) => ({
  code: slug,
  label: bi(en, zh),
  parent: null,
  keywords,
  children: subs.map(([sub, sen, szh, skw]) => ({ code: `${slug}.${sub}`, label: bi(sen, szh), parent: slug, keywords: skw })),
}));

/** Every industry (top level first, each followed by its children). */
export const INDUSTRIES: readonly IndustryDef[] = INDUSTRY_TREE.flatMap((t) => [
  { code: t.code, label: t.label, parent: null, keywords: t.keywords },
  ...t.children,
]);

export const TOP_LEVEL_INDUSTRIES: readonly IndustryDef[] = INDUSTRIES.filter((i) => i.parent === null);
export const SECOND_LEVEL_INDUSTRIES: readonly IndustryDef[] = INDUSTRIES.filter((i) => i.parent !== null);

const BY_CODE = new Map<string, IndustryDef>(INDUSTRIES.map((i) => [i.code, i]));

export function isIndustryCode(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value);
}

export function getIndustry(code: string): IndustryDef {
  const def = BY_CODE.get(code);
  if (!def) throw new Error(`Unknown industry: ${code}`);
  return def;
}

/** Top-level code of any industry code (`finance.banking` → `finance`). */
export function topLevelIndustry(code: string): string {
  return getIndustry(code).parent ?? code;
}

export function industryChildren(code: string): IndustryDef[] {
  return SECOND_LEVEL_INDUSTRIES.filter((i) => i.parent === code);
}

export function industryLabel(code: string, locale: Locale | string): string {
  return localize(getIndustry(code).label, locale);
}

let matcher: ReturnType<typeof createPhraseMatcher> | null = null;

/**
 * Maps free text (an organisation description, a sector line in a deck) to industry codes.
 * Second-level matches are preferred over their parent at equal score.
 */
export function mapIndustry(text: string, opts: MatchOptions = {}): PhraseMatch[] {
  matcher ??= createPhraseMatcher(INDUSTRIES.map((i) => ({ code: i.code, phrases: [i.label.en, i.label.zh, ...i.keywords] })));
  const results = matcher(text, { limit: 50, minScore: opts.minScore ?? 0.5 });
  results.sort((a, b) => b.score - a.score || Number(b.code.includes(".")) - Number(a.code.includes(".")) || a.code.localeCompare(b.code));
  return results.slice(0, opts.limit ?? 5);
}
