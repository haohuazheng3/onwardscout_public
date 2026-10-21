/**
 * Occupations (plan §3, third level): common occupations across every industry and function —
 * software and data, hardware and manufacturing, skilled trades, healthcare, law and finance,
 * education, the public sector, creative work, research, hospitality and startups. Each sits at
 * one industry × one function, with English and Chinese title variants as aliases.
 *
 * People never pick from this list: `mapOccupation(title)` maps a résumé title or a free-text
 * answer (English or Chinese) to codes. `identity` is a hint for licensed or trade occupations
 * (P*, E7, E8, C*…) used when pre-selecting identities. Codes double as `/careers/<code>` slugs.
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { createPhraseMatcher, type MatchOptions, type PhraseMatch } from "./text";
import { functionIdSchema, identityCodeSchema, type FunctionId, type IdentityCode } from "./types";

export interface OccupationDef {
  code: string;
  label: Bilingual;
  /** Industry code (top or second level) from industries.ts. */
  industry: string;
  function: FunctionId;
  /** Title variants and synonyms, English and Chinese. */
  aliases: string[];
  identity?: IdentityCode;
}

export const occupationDefSchema = z.object({
  code: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label: bilingualSchema,
  industry: z.string().min(1),
  function: functionIdSchema,
  aliases: z.array(z.string().trim().min(1)),
  identity: identityCodeSchema.optional(),
});

const SW = "software-internet";
const AI = "ai-data";
const HW = "hardware-electronics";
const MFG = "advanced-manufacturing";
const EN = "energy-environment";
const HC = "life-sciences-healthcare";
const FIN = "finance";
const CON = "consumer-retail";
const MED = "media-entertainment";
const DES = "design-arts";
const EDU = "education";
const LAW = "law-government";
const PRO = "professional-services";
const RE = "real-estate-construction";
const TRN = "transport-logistics";
const AGR = "agriculture-food";
const SCI = "basic-sciences";
const SOC = "social-sciences-humanities";
const HOS = "hospitality-lifestyle";
const NPO = "public-nonprofit";

const o = (code: string, en: string, zh: string, industry: string, fn: FunctionId, aliases: string[], identity?: IdentityCode): OccupationDef => ({
  code,
  label: bi(en, zh),
  industry,
  function: fn,
  aliases,
  ...(identity ? { identity } : {}),
});

