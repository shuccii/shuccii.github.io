/**
 * IP から引いた地域情報(英字)を日本語の表示名へ変換するための対応表。
 *
 * ipwho.is は ISO 3166-2 の都道府県番号(region_code: "01"〜"47")を返すので、
 * 番号が取れたときは番号を優先する。番号がない API(GeoJS など)向けに、
 * 英字表記(Nara, Ōsaka など)からも引けるようにしてある。
 */

export const JP_PREFECTURES: Record<string, { ja: string; en: string }> = {
  "01": { ja: "北海道", en: "Hokkaido" },
  "02": { ja: "青森県", en: "Aomori" },
  "03": { ja: "岩手県", en: "Iwate" },
  "04": { ja: "宮城県", en: "Miyagi" },
  "05": { ja: "秋田県", en: "Akita" },
  "06": { ja: "山形県", en: "Yamagata" },
  "07": { ja: "福島県", en: "Fukushima" },
  "08": { ja: "茨城県", en: "Ibaraki" },
  "09": { ja: "栃木県", en: "Tochigi" },
  "10": { ja: "群馬県", en: "Gunma" },
  "11": { ja: "埼玉県", en: "Saitama" },
  "12": { ja: "千葉県", en: "Chiba" },
  "13": { ja: "東京都", en: "Tokyo" },
  "14": { ja: "神奈川県", en: "Kanagawa" },
  "15": { ja: "新潟県", en: "Niigata" },
  "16": { ja: "富山県", en: "Toyama" },
  "17": { ja: "石川県", en: "Ishikawa" },
  "18": { ja: "福井県", en: "Fukui" },
  "19": { ja: "山梨県", en: "Yamanashi" },
  "20": { ja: "長野県", en: "Nagano" },
  "21": { ja: "岐阜県", en: "Gifu" },
  "22": { ja: "静岡県", en: "Shizuoka" },
  "23": { ja: "愛知県", en: "Aichi" },
  "24": { ja: "三重県", en: "Mie" },
  "25": { ja: "滋賀県", en: "Shiga" },
  "26": { ja: "京都府", en: "Kyoto" },
  "27": { ja: "大阪府", en: "Osaka" },
  "28": { ja: "兵庫県", en: "Hyogo" },
  "29": { ja: "奈良県", en: "Nara" },
  "30": { ja: "和歌山県", en: "Wakayama" },
  "31": { ja: "鳥取県", en: "Tottori" },
  "32": { ja: "島根県", en: "Shimane" },
  "33": { ja: "岡山県", en: "Okayama" },
  "34": { ja: "広島県", en: "Hiroshima" },
  "35": { ja: "山口県", en: "Yamaguchi" },
  "36": { ja: "徳島県", en: "Tokushima" },
  "37": { ja: "香川県", en: "Kagawa" },
  "38": { ja: "愛媛県", en: "Ehime" },
  "39": { ja: "高知県", en: "Kochi" },
  "40": { ja: "福岡県", en: "Fukuoka" },
  "41": { ja: "佐賀県", en: "Saga" },
  "42": { ja: "長崎県", en: "Nagasaki" },
  "43": { ja: "熊本県", en: "Kumamoto" },
  "44": { ja: "大分県", en: "Oita" },
  "45": { ja: "宮崎県", en: "Miyazaki" },
  "46": { ja: "鹿児島県", en: "Kagoshima" },
  "47": { ja: "沖縄県", en: "Okinawa" },
};

/** 長音記号・大文字小文字・"Prefecture" の有無を吸収して比較できる形にする */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bprefecture\b/g, "")
    .replace(/[^a-z]/g, "");
}

const BY_EN_NAME = new Map<string, string>();
for (const [code, { en }] of Object.entries(JP_PREFECTURES)) {
  BY_EN_NAME.set(normalize(en), code);
}
// 表記ゆれ(API によって綴りが異なるもの)
BY_EN_NAME.set("gumma", "10");
BY_EN_NAME.set("hukuoka", "40");
BY_EN_NAME.set("naha", "47");
BY_EN_NAME.set("tokyoto", "13");
BY_EN_NAME.set("osakafu", "27");
BY_EN_NAME.set("kyotofu", "26");

/**
 * 都道府県番号(なければ英字名)から日本語の県名を返す。
 * 日本以外や、対応が見つからないときは null。
 */
export function toJapanesePrefecture(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined,
  regionName: string | null | undefined,
): string | null {
  if (countryCode && countryCode.toUpperCase() !== "JP") return null;

  if (regionCode) {
    const padded = String(regionCode).replace(/^JP-/i, "").padStart(2, "0");
    const hit = JP_PREFECTURES[padded];
    if (hit) return hit.ja;
  }

  if (regionName) {
    const code = BY_EN_NAME.get(normalize(regionName));
    if (code) return JP_PREFECTURES[code].ja;
  }

  return null;
}

const COUNTRY_JA: Record<string, string> = {
  JP: "日本",
  US: "アメリカ",
  CN: "中国",
  KR: "韓国",
  TW: "台湾",
  GB: "イギリス",
  DE: "ドイツ",
  FR: "フランス",
  CA: "カナダ",
  AU: "オーストラリア",
  IN: "インド",
  SG: "シンガポール",
  TH: "タイ",
  VN: "ベトナム",
  BR: "ブラジル",
  NL: "オランダ",
};

/** 国名の表示用。対応表にない国は API が返した英語名をそのまま使う。 */
export function toJapaneseCountry(
  countryCode: string | null | undefined,
  countryName: string | null | undefined,
): string {
  const code = countryCode?.toUpperCase() ?? "";
  return COUNTRY_JA[code] ?? countryName ?? "不明";
}
