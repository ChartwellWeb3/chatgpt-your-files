import { ChatBotRenderProvinceUniqueCities } from "./ChatBotRenderProvinceUniqueCities";
import {
  type MappedResidence,
  type ModelDataResult,
  type ProvinceItem,
} from "../helpers";

export const ChatBotDownloadResDataSection = ({
  residences,
  language,
}: {
  residences: ModelDataResult | null;
  language: "en" | "fr";
}) => {
  if (!residences || !Array.isArray(residences) || residences.length === 0)
    return null;

  const mappedResidences: MappedResidence[] = residences.filter(
    (item): item is MappedResidence => "residence" in item,
  );

  if (mappedResidences.length === 0) return null;

  const provincesBucket = residences.find(
    (item): item is { provinces: ProvinceItem[] } => "provinces" in item,
  );
  const provinces = provincesBucket?.provinces ?? [];

  const fallbackProvinceNames: Record<
    string,
    { en: string; fr: string }
  > = {
    "B597245749ED4FF5814BA1BC4EB6A8F6": { en: "Ontario", fr: "Ontario" },
    "6EA6CA8A31324DF9ADA21F76F74423E1": { en: "Alberta", fr: "Alberta" },
    "DA06260B605342C2917488F8C48D60B8": { en: "Quebec", fr: "Quebec" },
    "5168A2A6A297495BADD82845FDDC7A79": {
      en: "British Columbia",
      fr: "Colombie-Britannique",
    },
  };

  const getProvinceLabel = (provinceId: string) => {
    const province = provinces.find((p) => p.id === provinceId);
    const localized =
      province?.provinceName?.value || province?.field?.value || province?.name;
    if (localized && localized.trim()) return localized.trim();
    return fallbackProvinceNames[provinceId]?.[language] ?? "Unknown";
  };

  const provinceConfigs = [
    { id: "DA06260B605342C2917488F8C48D60B8" },
    { id: "6EA6CA8A31324DF9ADA21F76F74423E1" },
    { id: "5168A2A6A297495BADD82845FDDC7A79" },
    { id: "B597245749ED4FF5814BA1BC4EB6A8F6" },
  ];

  return (
    <div className="flex flex-col items-start justify-start gap-4">
      {provinceConfigs.map(({ id }) => {
        const provinceResidences = mappedResidences.filter(
          (r) => r.provinceId === id,
        );

        if (provinceResidences.length === 0) return null;

        return (
          <ChatBotRenderProvinceUniqueCities
            key={id}
            residences={provinceResidences}
            province={getProvinceLabel(id)}
            language={language}
          />
        );
      })}
    </div>
  );
};
