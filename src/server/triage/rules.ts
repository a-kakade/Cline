import type {
  MatchStrength,
  SuggestedAction,
  TriageCategory,
  TriageResult,
} from "@/lib/triage-types";

// Deterministic, auditable triage rules for English, Hindi (Devanagari) and
// romanized Hindi ("Hinglish"). This is a safety *triage aid*: it flags messages
// for moderator attention and offers the sender help options. It is not an
// emergency detector, its matches are not probabilities, and it will miss real
// emergencies and flag harmless messages (see docs/SAFETY_TRIAGE.md for measured
// results). Nothing here contacts anyone automatically.

type Rule = { re: RegExp; label: string; strength: MatchStrength };
const rule = (
  re: RegExp,
  label: string,
  strength: MatchStrength = "strong",
): Rule => ({ re, label, strength });

const URGENT: Rule[] = [
  rule(
    /\b(follow(ing|ed)?|chas(ing|ed)|stalk(ing)?) (me|us)\b/,
    "Says someone is following or chasing the sender",
  ),
  rule(
    /\b(someone|somebody|a (man|guy|group|car|bike)|he|they|men|guys) (is|are|has been|have been) (follow(ing)?|chasing|stalking|trailing)\b/,
    "Says someone is following or chasing",
  ),
  rule(
    /\b(grabb(ed|ing)|dragg(ed|ing)|pull(ed|ing)|pinn(ed|ing)) me\b/,
    "Describes being physically grabbed or dragged",
  ),
  rule(
    /\b(attack(ed|ing)|assault(ed|ing)|hit(ting)?|beat(ing)?) me\b/,
    "Describes an ongoing attack on the sender",
  ),
  rule(
    /\b(has|have|with|holding|pulled) (a |the )?(knife|gun|weapon|blade)\b/,
    "Mentions a weapon",
  ),
  rule(
    /\b(kidnap(ped|ping)?|abduct(ed|ing)?)\b/,
    "Mentions kidnapping or abduction",
  ),
  rule(
    /\b(i am|i'm|im) (in danger|being attacked|being followed|being chased|not safe)\b/,
    "Sender says they are in danger",
  ),
  rule(
    /\b(need|send) (help|police|someone) (now|immediately|right now|asap)\b/,
    "Asks for immediate help",
  ),
  rule(
    /\b(please|pls|plz)? ?(save|help) me\b.*\b(scared|danger|attack|follow|chas|alone|knife|grab)/,
    "Pleads for help alongside danger words",
  ),
  rule(/\b(bachao|bachaao|bachado)\b/, "Cries for rescue (Hindi, romanized)"),
  rule(/\bmujhe bacha(o|ao|do)\b/, "Cries for rescue (Hindi, romanized)"),
  rule(
    /\b(koi|woh|wo|vo|ek aadmi|log) (mera |meri )?peecha (kar|kr) (raha|rahi|rahe)\b/,
    "Says someone is following (Hindi, romanized)",
  ),
  rule(
    /\bpeecha (kar|kr) (raha|rahi|rahe) (hai|hain|h)\b/,
    "Says someone is following (Hindi, romanized)",
  ),
  rule(
    /\bpakad (liya|liye|rakha|kar)\b/,
    "Says the sender was grabbed (Hindi, romanized)",
  ),
  rule(/^((help|sos|save me)( me)?[!?., ]*)+$/, "A bare call for help"),
  rule(
    /\b(locked|locking) (the )?(doors?|windows?|me|us)\b/,
    "Says doors were locked on the sender",
    "moderate",
  ),
  rule(
    /\b(won'?t|will not|not|isn'?t|refus(es|ing) to) (let(ting)? (me|us) (go|out|leave|get out)|stop(ping)? (the )?(car|cab|auto|vehicle)?)\b.*\b(help|call|police|scared|please)\b/,
    "Says the sender is being kept in a vehicle or place",
    "moderate",
  ),
  rule(/बचाओ|मुझे बचा/, "Cries for rescue (Hindi)"),
  rule(/पीछा कर (रहा|रही|रहे)/, "Says someone is following (Hindi)"),
  rule(/पकड़ (लिया|रखा)/, "Says the sender was grabbed (Hindi)"),
  rule(/(चाकू|हथियार|बंदूक)/, "Mentions a weapon (Hindi)"),
];
// "help me" only counts as urgent on its own or with danger context.
const HELP_ME =
  /\b(help me|please help|pls help|plz help|need help|madad (karo|kijiye|chahiye))\b|मदद (करो|कीजिए|चाहिए)/;
const BENIGN_HELP_CONTEXT =
  /\b(find|finding|directions?|direction|way to|route|which (bus|metro|auto)|where is|where can|how (do|to|can) (i|we)|recommend|suggest|looking for|nearest|address|ticket|fill|form|homework|app|wifi|charger|bhai|bhaiya)\b/;
const DANGER_WORDS =
  /\b(scared|afraid|danger|unsafe|attack|follow|chas|alone|knife|grab|threat|dark|drunk|men|guys|darr|dar lag|ghabra|khatra)\b|डर|खतरा|असुरक्षित/;

const DISTRESS: Rule[] = [
  rule(
    /\b(i feel|i am feeling|i'm feeling|im feeling|i am|i'm|im) (very |really |so |quite )?(unsafe|scared|afraid|terrified|threatened|nervous|uneasy|uncomfortable)\b/,
    "Sender says they feel unsafe or scared",
    "moderate",
  ),
  rule(
    /\b(feeling|feel) (very |really |so )?(unsafe|scared|afraid|threatened)\b/,
    "Sender says they feel unsafe or scared",
    "moderate",
  ),
  rule(
    /\b(walking|going|waiting|travell?ing|standing) alone\b.*\b(scared|afraid|unsafe|nervous|dark|late)\b/,
    "Alone and uneasy",
    "moderate",
  ),
  rule(
    /\b(too )?(scared|afraid|terrified) to (walk|go|travel|wait|go home|go out)\b/,
    "Too scared to travel",
    "moderate",
  ),
  rule(
    /\bmujhe (bahut |bohot |kaafi )?(dar|darr|ghabrahat|khatra)\b/,
    "Sender says they are afraid (Hindi, romanized)",
    "moderate",
  ),
  rule(
    /\b(dar|darr) (lag|lg) (raha|rahi|rha|rhi)\b/,
    "Sender says they are afraid (Hindi, romanized)",
    "moderate",
  ),
  rule(
    /\b(asurakshit|unsafe) (mehsoos|feel|lag)\b/,
    "Sender feels unsafe (Hindi, romanized)",
    "moderate",
  ),
  rule(
    /डर (लग|लगा)|घबरा|असुरक्षित (महसूस|लग)/,
    "Sender says they are afraid (Hindi)",
    "moderate",
  ),
];

const HARASSMENT: Rule[] = [
  rule(
    /\b(eve[- ]?teas(e|ed|ing)|cat[- ]?call(ed|ing|s)?|molest(ed|ing|ation)?|groped|grop(ing)|flash(ed|ing)|exposed (himself|themselves)|upskirt)\b/,
    "Reports harassment (named behaviour)",
    "strong",
  ),
  rule(
    /\b(harass(ed|ing|ment)?|stalk(ed|er|ing)|touched me|touching me|inappropriate(ly)?|lewd|obscene|passed (lewd |dirty |nasty )?comments?|whistl(ed|ing)|stared|staring|leering|leered|catcalls?)\b/,
    "Reports harassment (named behaviour)",
    "moderate",
  ),
  rule(
    /\b(chhed(a|i|te|ne)|chheda|chhedkhani|cheda|chedkhani|chhed ?chhad|eve ?teasing|gandi nazar|ghoo?r (raha|rahi|rahe|ta|ti)|ghoorta|ghurta)\b/,
    "Reports harassment (Hindi, romanized)",
    "moderate",
  ),
  rule(/छेड़|छेड़छाड़|अश्लील|घूर/, "Reports harassment (Hindi)", "moderate"),
];

const HAZARD: Rule[] = [
  rule(
    /\b(street ?lights?|lamp ?posts?|lights?) (is |are |was |were )?(not working|off|broken|out|dead|fused|missing|faulty)\b/,
    "Reports broken lighting",
    "strong",
  ),
  rule(
    /\b(no (street ?)?lights?|unlit|poorly lit|badly lit|pitch dark|very dark)\b/,
    "Reports missing lighting",
    "moderate",
  ),
  rule(
    /\b(pot ?holes?|open (manhole|drain)|manhole|broken (road|footpath|pavement|bridge|stairs?)|no (foot ?path|pavement|sidewalk)|water ?logg(ed|ing)|flooded|fallen (tree|wire)|exposed wires?|construction (blocking|blocks)|path (is )?blocked|blocked (road|path|footpath))\b/,
    "Reports a physical hazard",
    "strong",
  ),
  rule(
    /\b(light|batti|lights|streetlight) (kharab|band|nahi (jal|chal))\b|\bandhera\b|\bgaddha\b|\bgadhe\b|\bsadak (toot|tuti|kharab)\b/,
    "Reports a hazard (Hindi, romanized)",
    "moderate",
  ),
  rule(
    /अंधेरा|गड्ढा|गड्ढे|बत्ती (खराब|बंद)|सड़क (टूट|खराब)/,
    "Reports a hazard (Hindi)",
    "moderate",
  ),
];

const CONCERN: Rule[] = [
  rule(
    /\b(suspicious|sketchy|shady|creepy|loitering|lurking|drunk(en)?|rowdy|fighting|crowd of men|group of men|unsafe (area|place|lane|street|road|stretch)|avoid (this|that|the) (area|lane|road|street|stretch|place)|be careful|stay alert|watch out)\b/,
    "Raises a general safety concern",
    "weak",
  ),
  rule(
    /\b(savdhan|sandigdh|sandehaspad|sharabi|nasha|awara|ladai|jhagda)\b/,
    "Raises a general safety concern (Hindi, romanized)",
    "weak",
  ),
  rule(
    /सावधान|संदिग्ध|शराबी|आवारा|झगड़ा/,
    "Raises a general safety concern (Hindi)",
    "weak",
  ),
];

// Negation within the few words before a match cancels that match.
const NEGATION =
  /\b(not|no|never|nobody|none|isn'?t|aren'?t|wasn'?t|don'?t|doesn'?t|nahi|nahin|nhi|na)\b|नहीं|ना\b/;

function normalise(input: string) {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(.)\1{2,}/gu, "$1$1") // helppp → helpp
    .replace(/(help)p+/g, "$1")
    .replace(/[“”‘’]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'\s?!.,-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectLanguage(text: string): "en" | "hi" | "hi-Latn" | "und" {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 2) return "und";
  const count = (re: RegExp) => letters.filter((c) => re.test(c)).length;
  const deva = count(/\p{Script=Devanagari}/u);
  const latin = count(/\p{Script=Latin}/u);
  if (deva / letters.length > 0.3) return "hi";
  if (latin / letters.length < 0.7) return "und"; // other scripts are unsupported
  const hinglish =
    /\b(hai|hain|nahi|nahin|nhi|mujhe|mera|meri|mere|kya|kyun|koi|bahut|bohot|aaj|raha|rahi|rahe|karo|kar|ho|tha|thi|wala|wali|yahan|wahan|andhera|bachao|madad|peecha|dar|darr|lag|log|aur|abhi|bhai|didi|sadak|batti)\b/g;
  const hits = (text.toLowerCase().match(hinglish) ?? []).length;
  return hits >= 2 ? "hi-Latn" : "en";
}

function negated(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  return NEGATION.test(before.split(/[.!?]/).pop() ?? "");
}
function firstMatch(text: string, rules: Rule[]) {
  for (const r of rules) {
    const m = r.re.exec(text);
    if (m && !negated(text, m.index)) return r;
  }
  return null;
}

// ---- Lexical co-occurrence layer -------------------------------------------
// Phrase rules above are precise but brittle. This layer looks for a *threat
// word near a first-person word*, a feel-word, an object plus a fault word, etc.,
// so differently worded messages are still caught. It is tilted toward recall for
// urgent/distress: a false flag costs a moderator a glance; a miss can cost more.
// Fiction and past events are not live reports, even if they use alarming words.
const NOT_A_REAL_REPORT =
  /\b(movie|film|show|series|serial|book|novel|game|dream|nightmare|story|trailer|song|scene)\b/;
const PAST_FEELING =
  /\b(used to|earlier|before|pehle|no longer|not anymore|ab nahi)\b|\bwas (so |very |really )?(scared|afraid|nervous|unsafe|terrified)\b|\b(but|now)\b.*\b(fixed|solved|better|resolved)\b/;
const tokens = (t: string) => t.split(/[\s,.!?;:()"—-]+/).filter(Boolean);
const idx = (toks: string[], re: RegExp) =>
  toks.flatMap((t, i) => (re.test(t) ? [i] : []));
const near = (a: number[], b: number[], window: number) =>
  a.some((i) => b.some((j) => Math.abs(i - j) <= window));

const SELF =
  /^(me|my|us|our|mine|mujhe|mujhko|mujh|mera|meri|mere|hamein|humein|hume|hamari|हमें|मुझे|मुझको|मेरा|मेरी|मेरे|हम)$/;
const THREAT =
  /^(follow\w*|tail(ing|ed|s)?|chas(e|es|ing|ed)|grab\w*|pull(ing|ed|s)?|drag\w*|attack\w*|assault\w*|beat(ing|s)?|hit(ting|s)?|kidnap\w*|abduct\w*|trap(ped|ping)?|corner(ed|ing)?|threat(en|ens|ening|ened)|forc(e|ed|ing|ibly)|lock(ed|ing)?|peecha|pakad\w*|pakda|kheench\w*|zabardasti|zabarjasti|ghasit\w*|dhakka|maar\w*|le ja\w*|पीछा|पकड़\w*|खींच\w*|जबरदस्ती|धमकी|मार\w*)$/;
const WEAPON =
  /^(knife|knives|blade|gun|pistol|weapon|rod|acid|chaku|chaaku|chakoo|talwar|bandook|चाकू|बंदूक|हथियार|तेज़ाब)$/;
const HELP_CALL =
  /^(help|save|sos|bachao|bachaao|bachaiye|bachaye|bacha|madad|बचाओ|बचाइए|मदद)$/;
const ONGOING =
  /^(is|are|am|now|abhi|raha|rahi|rahe|rha|rhi|रहा|रही|रहे|अभी|still|since|currently)$/;
const PAST =
  /^(yesterday|ago|earlier|before|kal|pehle|pichle|last|था|थी|थे|was|were|used|once)$/;
const VICTIM =
  /^(girl|girls|woman|women|lady|ladies|ladki|ladkiyan|aurat|kid|child|bacchi|bachhi|student|students|लड़की|महिला|औरत|बच्ची)$/;
const FEEL =
  /^(unsafe|scared|afraid|frightened|terrified|anxious|nervous|uneasy|worried|uncomfortable|threatened|intimidated|dar|darr|darr?na|ghabrahat|ghabra\w*|chinta|डर|घबराहट|चिंता|असुरक्षित)$/;
const ALONE = /^(alone|akele|akeli|अकेले|अकेली|deserted|empty|sunsaan|सुनसान)$/;
const HARASS_ACT =
  /^(harass\w*|stalk\w*|stare\w*|staring|stared|leer\w*|whistl\w*|seeti|catcall\w*|molest\w*|grop\w*|touch(ed|ing|es)?|chhu\w*|chhed\w*|ghoo?r\w*|छेड़\w*|घूर\w*|छू\w*)$/;
const RUDE =
  /^(nasty|lewd|dirty|rude|vulgar|obscene|filthy|gande|gandi|gandey|bad|inappropriate|kissing|अश्लील|गंदे|गंदी)$/;
const COMMENT =
  /^(comments?|remarks?|words|sounds?|gestures?|jokes?|photos?|pictures?|videos?|taunts?|comment|taane|ताने)$/;
const FIXTURE =
  /^(street\s?lights?|streetlights?|lights?|lamps?|lamp\s?posts?|batti|footbridge|stairs?|steps?|drains?|naali|nala|manholes?|roads?|sadak|footpaths?|pavements?|underpass|subway|wires?|tree|bridge|gali|lane|गली|सड़क|बत्ती|नाली)$/;
const FAULT =
  /^(off|dead|broken|not|nahi|band|kharab|toot\w*|flood\w*|waterlogged|blocked|hanging|exposed|missing|fused|faulty|dark|unlit|andhera|pothole\w*|fallen|collapsed|leaking|बंद|खराब|टूट\w*|खुली|खुला|अंधेरा)$/;
const LURK =
  /^(loiter\w*|lurk\w*|hanging|suspicious|sketchy|shady|creepy|rowdy|weird|strange|ajeeb|awara|aawara|ghoom\w*|drunk\w*|sharabi|संदिग्ध|अजीब|आवारा|शराबी)$/;
const WARN = /^(alert|careful|savdhan|dhyan|avoid|beware|सावधान|ध्यान)$/;
const PEOPLE =
  /^(men|man|guys?|boys?|people|persons?|crowd|group|gang|log|ladke|ladka|aadmi|admi|car|bike|bikers?|auto|driver|लोग|लड़के|आदमी)$/;
const BENIGN_HELP = BENIGN_HELP_CONTEXT;

function lexical(raw: string, language: string): TriageResult | null {
  const toks = tokens(raw);
  if (toks.length === 0) return null;
  const text = toks.join(" ");
  const self = idx(toks, SELF);
  // "followed by ..." is a sequence word, not a pursuit.
  const threat = idx(toks, THREAT).filter((i) => toks[i + 1] !== "by");
  const weapon = idx(toks, WEAPON);
  const helpCall = idx(toks, HELP_CALL);
  const ongoing = idx(toks, ONGOING);
  const past = idx(toks, PAST).length > 0;
  const victim = idx(toks, VICTIM);
  const negatedAt = (i: number) =>
    negated(toks.slice(0, i + 1).join(" "), toks.slice(0, i).join(" ").length);
  const isThreatNegated = threat.every((i) => negatedAt(i));

  // Weapons near the sender, or "coming towards".
  if (
    weapon.length &&
    (near(weapon, self, 6) ||
      /\b(towards|toward|coming|aa raha|aa rha)\b/.test(text)) &&
    !negated(text, text.indexOf(toks[weapon[0]]))
  )
    return result(
      "urgent_safety_concern",
      language,
      "moderate",
      "Mentions a weapon near the sender",
    );

  // A threat verb close to the sender and happening now.
  if (threat.length && !isThreatNegated && near(threat, self, 5) && !past)
    return result(
      "urgent_safety_concern",
      language,
      helpCall.length || ongoing.length ? "strong" : "moderate",
      "A threatening action is described as happening to the sender",
    );
  // Witness: a threat verb with a woman/girl/child and something happening now.
  if (
    threat.length &&
    !isThreatNegated &&
    near(threat, victim, 5) &&
    ongoing.length &&
    !past
  )
    return result(
      "urgent_safety_concern",
      language,
      "moderate",
      "Describes an ongoing attack on someone else",
    );
  // A call for help together with danger words.
  if (
    helpCall.length &&
    (threat.length || weapon.length || DANGER_WORDS.test(text)) &&
    !BENIGN_HELP.test(text)
  )
    return result(
      "urgent_safety_concern",
      language,
      "moderate",
      "Asks for help alongside danger words",
    );

  // The sender is a target of a threat in the past (a report, not an emergency).
  if (threat.length && !isThreatNegated && near(threat, self, 5) && past)
    return result(
      "harassment_report",
      language,
      "moderate",
      "Reports being followed or threatened earlier",
    );

  // Distress: feel-words, "don't feel safe", or being alone and uneasy.
  const feel = idx(toks, FEEL);
  const feelNegatedSafe =
    /\b(not|dont|don't|do not|nahi|nhi|never)\b.{0,12}\b(safe|surakshit)\b|\bsafe (nahi|nhi|not)\b|सुरक्षित (नहीं|नही)/.test(
      text,
    );
  const usedToFeel = PAST_FEELING.test(text) || NOT_A_REAL_REPORT.test(text);
  if ((feel.length || feelNegatedSafe) && !usedToFeel) {
    const reallyFeel =
      near(feel, self, 6) ||
      feelNegatedSafe ||
      /\b(i|im|i'm|feeling|feel|mujhe|lag)\b/.test(text);
    if (reallyFeel && (feelNegatedSafe || feel.some((i) => !negatedAt(i))))
      return result(
        "distress",
        language,
        "moderate",
        "Sender expresses fear or unease",
      );
  }
  if (idx(toks, ALONE).length && feel.length && !usedToFeel)
    return result("distress", language, "moderate", "Alone and uneasy");

  // Harassment: named behaviours, or rude comments/sounds/photos.
  const act = idx(toks, HARASS_ACT);
  const rude = idx(toks, RUDE);
  const comment = idx(toks, COMMENT);
  if (
    act.length &&
    !act.every((i) => negatedAt(i)) &&
    (near(act, self, 6) ||
      near(act, victim, 6) ||
      /\b(girls?|women|ladki\w*|us)\b/.test(text) ||
      rude.length)
  )
    return result(
      "harassment_report",
      language,
      "moderate",
      "Reports harassing behaviour",
    );
  if (rude.length && comment.length && near(rude, comment, 3))
    return result(
      "harassment_report",
      language,
      "moderate",
      "Reports rude or lewd remarks",
    );
  if (
    /\b(without (asking|consent|permission)|bina (pooche|puche))\b/.test(
      text,
    ) &&
    comment.length
  )
    return result(
      "harassment_report",
      language,
      "weak",
      "Reports unwanted photographing or remarks",
    );

  // Hazard: a fixture near a fault word.
  const openable = idx(
    toks,
    /^(manholes?|drains?|naali|nala|wires?|pit|gutter|ditch)$/,
  );
  if (
    openable.length &&
    near(openable, idx(toks, /^(open|khuli|khula|uncovered|exposed)$/), 3)
  )
    return result(
      "infrastructure_hazard",
      language,
      "moderate",
      "An uncovered drain, wire or manhole",
    );
  const fixture = idx(toks, FIXTURE);
  const fault = idx(toks, FAULT).filter(
    (i) => !(toks[i] === "not" && !fixture.length),
  );
  if (
    fixture.length &&
    fault.length &&
    near(fixture, fault, 6) &&
    !/\b(no problem|working (fine|well))\b/.test(text)
  )
    return result(
      "infrastructure_hazard",
      language,
      "moderate",
      "A fixture or road is described as faulty or unsafe",
    );
  if (/\bfloods?\b|\bflooding\b/.test(text) && fixture.length)
    return result(
      "infrastructure_hazard",
      language,
      "moderate",
      "Reports flooding",
    );

  // Concern: people lurking, or a plain warning to others.
  const lurk = idx(toks, LURK);
  const people = idx(toks, PEOPLE);
  if (lurk.length && (people.length || /\b(seems off|feels off)\b/.test(text)))
    return result(
      "concern",
      language,
      "weak",
      "Describes suspicious or rowdy behaviour",
    );
  if (
    idx(toks, WARN).length &&
    (/\b(avoid|careful|alert|savdhan|dhyan|beware)\b/.test(text) ||
      /सावधान/.test(text)) &&
    !/\bno\b/.test(text)
  )
    return result("concern", language, "weak", "Warns others to be careful");
  return null;
}

const ACTIONS: Record<TriageCategory, SuggestedAction[]> = {
  urgent_safety_concern: ["call_112", "open_sos", "nearby_help"],
  distress: ["open_sos", "nearby_help", "share_journey"],
  harassment_report: ["report_harassment", "nearby_help", "open_sos"],
  infrastructure_hazard: ["report_hazard"],
  concern: ["nearby_help"],
  general: [],
  unknown: [],
};

function result(
  category: TriageCategory,
  language: string,
  strength: MatchStrength,
  reason: string,
): TriageResult {
  return {
    category,
    language,
    strength,
    reason,
    needs_review: [
      "urgent_safety_concern",
      "distress",
      "harassment_report",
      "unknown",
    ].includes(category),
    method: "rules",
    suggested_actions: ACTIONS[category],
  };
}

export function triageByRules(raw: string): TriageResult {
  const language = detectLanguage(raw);
  const text = normalise(raw);
  if (text.length < 2 || language === "und")
    return result(
      "unknown",
      language,
      "none",
      language === "und" && text.length >= 2
        ? "Language or script is not supported by the rules; needs a human look"
        : "Too short to assess",
    );

  const urgent = firstMatch(text, URGENT);
  if (urgent)
    return result(
      "urgent_safety_concern",
      language,
      urgent.strength,
      urgent.label,
    );

  const help = HELP_ME.exec(text);
  if (help && !negated(text, help.index)) {
    const words = text.split(" ").length;
    const benign = BENIGN_HELP_CONTEXT.test(text);
    if (DANGER_WORDS.test(text) && !benign)
      return result(
        "urgent_safety_concern",
        language,
        "moderate",
        "Asks for help alongside danger words",
      );
    if (!benign && words <= 5)
      return result(
        "urgent_safety_concern",
        language,
        "weak",
        "Short plea for help with no other context",
      );
  }

  const distress = firstMatch(text, DISTRESS);
  if (distress && !PAST_FEELING.test(text) && !NOT_A_REAL_REPORT.test(text))
    return result("distress", language, distress.strength, distress.label);
  const harassment = firstMatch(text, HARASSMENT);
  if (harassment)
    return result(
      "harassment_report",
      language,
      harassment.strength,
      harassment.label,
    );
  const hazard = firstMatch(text, HAZARD);
  if (hazard)
    return result(
      "infrastructure_hazard",
      language,
      hazard.strength,
      hazard.label,
    );
  const concern = firstMatch(text, CONCERN);
  if (concern)
    return result("concern", language, concern.strength, concern.label);
  const broader = lexical(text, language);
  if (broader) return broader;
  return result(
    "general",
    language,
    "none",
    "No safety-related pattern matched",
  );
}