export const OCCUPATIONS: readonly OccupationDef[] = [
  /* ================================================================ software & internet */
  o("software-engineer", "Software Engineer", "软件工程师", SW, "engineering", ["software developer", "developer", "programmer", "coder", "swe", "sde", "software development engineer", "application developer", "开发工程师", "程序员", "研发工程师", "软件开发工程师", "软件开发"]),
  o("frontend-engineer", "Front-end Engineer", "前端工程师", SW, "engineering", ["frontend engineer", "frontend developer", "front end developer", "react developer", "vue developer", "javascript developer", "ui engineer", "前端开发", "前端开发工程师", "web前端"]),
  o("backend-engineer", "Back-end Engineer", "后端工程师", SW, "engineering", ["backend engineer", "backend developer", "back end developer", "server engineer", "java developer", "golang developer", "python developer", "api engineer", "后端开发", "后端开发工程师", "服务端开发", "java开发工程师", "java工程师", "go开发工程师", "c++开发工程师", "python开发工程师"]),
  o("full-stack-engineer", "Full-stack Engineer", "全栈工程师", SW, "engineering", ["full stack developer", "fullstack developer", "fullstack engineer", "全栈开发"]),
  o("mobile-engineer", "Mobile Engineer", "移动端开发工程师", `${SW}.application-software`, "engineering", ["mobile developer", "ios developer", "ios engineer", "android developer", "android engineer", "flutter developer", "react native developer", "app developer", "ios开发", "安卓开发", "android开发工程师", "ios开发工程师", "客户端开发", "移动开发"]),
  o("web-developer", "Web Developer", "网站开发工程师", SW, "engineering", ["website developer", "wordpress developer", "webmaster", "php developer", "网页开发", "网站开发"]),
  o("game-developer", "Game Developer", "游戏开发工程师", `${SW}.gaming`, "engineering", ["game programmer", "unity developer", "unreal developer", "gameplay engineer", "game engineer", "游戏开发", "游戏客户端开发", "游戏程序", "u3d开发"]),
  o("game-designer", "Game Designer", "游戏策划", `${SW}.gaming`, "product", ["level designer", "systems designer", "narrative designer", "游戏设计师", "关卡设计", "数值策划", "系统策划", "关卡策划"]),
  o("devops-engineer", "DevOps Engineer", "DevOps 工程师", `${SW}.cloud-infrastructure`, "engineering", ["devops", "platform engineer", "build engineer", "release engineer", "ci cd engineer", "运维开发", "运维开发工程师", "devops工程师"]),
  o("site-reliability-engineer", "Site Reliability Engineer", "站点可靠性工程师（SRE）", `${SW}.cloud-infrastructure`, "engineering", ["sre", "reliability engineer", "运维工程师", "sre工程师", "系统运维"]),
  o("cloud-engineer", "Cloud Engineer", "云计算工程师", `${SW}.cloud-infrastructure`, "engineering", ["cloud architect", "aws engineer", "azure engineer", "cloud infrastructure engineer", "云架构师", "云平台工程师", "云计算"]),
  o("solutions-architect", "Solutions Architect", "解决方案架构师", SW, "engineering", ["solution architect", "technical architect", "enterprise architect", "方案架构师", "解决方案工程师"]),
  o("software-architect", "Software Architect", "软件架构师", SW, "engineering", ["system architect", "技术架构师", "系统架构师", "架构师"]),
  o("security-engineer", "Security Engineer", "安全工程师", `${SW}.cybersecurity`, "engineering", ["application security engineer", "appsec engineer", "cybersecurity engineer", "information security engineer", "网络安全工程师", "信息安全工程师", "安全开发"]),
  o("security-analyst", "Security Analyst", "安全分析师", `${SW}.cybersecurity`, "engineering", ["soc analyst", "cybersecurity analyst", "information security analyst", "threat analyst", "安全运营", "安全分析"]),
  o("penetration-tester", "Penetration Tester", "渗透测试工程师", `${SW}.cybersecurity`, "engineering", ["pentester", "ethical hacker", "red team engineer", "渗透测试", "白帽黑客"]),
  o("qa-engineer", "QA / Test Engineer", "测试工程师", SW, "quality", ["qa engineer", "quality assurance engineer", "software tester", "test engineer", "sdet", "automation tester", "test automation engineer", "qa", "软件测试", "测试开发", "测试开发工程师", "软件测试工程师"]),
  o("embedded-engineer", "Embedded Software Engineer", "嵌入式软件工程师", `${HW}.iot`, "engineering", ["embedded developer", "firmware engineer", "embedded systems engineer", "嵌入式开发", "嵌入式工程师", "固件工程师", "单片机开发"]),
  o("blockchain-engineer", "Blockchain Engineer", "区块链工程师", `${SW}.blockchain`, "engineering", ["smart contract developer", "solidity developer", "web3 developer", "blockchain developer", "区块链开发", "智能合约开发"]),
  o("engineering-manager", "Engineering Manager", "研发经理", SW, "engineering", ["software engineering manager", "software development manager", "head of engineering", "director of engineering", "tech lead", "技术经理", "研发总监", "技术总监", "技术负责人"]),
  o("technical-writer", "Technical Writer", "技术文档工程师", SW, "creative", ["documentation engineer", "api writer", "technical author", "技术写作", "技术文档"]),
  o("it-support-specialist", "IT Support Specialist", "IT 支持专员", SW, "operations", ["help desk technician", "it technician", "desktop support", "service desk analyst", "it support", "网管", "it运维", "桌面运维", "it支持"]),
  o("systems-administrator", "Systems Administrator", "系统管理员", SW, "engineering", ["sysadmin", "system administrator", "linux administrator", "系统管理", "系统工程师"]),
  o("network-engineer", "Network Engineer", "网络工程师", `${HW}.telecom-equipment`, "engineering", ["network administrator", "network architect", "网络管理员", "网络运维"]),
  o("database-administrator", "Database Administrator", "数据库管理员", SW, "engineering", ["dba", "database engineer", "数据库工程师", "数据库运维"]),
  o("developer-advocate", "Developer Advocate", "开发者关系工程师", `${SW}.developer-tools`, "marketing", ["developer relations", "devrel", "developer evangelist", "技术布道师", "开发者关系"]),
  o("technical-program-manager", "Technical Program Manager", "技术项目经理", SW, "project-strategy", ["tpm", "technical project manager", "engineering program manager", "技术项目管理"]),
  o("erp-consultant", "ERP / Implementation Consultant", "实施顾问", `${SW}.saas`, "project-strategy", ["implementation consultant", "sap consultant", "oracle consultant", "salesforce consultant", "erp实施顾问", "实施工程师", "sap顾问"]),
  o("indie-developer", "Indie Developer / Solo Founder", "独立开发者", SW, "engineering", ["indie hacker", "solo founder", "solopreneur", "one person company", "独立开发", "一人公司", "个人开发者"], "F5"),
  o("freelance-developer", "Freelance Developer", "自由开发者", SW, "engineering", ["freelance software developer", "contract developer", "freelance programmer", "外包开发", "自由职业程序员", "接单程序员"], "C6"),

  /* ================================================================ AI & data */
  o("machine-learning-engineer", "Machine Learning Engineer", "机器学习工程师", `${AI}.ml-platforms`, "engineering", ["ml engineer", "mle", "algorithm engineer", "ai engineer", "deep learning engineer", "算法工程师", "机器学习算法工程师", "深度学习工程师", "ai工程师", "推荐算法工程师", "搜索算法工程师"]),
  o("ai-research-scientist", "AI Research Scientist", "AI 研究科学家", `${AI}.generative-ai`, "research", ["ai researcher", "machine learning researcher", "ml researcher", "research scientist machine learning", "ai研究员", "算法研究员", "人工智能研究员"], "R4"),
  o("llm-application-engineer", "LLM Application Engineer", "大模型应用工程师", `${AI}.generative-ai`, "engineering", ["prompt engineer", "ai application engineer", "generative ai engineer", "llm engineer", "applied ai engineer", "大模型工程师", "大模型算法工程师", "aigc工程师", "提示词工程师", "ai应用开发", "大模型应用开发", "大模型开发"]),
  o("computer-vision-engineer", "Computer Vision Engineer", "计算机视觉工程师", `${AI}.computer-vision`, "engineering", ["cv engineer", "image processing engineer", "视觉算法工程师", "图像算法工程师", "cv算法工程师"]),
  o("nlp-engineer", "NLP Engineer", "自然语言处理工程师", `${AI}.speech-nlp`, "engineering", ["natural language processing engineer", "speech recognition engineer", "nlp算法工程师", "语音算法工程师", "nlp工程师"]),
  o("mlops-engineer", "MLOps Engineer", "MLOps 工程师", `${AI}.ml-platforms`, "engineering", ["ml platform engineer", "machine learning infrastructure engineer", "ai infra engineer", "机器学习平台工程师", "ai平台工程师"]),
  o("data-scientist", "Data Scientist", "数据科学家", `${AI}.data-science`, "data", ["applied scientist", "decision scientist", "数据科学", "数据挖掘工程师", "数据挖掘"]),
  o("data-analyst", "Data Analyst", "数据分析师", `${AI}.data-science`, "data", ["reporting analyst", "insights analyst", "sql analyst", "analytics specialist", "数据分析", "商业数据分析师"]),
  o("data-engineer", "Data Engineer", "数据工程师", `${AI}.data-science`, "data", ["big data engineer", "etl developer", "data platform engineer", "analytics engineer", "数据开发", "大数据开发工程师", "数仓工程师", "数据仓库工程师", "etl工程师"]),
  o("bi-analyst", "Business Intelligence Analyst", "商业智能分析师", `${AI}.data-science`, "data", ["bi analyst", "bi developer", "tableau developer", "power bi developer", "bi工程师", "bi分析师"]),
  o("robotics-engineer", "Robotics Engineer", "机器人工程师", `${AI}.robotics-autonomy`, "engineering", ["robot engineer", "ros engineer", "motion planning engineer", "机器人算法工程师", "机器人开发", "运动控制工程师"]),
  o("autonomous-driving-engineer", "Autonomous Driving Engineer", "自动驾驶工程师", `${AI}.robotics-autonomy`, "engineering", ["self driving engineer", "adas engineer", "perception engineer", "planning and control engineer", "自动驾驶算法工程师", "感知算法工程师", "规控工程师", "智驾工程师"]),
  o("data-annotator", "Data Annotation Specialist", "数据标注员", AI, "operations", ["data labeler", "annotator", "data labeling specialist", "ai trainer", "rater", "数据标注", "标注员", "ai训练师"]),
  o("statistician", "Statistician", "统计师", `${SCI}.mathematics`, "data", ["biostatistician", "statistical analyst", "统计分析师", "生物统计师"]),
  o("quantitative-researcher", "Quantitative Researcher", "量化研究员", `${FIN}.asset-management`, "research", ["quant", "quant researcher", "quantitative analyst", "quant developer", "量化分析师", "量化研究", "量化开发"]),

  /* ================================================================ hardware & electronics */
  o("hardware-engineer", "Hardware Engineer", "硬件工程师", HW, "engineering", ["electronics engineer", "pcb designer", "circuit design engineer", "hardware design engineer", "硬件开发", "电路设计工程师", "pcb工程师"]),
  o("ic-design-engineer", "IC Design Engineer", "芯片设计工程师", `${HW}.semiconductors`, "engineering", ["asic engineer", "chip design engineer", "digital ic designer", "analog ic designer", "rtl engineer", "vlsi engineer", "数字ic设计", "模拟ic设计", "ic设计工程师", "芯片工程师"]),
  o("ic-verification-engineer", "IC Verification Engineer", "芯片验证工程师", `${HW}.semiconductors`, "engineering", ["design verification engineer", "dv engineer", "asic verification engineer", "ic验证工程师", "验证工程师"]),
  o("semiconductor-process-engineer", "Semiconductor Process Engineer", "半导体工艺工程师", `${HW}.semiconductors`, "manufacturing", ["fab process engineer", "wafer process engineer", "etch engineer", "lithography engineer", "工艺整合工程师", "晶圆工艺工程师", "半导体工艺"]),
  o("electrical-engineer", "Electrical Engineer", "电气工程师", MFG, "engineering", ["electrical design engineer", "power electronics engineer", "电气设计工程师", "电力电子工程师"], "P4"),
  o("rf-engineer", "RF Engineer", "射频工程师", `${HW}.telecom-equipment`, "engineering", ["radio frequency engineer", "antenna engineer", "wireless engineer", "天线工程师", "无线通信工程师"]),
  o("telecom-engineer", "Telecommunications Engineer", "通信工程师", `${HW}.telecom-equipment`, "engineering", ["communications engineer", "5g engineer", "network optimization engineer", "网络优化工程师", "通信技术"]),
  o("optical-engineer", "Optical Engineer", "光学工程师", `${HW}.optoelectronics`, "engineering", ["optics engineer", "photonics engineer", "display engineer", "光学设计", "光电工程师", "显示工程师"]),
  o("hardware-test-engineer", "Hardware Test Engineer", "硬件测试工程师", HW, "quality", ["validation engineer", "reliability test engineer", "product test engineer", "硬件测试", "可靠性工程师"]),
  o("instrument-engineer", "Instrumentation Engineer", "仪器仪表工程师", `${HW}.precision-instruments`, "engineering", ["instrument engineer", "measurement engineer", "metrology engineer", "仪表工程师", "计量工程师"]),
  o("hardware-product-manager", "Hardware Product Manager", "硬件产品经理", `${HW}.consumer-electronics`, "product", ["consumer electronics product manager", "硬件产品", "智能硬件产品经理"]),
  o("field-service-engineer", "Field Service Engineer", "现场服务工程师", `${HW}.precision-instruments`, "customer-success", ["field engineer", "service engineer", "售后工程师", "现场工程师", "安装调试工程师"]),

  /* ================================================================ manufacturing & skilled trades */
  o("mechanical-engineer", "Mechanical Engineer", "机械工程师", `${MFG}.machinery`, "engineering", ["mechanical design engineer", "机械设计工程师", "机械设计", "结构设计工程师"], "P4"),
  o("manufacturing-engineer", "Manufacturing Engineer", "制造工程师", MFG, "manufacturing", ["production engineer", "industrial engineer", "ie engineer", "工业工程师", "ie工程师", "生产工程师"]),
  o("process-engineer", "Process Engineer", "工艺工程师", MFG, "manufacturing", ["process development engineer", "工艺员"]),
  o("automation-engineer", "Automation Engineer", "自动化工程师", MFG, "engineering", ["plc engineer", "controls engineer", "control systems engineer", "电气自动化工程师", "plc工程师"]),
  o("automotive-engineer", "Automotive Engineer", "汽车工程师", `${MFG}.automotive-ev`, "engineering", ["vehicle engineer", "powertrain engineer", "chassis engineer", "ev engineer", "整车工程师", "汽车研发工程师", "三电工程师", "底盘工程师"]),
  o("aerospace-engineer", "Aerospace Engineer", "航空航天工程师", `${MFG}.aerospace`, "engineering", ["aeronautical engineer", "avionics engineer", "propulsion engineer", "飞行器设计", "航空工程师", "航天工程师"]),
  o("materials-engineer", "Materials Engineer", "材料工程师", `${MFG}.advanced-materials`, "engineering", ["polymer engineer", "metallurgical engineer", "材料研发工程师", "高分子工程师"]),
  o("cae-engineer", "CAE / Simulation Engineer", "仿真工程师", `${MFG}.industrial-software`, "engineering", ["simulation engineer", "fea engineer", "cfd engineer", "cae工程师", "仿真分析"]),
  o("additive-manufacturing-engineer", "Additive Manufacturing Engineer", "增材制造工程师", `${MFG}.additive-manufacturing`, "engineering", ["3d printing engineer", "3d打印工程师"]),
  o("chemical-engineer", "Chemical Engineer", "化学工程师", MFG, "engineering", ["chemical process engineer", "化工工程师", "化工工艺"], "P4"),
  o("production-manager", "Production Manager", "生产经理", MFG, "manufacturing", ["plant manager", "factory manager", "production supervisor", "manufacturing manager", "生产主管", "厂长", "车间主任"]),
  o("production-worker", "Production Worker", "生产操作工", MFG, "manufacturing", ["assembly line worker", "factory worker", "machine operator", "assembler", "production operator", "普工", "操作工", "装配工", "流水线工人", "生产工人"], "E7"),
  o("cnc-machinist", "CNC Machinist", "数控机床操作工", `${MFG}.machinery`, "manufacturing", ["machinist", "cnc operator", "cnc programmer", "数控车工", "数控编程", "车工", "铣工"], "E7"),
  o("welder", "Welder", "焊工", MFG, "manufacturing", ["welding technician", "fabricator", "电焊工", "焊接技工"], "E7"),
  o("electrician", "Electrician", "电工", RE, "manufacturing", ["electrical technician", "maintenance electrician", "维修电工", "持证电工"], "E7"),
  o("maintenance-technician", "Maintenance Technician", "设备维修技术员", MFG, "manufacturing", ["maintenance mechanic", "equipment technician", "设备维护", "机修工", "设备维修"], "E7"),
  o("automotive-technician", "Automotive Technician", "汽车维修技师", `${MFG}.automotive-ev`, "manufacturing", ["auto mechanic", "car mechanic", "vehicle technician", "汽修", "汽车维修工", "汽车机修"], "E7"),
  o("aircraft-mechanic", "Aircraft Maintenance Technician", "飞机维修工程师", `${TRN}.aviation-airports`, "manufacturing", ["aircraft mechanic", "a and p mechanic", "aviation maintenance technician", "机务", "飞机维修", "航空机务"], "E7"),
  o("forklift-operator", "Forklift Operator", "叉车司机", TRN, "supply-chain", ["forklift driver", "叉车工"], "E7"),
  o("plumber", "Plumber", "水暖工", RE, "manufacturing", ["pipefitter", "plumbing technician", "管道工", "水电工"], "E7"),
  o("hvac-technician", "HVAC Technician", "暖通空调技术员", RE, "manufacturing", ["refrigeration technician", "air conditioning technician", "空调维修", "制冷工"], "E7"),
  o("carpenter", "Carpenter", "木工", RE, "manufacturing", ["joiner", "woodworker", "cabinet maker", "木匠"], "E7"),
  o("construction-worker", "Construction Worker", "建筑工人", RE, "manufacturing", ["laborer", "construction laborer", "mason", "bricklayer", "泥瓦工", "建筑工"], "E7"),
  o("quality-engineer", "Quality Engineer", "质量工程师", MFG, "quality", ["qe", "supplier quality engineer", "sqe", "quality control engineer", "sqe工程师", "品质工程师", "qe工程师"]),
  o("quality-inspector", "Quality Inspector", "质检员", MFG, "quality", ["qc inspector", "quality control inspector", "qc", "品检员", "检验员", "质检"], "E7"),
  o("quality-manager", "Quality Manager", "质量经理", MFG, "quality", ["qa manager", "quality assurance manager", "quality director", "品质经理", "质量主管", "质量总监"]),

  /* ================================================================ energy & environment */
  o("solar-engineer", "Solar / PV Engineer", "光伏工程师", `${EN}.solar-wind`, "engineering", ["pv engineer", "photovoltaic engineer", "solar design engineer", "光伏研发", "光伏工艺工程师"]),
  o("wind-turbine-technician", "Wind Turbine Technician", "风电运维技术员", `${EN}.solar-wind`, "manufacturing", ["wind technician", "风电运维", "风机运维"], "E7"),
  o("battery-engineer", "Battery Engineer", "电池工程师", `${EN}.energy-storage`, "engineering", ["battery cell engineer", "bms engineer", "energy storage engineer", "电池研发工程师", "bms工程师", "储能工程师", "电芯工程师"]),
  o("power-systems-engineer", "Power Systems Engineer", "电力系统工程师", `${EN}.power-grid`, "engineering", ["power engineer", "grid engineer", "substation engineer", "电力工程师", "电网工程师", "变电工程师"]),
  o("petroleum-engineer", "Petroleum Engineer", "石油工程师", `${EN}.oil-gas`, "engineering", ["drilling engineer", "reservoir engineer", "oil and gas engineer", "钻井工程师", "油藏工程师"]),
  o("environmental-engineer", "Environmental Engineer", "环境工程师", `${EN}.environment-carbon`, "engineering", ["environmental consultant", "water treatment engineer", "ehs engineer", "环保工程师", "水处理工程师", "ehs工程师"]),
  o("sustainability-manager", "Sustainability / ESG Manager", "可持续发展经理", `${EN}.environment-carbon`, "project-strategy", ["esg manager", "esg analyst", "carbon manager", "sustainability consultant", "climate analyst", "esg经理", "碳管理", "双碳顾问", "碳资产管理"]),
  o("hydrogen-engineer", "Hydrogen / Fuel Cell Engineer", "氢能工程师", `${EN}.hydrogen`, "engineering", ["fuel cell engineer", "electrolyzer engineer", "氢能研发", "燃料电池工程师"]),
  o("energy-analyst", "Energy Analyst", "能源分析师", EN, "data", ["energy market analyst", "power trading analyst", "能源分析", "电力交易员"]),

  /* ================================================================ healthcare & life sciences */
  o("physician", "Physician", "医生", `${HC}.hospitals-clinical`, "clinical", ["doctor", "medical doctor", "attending physician", "clinician", "临床医生", "医师", "主治医师", "主任医师", "大夫"], "P1"),
  o("surgeon", "Surgeon", "外科医生", `${HC}.hospitals-clinical`, "clinical", ["general surgeon", "orthopedic surgeon", "外科医师", "骨科医生"], "P1"),
  o("general-practitioner", "General Practitioner", "全科医生", `${HC}.hospitals-clinical`, "clinical", ["gp", "family physician", "family doctor", "primary care physician", "全科医师", "家庭医生"], "P1"),
  o("resident-physician", "Resident Physician", "住院医师", `${HC}.hospitals-clinical`, "clinical", ["resident", "medical resident", "junior doctor", "house officer", "规培医生", "住院医", "规培住院医师"], "P1"),
  o("pediatrician", "Pediatrician", "儿科医生", `${HC}.hospitals-clinical`, "clinical", ["paediatrician", "儿科医师"], "P1"),
  o("psychiatrist", "Psychiatrist", "精神科医生", `${HC}.hospitals-clinical`, "clinical", ["精神科医师"], "P1"),
  o("anesthesiologist", "Anesthesiologist", "麻醉科医生", `${HC}.hospitals-clinical`, "clinical", ["anaesthetist", "麻醉医生", "麻醉师"], "P1"),
  o("dentist", "Dentist", "口腔医生", `${HC}.consumer-health`, "clinical", ["dental surgeon", "orthodontist", "牙医", "口腔科医生", "牙科医生", "正畸医生"], "P1"),
  o("pharmacist", "Pharmacist", "药师", HC, "clinical", ["clinical pharmacist", "药剂师", "执业药师", "临床药师"], "P1"),
  o("registered-nurse", "Registered Nurse", "注册护士", `${HC}.hospitals-clinical`, "clinical", ["rn", "staff nurse", "nurse", "icu nurse", "er nurse", "clinical nurse", "护士", "护师", "主管护师", "临床护士", "责任护士"], "P1"),
  o("nurse-practitioner", "Nurse Practitioner", "高级实践护士", `${HC}.hospitals-clinical`, "clinical", ["np", "advanced practice nurse", "family nurse practitioner", "fnp", "专科护士"], "P1"),
  o("midwife", "Midwife", "助产士", `${HC}.hospitals-clinical`, "clinical", ["certified nurse midwife", "助产护士"], "P1"),
  o("physical-therapist", "Physical Therapist", "康复治疗师", `${HC}.hospitals-clinical`, "clinical", ["physiotherapist", "physical therapy", "物理治疗师", "康复师", "理疗师"], "P1"),
  o("occupational-therapist", "Occupational Therapist", "作业治疗师", `${HC}.hospitals-clinical`, "clinical", ["ot", "作业治疗"], "P1"),
  o("speech-therapist", "Speech-Language Pathologist", "言语治疗师", `${HC}.hospitals-clinical`, "clinical", ["speech therapist", "slp", "言语康复师", "语言治疗师"], "P1"),
  o("radiologic-technologist", "Radiologic Technologist", "放射技师", `${HC}.hospitals-clinical`, "clinical", ["radiographer", "x ray technician", "ct technologist", "mri technologist", "sonographer", "影像技师", "放射科技师", "超声医师"], "P1"),
  o("medical-lab-technologist", "Medical Laboratory Scientist", "医学检验技师", `${HC}.diagnostics-genomics`, "clinical", ["medical technologist", "clinical laboratory scientist", "lab technologist", "检验科", "检验师", "医学检验"], "P1"),
  o("paramedic", "Paramedic / EMT", "急救员", `${HC}.public-health`, "clinical", ["emt", "emergency medical technician", "ambulance crew", "急救医生", "院前急救"], "P1"),
  o("physician-assistant", "Physician Assistant", "医师助理", `${HC}.hospitals-clinical`, "clinical", ["pa c", "physician associate", "医生助理"], "P1"),
  o("clinical-psychologist", "Clinical Psychologist", "临床心理师", `${HC}.hospitals-clinical`, "clinical", ["psychologist", "clinical psychology", "心理治疗师", "临床心理学家"], "P6"),
  o("counselor", "Counselor / Therapist", "心理咨询师", `${SOC}.psychology`, "clinical", ["therapist", "mental health counselor", "psychotherapist", "licensed professional counselor", "lpc", "marriage and family therapist", "school counselor", "心理咨询", "心理健康顾问"], "P6"),
  o("veterinarian", "Veterinarian", "兽医", `${AGR}.aquaculture-livestock`, "clinical", ["vet", "veterinary surgeon", "dvm", "宠物医生", "执业兽医"]),
  o("veterinary-technician", "Veterinary Technician", "兽医助理", `${CON}.pets`, "clinical", ["vet tech", "veterinary nurse", "动物医学助理", "宠物医院助理"]),
  o("dietitian", "Dietitian / Nutritionist", "营养师", `${HC}.consumer-health`, "clinical", ["nutritionist", "registered dietitian", "clinical nutritionist", "注册营养师", "临床营养师", "公共营养师"], "P1"),
  o("optometrist", "Optometrist", "验光师", `${HC}.consumer-health`, "clinical", ["optician", "eye doctor", "验光员", "视光师"], "P1"),
  o("tcm-practitioner", "Traditional Chinese Medicine Practitioner", "中医师", `${HC}.hospitals-clinical`, "clinical", ["tcm doctor", "chinese medicine practitioner", "acupuncturist", "中医", "中医医生", "针灸师"], "P1"),
  o("caregiver", "Caregiver / Care Assistant", "护理员", `${HC}.consumer-health`, "clinical", ["home health aide", "care worker", "nursing assistant", "cna", "personal care aide", "elderly caregiver", "护工", "养老护理员", "陪护"], "E8"),
  o("dental-hygienist", "Dental Hygienist", "口腔卫生士", `${HC}.consumer-health`, "clinical", ["dental assistant", "牙科助理", "口腔护士"]),
  o("genetic-counselor", "Genetic Counselor", "遗传咨询师", `${HC}.diagnostics-genomics`, "clinical", ["遗传咨询"]),
  o("medical-representative", "Medical Sales Representative", "医药代表", `${HC}.pharma`, "sales", ["pharmaceutical sales representative", "medical device sales", "pharma rep", "医药销售", "医疗器械销售"]),
  o("hospital-administrator", "Healthcare Administrator", "医院管理人员", `${HC}.hospitals-clinical`, "admin", ["hospital manager", "practice manager", "clinic manager", "healthcare manager", "医院管理", "诊所经理", "医务科"]),
  o("public-health-specialist", "Public Health Specialist", "公共卫生专员", `${HC}.public-health`, "research", ["epidemiologist", "public health analyst", "health program officer", "流行病学家", "疾控", "公共卫生医师", "公卫"]),
  o("health-manager", "Health Manager / Coach", "健康管理师", `${HC}.consumer-health`, "customer-success", ["health coach", "wellness coach", "健康顾问", "健康管理"]),
  o("clinical-research-associate", "Clinical Research Associate", "临床监查员（CRA）", `${HC}.pharma`, "research", ["cra", "clinical monitor", "clinical trial monitor", "临床监查"]),
  o("clinical-research-coordinator", "Clinical Research Coordinator", "临床研究协调员（CRC）", `${HC}.hospitals-clinical`, "research", ["crc", "study coordinator", "clinical trial coordinator", "临床协调员"]),
  o("drug-discovery-scientist", "Drug Discovery Scientist", "药物研发科学家", `${HC}.pharma`, "research", ["pharmaceutical scientist", "medicinal chemist", "pharmacologist", "formulation scientist", "药物研发", "药物化学", "药理研究员", "制剂研究员", "新药研发"]),
  o("bioprocess-engineer", "Bioprocess Engineer", "生物工艺工程师", `${HC}.pharma`, "manufacturing", ["process development scientist", "upstream engineer", "downstream engineer", "cmc", "生物工艺", "细胞培养工程师", "纯化工程师"]),
  o("regulatory-affairs-specialist", "Regulatory Affairs Specialist", "注册事务专员", `${HC}.pharma`, "legal", ["regulatory affairs", "ra specialist", "regulatory specialist", "注册专员", "药品注册", "医疗器械注册", "法规事务"]),
  o("medical-science-liaison", "Medical Science Liaison", "医学联络官（MSL）", `${HC}.pharma`, "research", ["msl", "medical advisor", "medical affairs manager", "医学事务", "医学经理", "医学联络"]),
  o("biomedical-engineer", "Biomedical Engineer", "生物医学工程师", `${HC}.medical-devices`, "engineering", ["medical device engineer", "bioengineer", "医疗器械研发工程师", "生物医学工程"]),
  o("bioinformatician", "Bioinformatician", "生物信息分析师", `${HC}.diagnostics-genomics`, "data", ["bioinformatics scientist", "computational biologist", "genomics analyst", "生物信息", "生信分析", "生信工程师"]),
  o("qc-analyst", "QC Analyst", "质量控制分析员", `${HC}.pharma`, "quality", ["quality control analyst", "qc chemist", "qc microbiologist", "qc分析员", "质控", "qc专员"]),
  o("lab-technician", "Laboratory Technician", "实验员", SCI, "research", ["lab tech", "research technician", "laboratory assistant", "实验技术员", "实验室技术员", "实验助理"]),

  /* ================================================================ finance */
  o("accountant", "Accountant", "会计", `${FIN}.accounting-audit`, "finance", ["staff accountant", "general ledger accountant", "cpa", "chartered accountant", "cost accountant", "会计师", "注册会计师", "总账会计", "成本会计", "财务会计"], "P3"),
  o("auditor", "Auditor", "审计师", `${FIN}.accounting-audit`, "finance", ["external auditor", "internal auditor", "audit associate", "audit senior", "审计", "内审", "审计员", "审计专员"], "P3"),
  o("tax-advisor", "Tax Advisor", "税务师", `${FIN}.accounting-audit`, "finance", ["tax consultant", "tax accountant", "tax manager", "税务顾问", "注册税务师", "税务经理", "税务专员"], "P3"),
  o("bookkeeper", "Bookkeeper", "出纳与记账员", `${FIN}.accounting-audit`, "finance", ["accounts payable clerk", "accounts receivable clerk", "ap specialist", "ar specialist", "出纳", "记账员", "应付会计", "应收会计"]),
  o("financial-analyst", "Financial Analyst", "财务分析师", FIN, "finance", ["fp and a analyst", "finance analyst", "corporate finance analyst", "财务分析", "经营分析", "财务bp"]),
  o("finance-manager", "Finance Manager", "财务经理", FIN, "finance", ["controller", "financial controller", "finance director", "head of finance", "财务主管", "财务总监", "财务负责人"]),
  o("investment-banker", "Investment Banker", "投行分析师", `${FIN}.securities-ib`, "finance", ["investment banking analyst", "investment banking associate", "ib analyst", "m and a analyst", "投行", "投资银行", "并购分析师"]),
  o("equity-research-analyst", "Equity Research Analyst", "行业研究员", `${FIN}.securities-ib`, "research", ["research analyst", "sell side analyst", "buy side analyst", "证券分析师", "卖方研究员", "买方研究员", "行研"]),
  o("portfolio-manager", "Portfolio Manager", "基金经理", `${FIN}.asset-management`, "finance", ["fund manager", "investment manager", "asset manager", "投资组合经理"]),
  o("vc-investor", "Venture Capital Investor", "风险投资人", `${FIN}.vc-pe`, "finance", ["venture capitalist", "vc associate", "vc analyst", "investment associate", "venture partner", "投资经理", "投资人", "风投", "投资总监", "投资分析师"]),
  o("private-equity-associate", "Private Equity Associate", "私募股权投资经理", `${FIN}.vc-pe`, "finance", ["pe associate", "private equity analyst", "buyout associate", "pe投资", "私募股权"]),
  o("risk-manager", "Risk Manager", "风险管理经理", FIN, "finance", ["risk analyst", "credit risk analyst", "market risk analyst", "operational risk manager", "风控", "风险经理", "风控专员", "风险分析师", "信贷风控"]),
  o("compliance-officer", "Compliance Officer", "合规专员", FIN, "legal", ["compliance analyst", "compliance manager", "aml analyst", "kyc analyst", "合规经理", "反洗钱专员", "合规"]),
  o("actuary", "Actuary", "精算师", `${FIN}.insurance`, "finance", ["actuarial analyst", "精算分析师"], "P7"),
  o("credit-analyst", "Credit Analyst / Loan Officer", "信贷经理", `${FIN}.banking`, "finance", ["loan officer", "credit officer", "mortgage loan officer", "信贷员", "授信审批"]),
  o("bank-teller", "Bank Teller", "银行柜员", `${FIN}.banking`, "customer-success", ["teller", "bank clerk", "柜员", "大堂经理"], "E8"),
  o("relationship-manager", "Relationship Manager", "银行客户经理", `${FIN}.banking`, "sales", ["private banker", "wealth manager", "banking relationship manager", "理财经理", "私人银行家", "财富顾问"]),
  o("financial-advisor", "Financial Advisor", "理财规划师", `${FIN}.asset-management`, "sales", ["financial planner", "cfp", "wealth advisor", "investment advisor", "理财顾问", "理财师"], "P7"),
  o("trader", "Trader", "交易员", `${FIN}.securities-ib`, "finance", ["equity trader", "fx trader", "commodities trader", "sales and trading", "期货交易员", "外汇交易员"], "P7"),
  o("insurance-agent", "Insurance Agent", "保险代理人", `${FIN}.insurance`, "sales", ["insurance broker", "insurance sales", "保险经纪人", "保险销售", "保险顾问"]),
  o("insurance-underwriter", "Insurance Underwriter", "核保员", `${FIN}.insurance`, "finance", ["underwriter", "核保", "核保师"]),
  o("claims-adjuster", "Claims Adjuster", "理赔专员", `${FIN}.insurance`, "customer-success", ["claims specialist", "claims handler", "理赔", "理赔员"]),
  o("investor-relations-manager", "Investor Relations Manager", "投资者关系经理", FIN, "finance", ["ir manager", "investor relations", "证券事务代表", "投资者关系"]),
  o("fintech-product-manager", "Fintech Product Manager", "金融科技产品经理", `${FIN}.fintech-payments`, "product", ["payments product manager", "支付产品经理", "金融产品经理"]),
  o("cfo", "Chief Financial Officer", "首席财务官", FIN, "executive", ["cfo", "finance chief", "财务总监 cfo"]),

  /* ================================================================ legal */
  o("lawyer", "Lawyer", "律师", `${LAW}.law-firms`, "legal", ["attorney", "solicitor", "barrister", "associate attorney", "litigator", "law firm partner", "执业律师", "诉讼律师", "非诉律师", "合伙人律师", "律所律师", "实习律师"], "P2"),
  o("in-house-counsel", "In-house Counsel", "企业法务", `${LAW}.corporate-legal`, "legal", ["corporate counsel", "legal counsel", "general counsel", "legal manager", "法务", "法务经理", "法务专员", "法律顾问", "总法律顾问"], "P2"),
  o("paralegal", "Paralegal", "律师助理", `${LAW}.law-firms`, "legal", ["legal assistant", "law clerk", "legal secretary", "法律助理"]),
  o("patent-agent", "Patent Agent / IP Specialist", "专利代理师", `${LAW}.law-firms`, "legal", ["patent attorney", "ip specialist", "intellectual property specialist", "trademark agent", "专利代理人", "知识产权专员", "专利工程师", "商标代理"], "P2"),
  o("judge", "Judge", "法官", `${LAW}.government`, "legal", ["magistrate", "法官助理"], "E6"),
  o("prosecutor", "Prosecutor", "检察官", `${LAW}.government`, "legal", ["district attorney", "public prosecutor", "检察官助理"], "E6"),
  o("notary", "Notary", "公证员", LAW, "legal", ["notary public", "公证"]),
  o("contract-manager", "Contract Manager", "合同管理专员", `${LAW}.corporate-legal`, "legal", ["contracts administrator", "contract specialist", "合同专员", "合同管理"]),

  /* ================================================================ people & HR */
  o("hr-generalist", "HR Generalist", "人事专员", `${PRO}.hr-recruiting`, "people", ["hr specialist", "human resources specialist", "hr coordinator", "hr assistant", "personnel specialist", "人事", "人力资源专员", "hr专员", "人事助理"]),
  o("hr-business-partner", "HR Business Partner", "人力资源业务伙伴（HRBP）", `${PRO}.hr-recruiting`, "people", ["hrbp", "人力资源业务伙伴", "业务hr"]),
  o("hr-manager", "HR Manager", "人力资源经理", `${PRO}.hr-recruiting`, "people", ["human resources manager", "head of people", "people manager", "hr director", "人事经理", "人力资源总监", "hr经理", "hrd"]),
  o("recruiter", "Recruiter", "招聘专员", `${PRO}.hr-recruiting`, "people", ["talent acquisition specialist", "technical recruiter", "corporate recruiter", "talent partner", "sourcer", "招聘", "招聘经理", "招聘顾问"]),
  o("headhunter", "Headhunter / Executive Search Consultant", "猎头顾问", `${PRO}.hr-recruiting`, "sales", ["executive search consultant", "agency recruiter", "search consultant", "recruitment consultant", "猎头", "寻访顾问"]),
  o("compensation-benefits-specialist", "Compensation & Benefits Specialist", "薪酬福利专员", `${PRO}.hr-recruiting`, "people", ["comp and ben", "c and b", "payroll specialist", "total rewards specialist", "薪酬专员", "薪酬福利", "薪资专员", "薪酬经理"]),
  o("learning-development-specialist", "Learning & Development Specialist", "培训专员", `${PRO}.hr-recruiting`, "people", ["training specialist", "l and d", "corporate trainer", "training manager", "培训经理", "企业培训师", "企业培训"]),
  o("chro", "Chief Human Resources Officer", "首席人力资源官", `${PRO}.hr-recruiting`, "executive", ["chro", "chief people officer", "人力资源副总裁"]),

  /* ================================================================ administration */
  o("administrative-assistant", "Administrative Assistant", "行政助理", PRO, "admin", ["admin assistant", "secretary", "office assistant", "clerk", "administrative coordinator", "行政专员", "秘书", "文员", "行政"]),
  o("executive-assistant", "Executive Assistant", "总裁助理", PRO, "admin", ["ea", "personal assistant", "assistant to the ceo", "总经理助理", "总助", "ceo助理", "高管助理"]),
  o("office-manager", "Office Manager", "行政经理", PRO, "admin", ["administration manager", "facilities coordinator", "行政主管", "办公室主任"]),
  o("receptionist", "Receptionist", "前台", HOS, "admin", ["front desk", "front desk receptionist", "front office", "前台接待"], "E8"),
  o("data-entry-clerk", "Data Entry Clerk", "数据录入员", PRO, "admin", ["data entry", "typist", "录入员"]),

  /* ================================================================ projects & strategy */
  o("project-manager", "Project Manager", "项目经理", PRO, "project-strategy", ["project lead", "project coordinator", "pmp", "项目管理", "项目主管", "项目专员", "项目助理"]),
  o("program-manager", "Program Manager", "项目群经理", PRO, "project-strategy", ["program lead", "program director", "项目总监"]),
  o("pmo-specialist", "PMO Specialist", "PMO 专员", PRO, "project-strategy", ["pmo", "project management office", "pmo经理"]),
  o("management-consultant", "Management Consultant", "管理咨询顾问", `${PRO}.management-consulting`, "project-strategy", ["strategy consultant", "consultant", "business consultant", "associate consultant", "咨询顾问", "管理咨询", "战略咨询顾问", "咨询师"]),
  o("business-analyst", "Business Analyst", "业务分析师", PRO, "project-strategy", ["business systems analyst", "requirements analyst", "商业分析师", "业务分析", "需求分析师"]),
  o("strategy-manager", "Strategy Manager", "战略经理", PRO, "project-strategy", ["corporate strategy manager", "strategy analyst", "corporate development", "business strategy manager", "战略分析师", "战略规划", "战略投资"]),
  o("chief-of-staff", "Chief of Staff", "幕僚长", PRO, "executive", ["cos", "总裁办主任", "ceo办公室负责人"]),
  o("operations-manager", "Operations Manager", "运营经理", PRO, "operations", ["operations lead", "business operations manager", "bizops", "ops manager", "运营主管", "运营总监", "运营负责人"]),
  o("market-research-analyst", "Market Research Analyst", "市场研究员", `${PRO}.market-research`, "marketing", ["market researcher", "consumer insights analyst", "research executive", "市场调研", "市场研究", "消费者洞察"]),
  o("consultant-independent", "Independent Consultant", "独立顾问", `${PRO}.management-consulting`, "project-strategy", ["freelance consultant", "independent advisor", "fractional executive", "自由顾问", "企业顾问"], "C7"),
  o("coach", "Coach (Career, Life or Executive)", "教练", PRO, "teaching", ["career coach", "life coach", "executive coach", "leadership coach", "business coach", "职业规划师", "生涯教练", "高管教练"], "C7"),

  /* ================================================================ product */
  o("product-manager", "Product Manager", "产品经理", SW, "product", ["pm", "product lead", "technical product manager", "growth product manager", "ai product manager", "group product manager", "product director", "head of product", "产品负责人", "产品总监", "产品专员", "产品助理", "ai产品经理", "策略产品经理", "b端产品经理", "c端产品经理"]),
  o("product-owner", "Product Owner", "产品所有者（PO）", SW, "product", ["po", "scrum product owner"]),
  o("product-analyst", "Product Analyst", "产品分析师", SW, "data", ["product data analyst", "growth analyst", "产品数据分析", "增长分析师"]),
  o("cpo", "Chief Product Officer", "首席产品官", SW, "executive", ["cpo", "vp product", "vp of product", "产品副总裁"]),

  /* ================================================================ design */
  o("ux-designer", "UX Designer", "用户体验设计师", `${DES}.ux-product-design`, "design", ["user experience designer", "interaction designer", "ixd", "ux ui designer", "ui ux designer", "交互设计师", "交互设计", "ux设计师", "体验设计师"], "C1"),
  o("ui-designer", "UI Designer", "UI 设计师", `${DES}.ux-product-design`, "design", ["user interface designer", "app designer", "ui设计", "界面设计师", "ui设计师"], "C1"),
  o("product-designer", "Product Designer", "产品设计师", `${DES}.ux-product-design`, "design", ["digital product designer", "产品设计"], "C1"),
  o("ux-researcher", "UX Researcher", "用户研究员", `${DES}.ux-product-design`, "research", ["user researcher", "design researcher", "usability researcher", "用户研究", "用研", "用户体验研究员"]),
  o("graphic-designer", "Graphic Designer", "平面设计师", `${DES}.visual-arts`, "design", ["visual designer", "communication designer", "layout designer", "平面设计", "视觉设计师", "美工", "视觉设计"], "C1"),
  o("brand-designer", "Brand Designer", "品牌设计师", DES, "design", ["brand identity designer", "logo designer", "品牌视觉设计", "vi设计师", "品牌设计"], "C1"),
  o("motion-designer", "Motion Designer", "动效设计师", DES, "design", ["motion graphics designer", "mg动画师", "动效设计", "动态设计师"], "C1"),
  o("illustrator", "Illustrator", "插画师", `${DES}.visual-arts`, "creative", ["digital illustrator", "concept artist", "character designer", "插画", "原画师", "角色原画", "概念设计师"], "C1"),
  o("3d-artist", "3D Artist", "3D 设计师", DES, "design", ["3d modeler", "3d designer", "cg artist", "blender artist", "3d建模师", "建模师", "三维设计师", "c4d设计师"], "C1"),
  o("game-artist", "Game Artist", "游戏美术", `${SW}.gaming`, "design", ["technical artist", "game art designer", "游戏美术设计师", "游戏原画", "技术美术", "游戏特效师"], "C1"),
  o("industrial-designer", "Industrial Designer", "工业设计师", `${DES}.industrial-design`, "design", ["product design engineer", "industrial design", "工业设计", "外观设计师", "产品外观设计"], "C1"),
  o("interior-designer", "Interior Designer", "室内设计师", `${DES}.architecture-landscape`, "design", ["interior architect", "space designer", "室内设计", "软装设计师", "家装设计师"], "C1"),
  o("fashion-designer", "Fashion Designer", "服装设计师", `${DES}.fashion-design`, "design", ["apparel designer", "clothing designer", "womenswear designer", "服装设计", "时装设计师", "服设"], "C1"),
  o("jewelry-designer", "Jewelry Designer", "珠宝设计师", `${DES}.crafts`, "design", ["jewellery designer", "首饰设计师", "珠宝设计"], "C9"),
  o("art-director", "Art Director", "艺术总监", `${MED}.advertising-marketing`, "creative", ["creative director", "design director", "美术指导", "创意总监", "设计总监"], "C1"),
  o("architect", "Architect", "建筑师", `${RE}.building-design-engineering`, "design", ["registered architect", "project architect", "architectural designer", "建筑设计师", "注册建筑师", "建筑设计"], "P4"),
  o("landscape-architect", "Landscape Architect", "景观设计师", `${DES}.architecture-landscape`, "design", ["landscape designer", "景观设计", "园林设计师"], "P4"),
  o("urban-planner", "Urban Planner", "城市规划师", `${RE}.urban-planning`, "project-strategy", ["city planner", "town planner", "regional planner", "城市规划", "规划师", "国土空间规划"], "P4"),
  o("photographer", "Photographer", "摄影师", `${DES}.photography`, "creative", ["photojournalist", "commercial photographer", "wedding photographer", "product photographer", "摄影", "商业摄影师", "婚礼摄影师"], "C3"),
  o("ceramicist", "Ceramic Artist", "陶艺师", `${DES}.crafts`, "creative", ["potter", "ceramics artist", "陶艺家", "陶艺"], "C9"),
  o("craftsperson", "Craftsperson / Artisan", "手工艺人", `${DES}.crafts`, "creative", ["artisan", "maker", "leather craftsman", "handmade maker", "手作人", "匠人", "手艺人"], "C9"),

  /* ================================================================ media, content & creative */
  o("writer", "Writer", "作家", `${MED}.publishing`, "creative", ["author", "novelist", "freelance writer", "content writer", "作者", "小说家", "撰稿人", "网文作者", "自由撰稿人"], "C2"),
  o("copywriter", "Copywriter", "文案", `${MED}.advertising-marketing`, "marketing", ["advertising copywriter", "creative copywriter", "ux writer", "文案策划", "广告文案"], "C2"),
  o("screenwriter", "Screenwriter", "编剧", `${MED}.film-tv`, "creative", ["scriptwriter", "playwright", "script writer", "剧本作者"], "C2"),
  o("journalist", "Journalist", "记者", `${MED}.news-media`, "creative", ["reporter", "correspondent", "news reporter", "investigative journalist", "新闻记者"]),
  o("editor", "Editor", "编辑", `${MED}.publishing`, "creative", ["copy editor", "managing editor", "content editor", "news editor", "book editor", "责任编辑", "内容编辑", "新媒体编辑", "主编"], "C2"),
  o("content-creator", "Content Creator", "内容创作者", `${MED}.live-streaming-short-video`, "creative", ["creator", "influencer", "blogger", "vlogger", "youtuber", "tiktoker", "kol", "up主", "博主", "网红", "自媒体", "达人", "小红书博主", "抖音博主"], "C4"),
  o("live-streamer", "Live Streamer / Host", "主播", `${MED}.live-streaming-short-video`, "creative", ["streamer", "twitch streamer", "live commerce host", "livestream host", "带货主播", "直播主播", "游戏主播"], "C4"),
  o("podcaster", "Podcaster", "播客主播", `${MED}.news-media`, "creative", ["podcast host", "podcast producer", "播客"], "C4"),
  o("broadcast-host", "TV / Radio Host", "主持人", `${MED}.news-media`, "creative", ["presenter", "anchor", "news anchor", "radio host", "mc", "emcee", "节目主持人", "电台主持人", "新闻主播"]),
  o("film-director", "Film Director", "导演", `${MED}.film-tv`, "creative", ["filmmaker", "video director", "commercial director", "电影导演"], "C3"),
  o("film-producer", "Producer (Film & TV)", "制片人", `${MED}.film-tv`, "creative", ["producer", "tv producer", "executive producer", "line producer", "video producer", "制片", "节目制作人", "监制"]),
  o("videographer", "Videographer", "摄像师", `${MED}.film-tv`, "creative", ["camera operator", "cinematographer", "director of photography", "摄像", "摄影指导", "视频拍摄"], "C3"),
  o("video-editor", "Video Editor", "视频剪辑师", `${MED}.live-streaming-short-video`, "creative", ["film editor", "post production editor", "剪辑师", "后期剪辑", "视频后期", "剪辑"], "C3"),
  o("animator", "Animator", "动画师", `${MED}.film-tv`, "creative", ["2d animator", "3d animator", "character animator", "动画设计师"], "C1"),
  o("actor", "Actor", "演员", `${MED}.film-tv`, "creative", ["actress", "performer", "voice actor", "配音演员", "配音员"], "C5"),
  o("musician", "Musician", "音乐人", `${MED}.music`, "creative", ["singer", "songwriter", "composer", "music producer", "instrumentalist", "band member", "歌手", "作曲", "作曲家", "词曲作者", "音乐制作人", "乐手", "独立音乐人"], "C5"),
  o("sound-engineer", "Sound Engineer", "音频工程师", `${MED}.music`, "creative", ["audio engineer", "mixing engineer", "sound designer", "录音师", "混音师", "音效设计师", "调音师"], "C5"),
  o("visual-artist", "Visual Artist", "艺术家", `${DES}.visual-arts`, "creative", ["artist", "painter", "sculptor", "fine artist", "contemporary artist", "printmaker", "画家", "雕塑家", "当代艺术家"], "C5"),
  o("curator", "Curator", "策展人", `${DES}.visual-arts`, "creative", ["exhibition curator", "museum curator", "gallery manager", "策展", "展览策划"]),
  o("dancer", "Dancer / Choreographer", "舞者", MED, "creative", ["choreographer", "dance artist", "舞蹈演员", "编舞"], "C5"),
  o("translator", "Translator", "翻译", `${PRO}.translation-localization`, "creative", ["freelance translator", "translation specialist", "笔译", "英语翻译", "日语翻译"], "C8"),
  o("interpreter", "Interpreter", "口译员", `${PRO}.translation-localization`, "creative", ["conference interpreter", "simultaneous interpreter", "sign language interpreter", "口译", "同声传译", "同传", "交传"], "C8"),
  o("localization-specialist", "Localization Specialist", "本地化专员", `${PRO}.translation-localization`, "operations", ["localization manager", "l10n specialist", "game localization specialist", "本地化", "本地化经理"], "C8"),
  o("stylist", "Stylist", "造型师", `${CON}.fashion-luxury`, "creative", ["fashion stylist", "wardrobe stylist", "personal stylist", "服装搭配师", "形象设计师"]),
  o("makeup-artist", "Makeup Artist", "化妆师", `${HOS}.beauty-wellness`, "creative", ["mua", "beauty artist", "化妆造型师", "彩妆师"]),
  o("model", "Model", "模特", `${CON}.fashion-luxury`, "creative", ["fashion model", "commercial model", "平面模特"]),
  o("esports-player", "Esports Player", "电竞选手", `${MED}.sports-esports`, "creative", ["pro gamer", "professional gamer", "职业选手"]),
  o("athlete", "Athlete", "运动员", `${MED}.sports-esports`, "creative", ["professional athlete", "sportsperson", "职业运动员"]),
  o("sports-coach", "Sports Coach", "体育教练", `${MED}.sports-esports`, "teaching", ["athletic coach", "football coach", "basketball coach", "运动教练", "球队教练"]),

  /* ================================================================ marketing */
  o("marketing-manager", "Marketing Manager", "市场经理", `${MED}.advertising-marketing`, "marketing", ["marketing lead", "head of marketing", "marketing director", "marketing specialist", "市场营销经理", "市场总监", "市场专员", "营销经理"]),
  o("digital-marketing-specialist", "Digital Marketing Specialist", "数字营销专员", `${MED}.advertising-marketing`, "marketing", ["online marketing specialist", "digital marketer", "performance marketer", "sem specialist", "ppc specialist", "paid media specialist", "投放专员", "信息流投放", "sem专员", "效果广告", "数字营销", "网络营销"]),
  o("growth-marketer", "Growth Marketer", "增长经理", SW, "marketing", ["growth manager", "growth hacker", "user acquisition manager", "ua manager", "用户增长", "增长黑客"]),
  o("seo-specialist", "SEO Specialist", "SEO 专员", `${MED}.advertising-marketing`, "marketing", ["seo manager", "search engine optimization specialist", "seo", "seo优化"]),
  o("content-marketer", "Content Marketing Manager", "内容营销经理", `${MED}.advertising-marketing`, "marketing", ["content strategist", "content marketing specialist", "content manager", "内容营销", "内容策划"]),
  o("social-media-manager", "Social Media Manager", "社交媒体运营", `${MED}.advertising-marketing`, "marketing", ["social media specialist", "social media coordinator", "新媒体运营", "社媒运营", "微博运营", "公众号运营", "小红书运营", "抖音运营"]),
  o("brand-manager", "Brand Manager", "品牌经理", `${CON}.fmcg`, "marketing", ["brand marketing manager", "assistant brand manager", "品牌专员", "品牌策划", "品牌营销"]),
  o("product-marketing-manager", "Product Marketing Manager", "产品市场经理", SW, "marketing", ["pmm", "product marketer", "产品营销", "产品市场"]),
  o("pr-specialist", "Public Relations Specialist", "公关专员", `${PRO}.public-relations`, "marketing", ["pr manager", "communications manager", "media relations", "communications specialist", "公关", "公关经理", "媒介经理", "媒介专员", "品牌公关"]),
  o("event-manager", "Event Manager", "活动策划", `${HOS}.weddings-events`, "marketing", ["event planner", "event coordinator", "conference organizer", "events manager", "活动执行", "会展策划", "活动经理", "会议策划"]),
  o("media-buyer", "Media Buyer / Planner", "媒介策划", `${MED}.advertising-marketing`, "marketing", ["media planner", "programmatic trader", "媒介购买"]),
  o("advertising-account-manager", "Advertising Account Manager", "广告客户经理", `${MED}.advertising-marketing`, "sales", ["account director", "client service manager", "客户执行", "广告ae"]),
  o("influencer-marketing-manager", "Influencer Marketing Manager", "达人营销经理", `${MED}.advertising-marketing`, "marketing", ["kol manager", "creator partnerships manager", "达人营销", "kol投放", "达人商务"]),
  o("cmo", "Chief Marketing Officer", "首席营销官", `${MED}.advertising-marketing`, "executive", ["cmo", "vp marketing", "市场副总裁"]),

  /* ================================================================ operations (internet & commerce) */
  o("ecommerce-operations", "E-commerce Operations Specialist", "电商运营", `${SW}.ecommerce`, "operations", ["ecommerce manager", "amazon seller", "marketplace manager", "online store manager", "shopify manager", "电商运营专员", "店铺运营", "天猫运营", "淘宝运营", "亚马逊运营", "跨境电商运营"]),
  o("content-operations", "Content Operations Specialist", "内容运营", `${SW}.social-content`, "operations", ["content moderator", "content specialist", "内容运营专员", "审核员", "内容审核"]),
  o("user-operations", "User Operations Specialist", "用户运营", `${SW}.consumer-internet`, "operations", ["user growth operations", "member operations", "用户运营专员", "会员运营", "私域运营", "社群运营"]),
  o("community-manager", "Community Manager", "社区经理", `${SW}.social-content`, "operations", ["community lead", "community builder", "discord manager", "社区运营"]),
  o("operations-specialist", "Operations Specialist", "运营专员", SW, "operations", ["operations associate", "operations coordinator", "运营", "运营助理", "活动运营", "产品运营"]),

  /* ================================================================ sales & customer success */
  o("sales-representative", "Sales Representative", "销售代表", CON, "sales", ["sales rep", "salesperson", "inside sales", "sales executive", "销售", "销售专员", "业务员", "电话销售"]),
  o("account-executive", "Account Executive", "大客户销售", `${SW}.saas`, "sales", ["ae", "enterprise account executive", "saas sales", "客户代表"]),
  o("sales-development-representative", "Sales Development Representative", "销售开发代表", `${SW}.saas`, "sales", ["sdr", "bdr", "business development representative", "lead generation specialist", "电销"]),
  o("account-manager", "Account Manager", "客户经理", PRO, "sales", ["key account manager", "kam", "client manager", "大客户经理", "ka经理"]),
  o("sales-manager", "Sales Manager", "销售经理", CON, "sales", ["head of sales", "sales director", "regional sales manager", "area sales manager", "销售主管", "销售总监", "区域经理", "大区经理"]),
  o("business-development-manager", "Business Development Manager", "商务拓展经理", PRO, "sales", ["bd manager", "bd", "partnerships manager", "business developer", "商务经理", "商务拓展", "bd经理", "合作伙伴经理", "商务"]),
  o("sales-engineer", "Sales Engineer / Pre-sales", "售前工程师", `${SW}.saas`, "sales", ["presales engineer", "pre sales consultant", "solutions engineer", "technical sales", "售前", "售前顾问", "解决方案销售"]),
  o("channel-sales-manager", "Channel Sales Manager", "渠道经理", CON, "sales", ["channel manager", "partner sales manager", "distribution manager", "渠道销售", "渠道拓展", "经销商管理"]),
  o("retail-sales-associate", "Retail Sales Associate", "门店销售", `${CON}.retail-chains`, "sales", ["shop assistant", "sales associate", "store associate", "retail associate", "导购", "店员", "营业员"], "E8"),
  o("cashier", "Cashier", "收银员", `${CON}.retail-chains`, "customer-success", ["checkout operator", "收银"], "E8"),
  o("store-manager", "Store Manager", "店长", `${CON}.retail-chains`, "operations", ["shop manager", "retail manager", "assistant store manager", "门店经理", "店铺经理"], "E8"),
  o("real-estate-agent", "Real Estate Agent", "房产经纪人", `${RE}.real-estate-development`, "sales", ["realtor", "property agent", "estate agent", "real estate broker", "leasing agent", "房地产经纪人", "房产中介", "置业顾问", "租赁顾问"]),
  o("foreign-trade-specialist", "Foreign Trade Specialist", "外贸业务员", `${TRN}.supply-chain-management`, "sales", ["import export specialist", "international sales", "export sales", "trade specialist", "外贸", "外贸专员", "外贸业务", "国际贸易专员", "外贸销售"]),
  o("car-sales-consultant", "Car Sales Consultant", "汽车销售顾问", `${MFG}.automotive-ev`, "sales", ["car salesperson", "auto sales consultant", "汽车销售", "4s店销售"], "E8"),
  o("customer-success-manager", "Customer Success Manager", "客户成功经理", `${SW}.saas`, "customer-success", ["csm", "customer success", "client success manager", "客户成功"]),
  o("customer-service-representative", "Customer Service Representative", "客服专员", CON, "customer-success", ["customer service", "customer support representative", "call center agent", "customer care", "support agent", "客服", "在线客服", "电话客服", "售后客服", "客服代表"], "E8"),
  o("technical-support-engineer", "Technical Support Engineer", "技术支持工程师", SW, "customer-success", ["support engineer", "application support", "customer support engineer", "技术支持", "售后技术支持", "技术服务工程师"]),

  /* ================================================================ supply chain & transport */
  o("supply-chain-manager", "Supply Chain Manager", "供应链经理", `${TRN}.supply-chain-management`, "supply-chain", ["supply chain analyst", "demand planner", "supply planner", "s and op manager", "供应链", "计划员", "需求计划", "物控", "pmc"]),
  o("procurement-specialist", "Procurement Specialist", "采购专员", `${TRN}.supply-chain-management`, "supply-chain", ["purchasing agent", "sourcing specialist", "category manager", "purchasing manager", "采购", "采购经理", "采购工程师", "寻源经理"]),
  o("retail-buyer", "Retail Buyer / Merchandiser", "买手", `${CON}.fashion-luxury`, "supply-chain", ["fashion buyer", "merchandiser", "商品企划", "商品经理"]),
  o("logistics-coordinator", "Logistics Coordinator", "物流专员", `${TRN}.logistics-express`, "supply-chain", ["logistics specialist", "logistics manager", "shipping coordinator", "transportation planner", "物流", "物流经理", "物流主管", "运输调度"]),
  o("warehouse-manager", "Warehouse Manager", "仓库主管", `${TRN}.logistics-express`, "supply-chain", ["warehouse supervisor", "distribution center manager", "inventory manager", "仓储经理", "仓库经理"]),
  o("warehouse-worker", "Warehouse Associate", "仓储作业员", `${TRN}.logistics-express`, "supply-chain", ["picker", "packer", "order picker", "stocker", "warehouse worker", "material handler", "拣货员", "打包员", "理货员", "仓库管理员", "仓管"], "E7"),
  o("truck-driver", "Truck Driver", "货车司机", `${TRN}.logistics-express`, "supply-chain", ["lorry driver", "hgv driver", "cdl driver", "long haul driver", "卡车司机", "大车司机"], "E7"),
  o("delivery-driver", "Delivery Driver / Courier", "快递员", `${TRN}.logistics-express`, "supply-chain", ["courier", "delivery rider", "food delivery rider", "van driver", "外卖骑手", "配送员", "骑手", "送货司机"], "E8"),
  o("freight-forwarder", "Freight Forwarder", "货代", `${TRN}.shipping-ports`, "supply-chain", ["freight agent", "shipping agent", "logistics broker", "货运代理", "货代操作", "订舱"]),
  o("customs-broker", "Customs Broker", "报关员", `${TRN}.shipping-ports`, "supply-chain", ["customs specialist", "customs declarant", "customs clearance specialist", "报关", "关务专员", "报检员"]),
  o("dispatcher", "Dispatcher", "调度员", TRN, "operations", ["fleet dispatcher", "调度"]),
  o("pilot", "Pilot", "飞行员", `${TRN}.aviation-airports`, "operations", ["airline pilot", "first officer", "commercial pilot", "机长", "副驾驶"]),
  o("flight-attendant", "Flight Attendant", "空乘", `${HOS}.travel-airline-services`, "customer-success", ["cabin crew", "steward", "stewardess", "空姐", "空中乘务员", "乘务员"], "E8"),
  o("air-traffic-controller", "Air Traffic Controller", "空中交通管制员", `${TRN}.aviation-airports`, "operations", ["atc", "管制员"]),
  o("airport-ground-staff", "Airport Ground Staff", "机场地勤", `${TRN}.aviation-airports`, "customer-success", ["ground crew", "check in agent", "airport agent", "地勤", "值机"], "E8"),
  o("ship-officer", "Ship Officer / Seafarer", "船员", `${TRN}.shipping-ports`, "operations", ["seafarer", "mariner", "deck officer", "ship captain", "海员", "船长", "大副", "轮机员"]),
  o("train-driver", "Train Driver", "列车司机", `${TRN}.rail-transit`, "operations", ["locomotive engineer", "train operator", "metro driver", "地铁司机", "火车司机", "动车司机"], "E7"),
  o("bus-driver", "Bus or Ride-hailing Driver", "公交与网约车司机", TRN, "operations", ["taxi driver", "ride hailing driver", "uber driver", "chauffeur", "网约车司机", "出租车司机", "公交司机", "滴滴司机"], "E8"),

  /* ================================================================ real estate & construction */
  o("civil-engineer", "Civil Engineer", "土木工程师", `${RE}.building-design-engineering`, "engineering", ["structural engineer", "geotechnical engineer", "bridge engineer", "highway engineer", "结构工程师", "岩土工程师", "桥梁工程师", "道路工程师", "土木工程"], "P4"),
  o("construction-manager", "Construction Manager", "工程项目经理", RE, "project-strategy", ["construction project manager", "site manager", "site engineer", "施工经理", "工程经理", "施工员", "建筑项目经理"]),
  o("quantity-surveyor", "Quantity Surveyor / Cost Engineer", "造价工程师", RE, "finance", ["cost estimator", "estimator", "cost engineer", "造价", "预算员", "工程造价"], "P4"),
  o("mep-engineer", "MEP Engineer", "机电工程师", `${RE}.building-design-engineering`, "engineering", ["mechanical electrical plumbing engineer", "building services engineer", "hvac design engineer", "暖通工程师", "给排水工程师", "暖通设计", "机电设计"], "P4"),
  o("bim-engineer", "BIM Engineer", "BIM 工程师", `${RE}.building-design-engineering`, "engineering", ["bim coordinator", "bim modeler", "bim工程师"]),
  o("surveyor", "Land Surveyor", "测绘工程师", RE, "engineering", ["surveying engineer", "gis specialist", "geomatics engineer", "测量员", "测绘", "gis工程师"]),
  o("property-manager", "Property Manager", "物业经理", `${RE}.property-facilities`, "operations", ["facilities manager", "building manager", "estate manager", "物业管理", "物业主管", "设施经理"]),
  o("real-estate-development-manager", "Real Estate Development Manager", "地产开发经理", `${RE}.real-estate-development`, "project-strategy", ["development manager", "real estate investment manager", "acquisitions manager", "投拓", "地产投资", "开发报建", "地产开发"]),

  /* ================================================================ agriculture & food */
  o("farmer", "Farmer / Farm Manager", "农场主", `${AGR}.modern-agriculture`, "manufacturing", ["farm manager", "grower", "rancher", "agricultural producer", "农民", "种植户", "农场经理", "养殖户"]),
  o("agronomist", "Agronomist", "农艺师", `${AGR}.agtech`, "research", ["crop scientist", "agricultural scientist", "soil scientist", "agricultural technician", "农艺", "植保", "农技员", "农业技术员"]),
  o("food-scientist", "Food Scientist", "食品研发工程师", `${AGR}.food-tech`, "research", ["food technologist", "flavor chemist", "食品研发", "食品工程师", "配方研发"]),
  o("food-safety-specialist", "Food Safety Specialist", "食品安全专员", AGR, "quality", ["food safety inspector", "haccp coordinator", "食品安全", "食品质检", "食安"]),
  o("livestock-technician", "Aquaculture or Livestock Technician", "养殖技术员", `${AGR}.aquaculture-livestock`, "manufacturing", ["fish farmer", "livestock technician", "animal husbandry technician", "畜牧师", "水产技术员", "水产养殖技术员"]),
  o("agri-trader", "Agricultural Commodity Trader", "农产品贸易专员", `${AGR}.agri-trade`, "sales", ["grain trader", "commodity merchant", "粮食贸易", "农产品贸易"]),

  /* ================================================================ research & academia */
  o("professor", "Professor", "教授", `${EDU}.higher-education`, "research", ["full professor", "chair professor", "distinguished professor", "principal investigator", "pi", "faculty", "博导", "课题组长", "讲席教授"], "R3"),
  o("associate-professor", "Associate Professor", "副教授", `${EDU}.higher-education`, "research", ["reader", "senior lecturer", "副研究员"], "R3"),
  o("assistant-professor", "Assistant Professor", "助理教授", `${EDU}.higher-education`, "research", ["tenure track faculty", "junior faculty", "青年教师", "准聘副教授", "特聘研究员"], "R2"),
  o("lecturer", "Lecturer", "讲师", `${EDU}.higher-education`, "teaching", ["university lecturer", "college instructor", "adjunct professor", "adjunct faculty", "teaching fellow", "高校讲师", "大学老师", "兼职教授"], "R2"),
  o("postdoctoral-researcher", "Postdoctoral Researcher", "博士后研究员", `${EDU}.higher-education`, "research", ["postdoc", "postdoctoral fellow", "postdoctoral scholar", "research fellow", "博士后", "博后"], "R1"),
  o("research-scientist", "Research Scientist", "研究科学家", SCI, "research", ["scientist", "staff scientist", "senior scientist", "researcher", "research staff member", "研究员", "科研人员", "科学家", "高级研究员"], "R4"),
  o("research-engineer", "Research Engineer", "研究工程师", AI, "research", ["r and d engineer", "research and development engineer", "预研工程师"], "R4"),
  o("research-assistant", "Research Assistant", "科研助理", `${EDU}.higher-education`, "research", ["research associate", "graduate research assistant", "研究助理", "助研"]),
  o("teaching-assistant", "Teaching Assistant", "助教", `${EDU}.higher-education`, "teaching", ["graduate teaching assistant", "university tutor"]),
  o("phd-student", "PhD Student", "博士研究生", `${EDU}.higher-education`, "research", ["phd candidate", "doctoral student", "doctoral candidate", "phd researcher", "博士生", "在读博士"], "S4"),
  o("physicist", "Physicist", "物理学家", `${SCI}.physics`, "research", ["physics researcher", "theoretical physicist", "experimental physicist", "物理研究员", "物理学者"]),
  o("chemist", "Chemist", "化学研究员", `${SCI}.chemistry`, "research", ["analytical chemist", "synthetic chemist", "research chemist", "化学家", "分析化学研究员", "合成研究员"]),
  o("biologist", "Biologist", "生物学研究员", `${SCI}.biology`, "research", ["molecular biologist", "microbiologist", "cell biologist", "neuroscientist", "biology researcher", "生物学家", "分子生物学研究员", "微生物研究员", "神经科学研究员"]),
  o("mathematician", "Mathematician", "数学研究员", `${SCI}.mathematics`, "research", ["applied mathematician", "mathematics researcher", "数学家"]),
  o("materials-scientist", "Materials Scientist", "材料科学家", `${SCI}.materials-science`, "research", ["materials researcher", "材料研究员", "材料科学研究员"]),
  o("geoscientist", "Geoscientist", "地球科学研究员", `${SCI}.earth-space`, "research", ["geologist", "geophysicist", "climate scientist", "meteorologist", "hydrologist", "地质学家", "地质工程师", "气象学家", "气候科学家", "地球物理研究员"]),
  o("astronomer", "Astronomer / Space Scientist", "天文学家", `${SCI}.earth-space`, "research", ["astrophysicist", "space scientist", "planetary scientist", "天体物理研究员", "空间科学研究员"]),
  o("economist", "Economist", "经济学家", `${SOC}.economics`, "research", ["economic analyst", "research economist", "macro analyst", "经济学研究员", "宏观研究员", "经济分析师"]),
  o("research-psychologist", "Research Psychologist", "心理学研究员", `${SOC}.psychology`, "research", ["cognitive scientist", "behavioral scientist", "experimental psychologist", "心理学研究", "行为科学家", "认知科学研究员"]),
  o("sociologist", "Sociologist / Anthropologist", "社会学研究员", `${SOC}.sociology-anthropology`, "research", ["anthropologist", "social researcher", "ethnographer", "社会学家", "人类学家", "社会研究员"]),
  o("historian", "Historian / Philosopher", "历史与哲学研究者", `${SOC}.history-philosophy`, "research", ["philosopher", "history researcher", "archaeologist", "历史学者", "哲学研究者", "考古学家", "历史学家"]),
  o("linguist", "Linguist / Literary Scholar", "语言与文学研究者", `${SOC}.language-literature`, "research", ["computational linguist", "literature scholar", "语言学家", "文学研究者"]),
  o("policy-analyst", "Policy Analyst", "政策研究员", `${LAW}.policy-research`, "research", ["policy researcher", "think tank researcher", "public policy analyst", "political analyst", "政策分析师", "智库研究员", "政策研究"]),
  o("librarian", "Librarian / Archivist", "图书馆员", EDU, "admin", ["archivist", "information specialist", "library assistant", "图书管理员", "档案管理员", "馆员"]),
  o("technology-transfer-manager", "Technology Transfer Manager", "技术转移经理", `${EDU}.higher-education`, "project-strategy", ["tech transfer officer", "licensing manager", "university innovation manager", "技术经理人", "技术转移", "成果转化"]),

  /* ================================================================ teaching & education */
  o("preschool-teacher", "Preschool Teacher", "幼儿园教师", `${EDU}.k12`, "teaching", ["kindergarten teacher", "early childhood educator", "幼师", "幼儿教师", "学前教师"], "P5"),
  o("primary-school-teacher", "Primary School Teacher", "小学教师", `${EDU}.k12`, "teaching", ["elementary school teacher", "primary teacher", "grade school teacher", "小学老师", "小学语文老师", "小学数学老师", "小学英语老师"], "P5"),
  o("secondary-school-teacher", "Secondary School Teacher", "中学教师", `${EDU}.k12`, "teaching", ["high school teacher", "middle school teacher", "secondary teacher", "subject teacher", "math teacher", "初中老师", "高中老师", "中学老师", "班主任"], "P5"),
  o("special-education-teacher", "Special Education Teacher", "特殊教育教师", `${EDU}.k12`, "teaching", ["sped teacher", "special needs teacher", "特教老师", "特殊教育"], "P5"),
  o("language-teacher", "Language Teacher", "语言教师", `${EDU}.language-training`, "teaching", ["esl teacher", "efl teacher", "english teacher", "chinese teacher", "foreign language teacher", "对外汉语教师", "英语老师", "雅思老师", "托福老师", "外语教师", "国际中文教师"], "P5"),
  o("tutor", "Tutor", "辅导老师", EDU, "teaching", ["private tutor", "online tutor", "test prep tutor", "家教", "课外辅导", "一对一老师"]),
  o("vocational-instructor", "Vocational Instructor", "职业院校教师", `${EDU}.vocational-education`, "teaching", ["trade school instructor", "vocational teacher", "技工学校老师", "实训老师", "职业培训讲师"], "P5"),
  o("instructional-designer", "Instructional Designer", "课程设计师", `${EDU}.edtech`, "design", ["learning designer", "curriculum designer", "e learning developer", "curriculum developer", "课程研发", "教研", "课程设计"]),
  o("education-consultant", "Study-Abroad / Education Consultant", "留学顾问", `${EDU}.study-abroad`, "sales", ["admissions consultant", "college counselor", "study abroad advisor", "education counselor", "留学咨询", "留学文案", "升学顾问", "留学规划师"]),
  o("academic-advisor", "Academic Advisor / Admissions Officer", "学业导师", `${EDU}.higher-education`, "admin", ["admissions officer", "student advisor", "university career counselor", "辅导员", "招生老师", "学业指导", "就业指导老师"]),
  o("school-principal", "School Principal", "校长", `${EDU}.k12`, "executive", ["head teacher", "headmaster", "school director", "vice principal", "副校长", "教学主任"], "P5"),

  /* ================================================================ public sector & nonprofit */
  o("civil-servant", "Civil Servant", "公务员", `${LAW}.government`, "admin", ["government official", "public servant", "government employee", "administrative officer", "机关干部", "科员", "选调生"], "E6"),
  o("public-institution-staff", "Public Institution Staff", "事业单位工作人员", `${LAW}.government`, "admin", ["public sector employee", "state institution staff", "事业编", "事业单位", "事业编制"], "E6"),
  o("diplomat", "Diplomat", "外交官", `${LAW}.international-organizations`, "project-strategy", ["foreign service officer", "consular officer"], "E6"),
  o("police-officer", "Police Officer", "警察", `${LAW}.government`, "operations", ["police", "law enforcement officer", "detective", "patrol officer", "民警", "辅警", "刑警"], "E6"),
  o("firefighter", "Firefighter", "消防员", `${LAW}.government`, "operations", ["fire fighter", "fireman", "消防救援"], "E6"),
  o("military-service-member", "Military Service Member", "军人", `${LAW}.government`, "operations", ["soldier", "military officer", "service member", "veteran", "军官", "士兵", "退役军人"], "T5"),
  o("customs-officer", "Customs or Immigration Officer", "海关关员", `${LAW}.government`, "operations", ["border officer", "immigration officer", "海关", "边检"], "E6"),
  o("social-worker", "Social Worker", "社会工作者", `${NPO}.community-services`, "operations", ["case manager", "community worker", "social services worker", "社工", "社区工作者", "个案社工"]),
  o("ngo-program-officer", "NGO Program Officer", "公益项目官员", NPO, "project-strategy", ["program officer", "ngo program coordinator", "project officer", "humanitarian worker", "项目官员", "公益项目经理"]),
  o("fundraiser", "Fundraising / Development Officer", "筹款专员", `${NPO}.charities-foundations`, "marketing", ["development officer", "fundraising manager", "grant writer", "major gifts officer", "筹款", "募款", "资源拓展", "筹资经理"]),
  o("volunteer-coordinator", "Volunteer Coordinator", "志愿者协调员", `${NPO}.community-services`, "operations", ["volunteer manager", "志愿者管理", "志愿者协调"]),
  o("international-organization-officer", "International Organisation Officer", "国际组织职员", `${LAW}.international-organizations`, "project-strategy", ["un staff", "united nations officer", "international civil servant", "unv", "联合国职员", "国际组织", "国际公务员"]),

  /* ================================================================ hospitality & lifestyle services */
  o("chef", "Chef", "厨师", `${HOS}.food-service`, "manufacturing", ["cook", "sous chef", "head chef", "line cook", "pastry chef", "主厨", "厨师长", "面点师", "西点师"], "E8"),
  o("baker", "Baker", "烘焙师", `${HOS}.food-service`, "manufacturing", ["pastry baker", "烘焙", "面包师", "蛋糕师"], "E8"),
  o("barista", "Barista", "咖啡师", `${HOS}.food-service`, "customer-success", ["coffee maker", "调茶师", "奶茶店员"], "E8"),
  o("waiter", "Server / Waiter", "餐厅服务员", `${HOS}.food-service`, "customer-success", ["waitress", "waiting staff", "food server", "restaurant host", "服务员", "传菜员"], "E8"),
  o("bartender", "Bartender", "调酒师", `${HOS}.food-service`, "customer-success", ["mixologist", "bar staff"], "E8"),
  o("restaurant-manager", "Restaurant Manager", "餐厅经理", `${HOS}.food-service`, "operations", ["food and beverage manager", "f and b manager", "restaurant supervisor", "餐厅店长", "餐饮经理", "楼面经理"], "E8"),
  o("hotel-manager", "Hotel Manager", "酒店经理", `${HOS}.hotels-homestays`, "operations", ["hotel general manager", "front office manager", "guest relations manager", "酒店总经理", "前厅经理", "客房经理", "民宿主理人"]),
  o("front-desk-agent", "Hotel Front Desk Agent", "酒店前台", `${HOS}.hotels-homestays`, "customer-success", ["guest service agent", "concierge", "礼宾"], "E8"),
  o("housekeeper", "Housekeeper / Cleaner", "保洁员", HOS, "operations", ["cleaner", "janitor", "room attendant", "custodian", "housekeeping", "保洁", "客房服务员", "家政", "清洁工"], "E8"),
  o("tour-guide", "Tour Guide", "导游", `${HOS}.travel-airline-services`, "customer-success", ["tour leader", "travel guide", "tour manager", "领队"], "E8"),
  o("travel-consultant", "Travel Consultant", "旅游顾问", `${HOS}.travel-airline-services`, "sales", ["travel agent", "travel planner", "旅行顾问", "旅游定制师", "计调"]),
  o("fitness-trainer", "Personal Trainer", "健身教练", `${HOS}.fitness-sports`, "customer-success", ["fitness instructor", "gym instructor", "strength coach", "私教", "团课教练"], "E8"),
  o("yoga-instructor", "Yoga / Pilates Instructor", "瑜伽教练", `${HOS}.fitness-sports`, "teaching", ["pilates instructor", "yoga teacher", "普拉提教练", "瑜伽老师"], "E8"),
  o("hairdresser", "Hairdresser", "发型师", `${HOS}.beauty-wellness`, "customer-success", ["hair stylist", "barber", "hairstylist", "理发师", "美发师"], "E8"),
  o("beautician", "Beautician / Esthetician", "美容师", `${HOS}.beauty-wellness`, "customer-success", ["esthetician", "beauty therapist", "nail technician", "skin care specialist", "美甲师", "皮肤管理师"], "E8"),
  o("massage-therapist", "Massage Therapist", "按摩理疗师", `${HOS}.beauty-wellness`, "clinical", ["spa therapist", "推拿师", "按摩师", "足疗师"], "E8"),
  o("wedding-planner", "Wedding Planner", "婚礼策划师", `${HOS}.weddings-events`, "creative", ["wedding coordinator", "婚礼策划", "婚礼主持", "婚庆策划"]),
  o("security-guard", "Security Guard", "保安", HOS, "operations", ["security officer", "guard", "保安员", "安保"], "E8"),
  o("childcare-worker", "Childcare Worker / Nanny", "育婴师", HOS, "operations", ["nanny", "babysitter", "au pair", "childminder", "保姆", "育儿嫂", "月嫂", "育婴员"], "E8"),
  o("pet-groomer", "Pet Groomer", "宠物美容师", `${CON}.pets`, "customer-success", ["dog groomer", "宠物美容", "宠物护理"], "E8"),

  /* ================================================================ executives & founders */
  o("founder", "Founder", "创始人", SW, "executive", ["co founder", "cofounder", "founder and ceo", "startup founder", "entrepreneur", "联合创始人", "创业者"], "F2"),
  o("ceo", "Chief Executive Officer", "首席执行官", PRO, "executive", ["ceo", "chief executive", "president", "总裁"]),
  o("coo", "Chief Operating Officer", "首席运营官", PRO, "executive", ["coo", "运营副总裁"]),
  o("cto", "Chief Technology Officer", "首席技术官", SW, "executive", ["cto", "vp engineering", "vp of engineering", "技术副总裁", "技术合伙人"]),
  o("general-manager", "General Manager", "总经理", PRO, "executive", ["gm", "business unit head", "country manager", "managing director", "事业部总经理", "分公司总经理", "区域总经理"]),
  o("vice-president", "Vice President", "副总裁", PRO, "executive", ["vp", "svp", "evp", "副总经理"]),
  o("small-business-owner", "Small Business Owner", "小微企业主", CON, "executive", ["business owner", "shop owner", "owner operator", "self employed", "sole proprietor", "个体户", "店主", "老板", "个体工商户"], "F6"),
];

