"use client";

import { useMemo } from "react";

type LanguageCode = "en" | "fr";

type ResidenceItem = {
  propertyId?: string;
  residenceId?: string;
  residenceName?: string;

  cityId?: string;
  cityName?: string;
  cityNameDisplay?: string;
  language?: string;

  provinceName?: string;
  postalCode?: string;
  residenceAddress?: string;

  url?: string;
  contactNumber?: string;
  bookATourLink?: string;

  imageSrc?: string;
  imageAlt?: string;

  livingOption?: string[];
  livingOptions?: Array<{
    id?: string;
    field?: { value?: string };
    careServiceName?: { value?: string };
  }>;

  propertySuitPlans?: Array<{
    regularPrice?: { value?: string };
    promoPrice?: { value?: string };
  }>;

  careServiceAvailable?: boolean;
  careServiceAvailableText?: string;
};

function normalizeCityName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const COPY: Record<
  LanguageCode,
  {
    unknownCity: string;
    headerPrefix: string;
    headerSuffix: string;
    nameLabel: string;
    addressLabel: string;
    livingOptionsLabel: string;
    careServicesLabel: string;
    priceFromLabel: string;
    phoneLabel: string;
    fileTitle: string;
  }
> = {
  en: {
    unknownCity: "Unknown city",
    headerPrefix: "Retirement Homes in",
    headerSuffix: "Find a right residence,retirement home, in",
    nameLabel: "Name",
    addressLabel: "Address",
    livingOptionsLabel: "Living Options",
    careServicesLabel: "Care services available",
    priceFromLabel: "Price starting from",
    phoneLabel: "Phone number",
    fileTitle: "Retirement Homes in",
  },
  fr: {
    unknownCity: "Ville inconnue",
    headerPrefix: "Residences pour retraites en",
    headerSuffix: "Trouvez une residence, maison de retraite, a",
    nameLabel: "Nom",
    addressLabel: "Adresse",
    livingOptionsLabel: "Services offerts",
    careServicesLabel: "Services de soins offerts",
    priceFromLabel: "Prix a partir de",
    phoneLabel: "Telephone",
    fileTitle: "Residences pour retraites en",
  },
};

function getCityLabel(item: ResidenceItem, language: LanguageCode) {
  return (
    item.cityNameDisplay?.trim() ||
    item.cityName?.trim() ||
    COPY[language].unknownCity
  );
}

function getCityKey(item: ResidenceItem, language: LanguageCode) {
  if (item.cityId && item.cityId.trim()) return `id:${item.cityId.trim()}`;
  return `name:${normalizeCityName(getCityLabel(item, language))}`;
}

function extractLivingOptions(item: ResidenceItem): string[] {
  if (Array.isArray(item.livingOption) && item.livingOption.length) {
    return item.livingOption.filter(Boolean);
  }

  const fromLivingOptions =
    item.livingOptions
      ?.map((x) => x.careServiceName?.value || x.field?.value || "")
      .filter(Boolean) ?? [];

  return Array.from(new Set(fromLivingOptions));
}

function parsePrice(val?: string) {
  if (!val) return null;
  const n = Number(String(val).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function getPriceRange(item: ResidenceItem, language: LanguageCode) {
  const prices =
    item.propertySuitPlans
      ?.map(
        (p) =>
          parsePrice(p.promoPrice?.value) ?? parsePrice(p.regularPrice?.value),
      )
      .filter((x): x is number => x != null) ?? [];

  if (!prices.length) return null;

  const min = Math.min(...prices);

  const fmt = new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });

  return fmt.format(min);
}

function groupByCity(items: ResidenceItem[], language: LanguageCode) {
  const map = new Map<string, { label: string; items: ResidenceItem[] }>();

  for (const item of items) {
    const key = getCityKey(item, language);
    const label = getCityLabel(item, language);

    const existing = map.get(key);
    if (existing) {
      const betterLabel =
        existing.label === COPY[language].unknownCity &&
        label !== COPY[language].unknownCity
          ? label
          : existing.label;

      map.set(key, { label: betterLabel, items: [...existing.items, item] });
    } else {
      map.set(key, { label, items: [item] });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/**
 * ✅ Builds markdown EXACTLY like your example file:
 * # Retirement Homes in Alberta. Find a right residence in Calgary
 *
 * Name: ...; Address: ...; ...
 *
 * (blank line between entries)
 */
function buildMarkdownForProvince(
  province: string,
  groups: { label: string; items: ResidenceItem[] }[],
  language: LanguageCode,
) {
  const copy = COPY[language];
  const lines: string[] = [];

  for (const group of groups) {
    // City section header
    lines.push(
      `# ${copy.headerPrefix} ${province}. ${copy.headerSuffix} ${group.label}`,
    );
    lines.push("");

    for (const r of group.items) {
      const living = extractLivingOptions(r);
      const priceRange = getPriceRange(r, language);

      const parts: string[] = [];
      parts.push(`${copy.nameLabel}: ${r.residenceName}`);

      if (r.residenceAddress)
        parts.push(`${copy.addressLabel}: ${r.residenceAddress}`);

      if (living.length)
        parts.push(`${copy.livingOptionsLabel}: ${living.join(", ")}`);

      if (r.careServiceAvailable) {
        parts.push(r.careServiceAvailableText || copy.careServicesLabel);
      }

      if (priceRange) parts.push(`${copy.priceFromLabel}: ${priceRange}`);

      if (r.contactNumber) parts.push(`${copy.phoneLabel}: ${r.contactNumber}`);

      if (r.url) {
        const url = r.language === "en" ? r.url : `fr${r.url}`;
        parts.push(`url:${url}`);
      }
      lines.push(parts.join("; ") + ";");
      lines.push(""); // blank line between residences (matches your file)
      lines.push(""); // extra blank line like your example
    }

    // extra spacing between city sections
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ChatBotRenderProvinceUniqueCities({
  residences,
  province,
  language,
}: {
  residences: ResidenceItem[];
  province: string;
  language: LanguageCode;
}) {
  const groups = useMemo(
    () => groupByCity(residences, language),
    [residences, language],
  );

  const md = useMemo(
    () => buildMarkdownForProvince(province, groups, language),
    [province, groups, language],
  );
  const fileTitle = COPY[language].fileTitle;

  return (
    <div className="space-y-6 mx-auto">
      {/* Province header row + Download button */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{province}</h2>

        <button
          onClick={() => {
            const safeTitle = sanitizeFileName(fileTitle);
            const safeProvince = sanitizeFileName(province);
            const filename = `${safeTitle} ${safeProvince}.md`;
            downloadTextFile(filename, md);
          }}
          className="rounded-lg border px-3 py-2 text-sm hover:bg-muted transition"
        >
          Download .md
        </button>
      </div>
    </div>
  );
}