const BY_CODE = new Map<string, OccupationDef>(OCCUPATIONS.map((x) => [x.code, x]));

export function isOccupationCode(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value);
}

export function getOccupation(code: string): OccupationDef {
  const def = BY_CODE.get(code);
  if (!def) throw new Error(`Unknown occupation: ${code}`);
  return def;
}

export function occupationLabel(code: string, locale: Locale | string): string {
  return localize(getOccupation(code).label, locale);
}

/** Seniority, contract and level words ignored in a second pass ("Senior Software Engineer II"). */
const DROP_WORDS = [
  "senior", "sr", "snr", "junior", "jr", "lead", "principal", "staff", "intern", "internship", "trainee",
  "entry", "level", "mid", "experienced", "i", "ii", "iii", "iv", "v", "1", "2", "3", "4", "5",
  "remote", "contract", "contractor", "temporary", "temp", "part", "time", "full", "hybrid", "onsite",
];
const DROP_CJK = ["高级", "资深", "初级", "中级", "实习生", "实习", "见习", "兼职", "全职", "储备", "远程"];

let matcher: ReturnType<typeof createPhraseMatcher> | null = null;

/**
 * Maps a job title or free text (English, Chinese or mixed) to occupation codes, best first.
 * Score 1 = exact title or alias; ≥ 0.7 = an alias appears inside the text; lower = partial
 * overlap. Defaults: top 5, score ≥ 0.3.
 *
 *   mapOccupation("Senior Software Engineer") → [{ code: "software-engineer", score: 1 }, …]
 *   mapOccupation("产品经理")                  → [{ code: "product-manager", score: 1 }, …]
 */
export function mapOccupation(text: string, opts: MatchOptions = {}): PhraseMatch[] {
  matcher ??= createPhraseMatcher(
    OCCUPATIONS.map((x) => ({ code: x.code, phrases: [x.label.en, x.label.zh, ...x.aliases] })),
    { dropWords: DROP_WORDS, dropCjk: DROP_CJK },
  );
  return matcher(text, opts);
}
