type LanguageCode = "en" | "fr" | (string & {});

type LanguageName = string;

type LanguageRef = {
  name?: LanguageName;
};

type LanguageCarrier = {
  language?: LanguageRef | LanguageName;
};

type LanguageMatchable = {
  language?: LanguageRef | LanguageName;
  languages?: Array<{ language?: LanguageRef }>;
};

type FieldValue = {
  value?: string;
};

type CheckboxField = {
  boolValue?: boolean;
};

type SortOrderField = {
  value?: string | number;
};

type JsonValueField = {
  jsonValue?: unknown;
};

type PropertySuitPlan = {
  id?: string;
  name?: string;
  regularPrice?: FieldValue;
  promoPrice?: FieldValue;
  promoStartDate?: JsonValueField;
  promoEndDate?: JsonValueField;
};

type LinkField = {
  url?: {
    path?: string;
  };
  targetItem?: {
    cityLandingPageLinks?: Array<{
      url?: { path?: string };
      language?: LanguageRef;
    }>;
  };
};

type MultilistField<TItem> = {
  targetItems?: TItem[];
  targetItem?: TItem;
};

type CityLanguage = {
  language?: LanguageRef;
  field?: FieldValue;
  lat?: FieldValue;
  lng?: FieldValue;
};

type CityItem = LanguageCarrier & {
  id?: string;
  name?: string;
  cityName?: FieldValue;
  lat?: FieldValue;
  lng?: FieldValue;
  languages?: CityLanguage[];
  subCity?: MultilistField<SubCityItem>;
  cityLandingPage?: LinkField;
};

type SubCityLanguage = {
  language?: LanguageRef;
  field?: FieldValue;
};

type SubCityItem = LanguageCarrier & {
  id?: string;
  name?: string;
  subCityName?: FieldValue;
  languages?: SubCityLanguage[];
  cityLandingPage?: LinkField;
};

export type ProvinceItem = LanguageCarrier & {
  id?: string;
  name?: string;
  provinceName?: FieldValue;
  field?: FieldValue;
  provinceAbbreviation?: FieldValue;
  languages?: Array<{ language?: LanguageRef }>;
};

type CareServiceItem = LanguageCarrier & {
  id?: string;
  name?: string;
  careServiceName?: FieldValue;
  field?: FieldValue;
  sortOrder?: SortOrderField;
  languages?: Array<{ language?: LanguageRef }>;
};

export type CareServiceItemNormalized = Omit<CareServiceItem, "sortOrder"> & {
  sortOrder: number;
};

type PromotionItem = LanguageCarrier & {
  id?: string;
};

type CareServiceRef = {
  id?: string;
};

type ResidenceItem = LanguageCarrier & {
  id?: string;
  _language?: string;
  languages?: Array<{ language?: LanguageRef }>;
  propertyId?: FieldValue;
  navigationTitle?: FieldValue;
  propertySuitPlans?: MultilistField<PropertySuitPlan>;
  city?: MultilistField<CityItem>;
  province?: MultilistField<ProvinceItem>;
  provinceSelector?: MultilistField<ProvinceItem>;
  provinceId?: FieldValue | string;
  provinceName?: FieldValue | string;
  streetNameAndNumber?: FieldValue;
  postalCode?: FieldValue;
  Latitude?: FieldValue;
  Longitude?: FieldValue;
  lat?: FieldValue;
  lng?: FieldValue;
  url?: { path?: string };
  contactNumber?: FieldValue;
  livingOption?: MultilistField<CareServiceRef>;
  bilingual?: CheckboxField;
};

type ResidenceSelectorData = {
  dsEn?: { residences?: MultilistField<ResidenceItem> };
  dsFr?: { residences?: MultilistField<ResidenceItem> };
  careServices?: { careService?: MultilistField<CareServiceItem> };
  promos?: { promotion?: MultilistField<PromotionItem> };
  province?: { province?: MultilistField<ProvinceItem> };
};

type ResidenceSelectorWrapper = {
  fields?: { data?: ResidenceSelectorData };
  data?: ResidenceSelectorData;
};

type ResidenceSelectorInput =
  | ResidenceSelectorData
  | ResidenceSelectorWrapper
  | null
  | undefined;

type ResidenceData = {
  combinedResidences: ResidenceItem[];
  combinedCareServices: CareServiceItem[];
  combinedPromotions: PromotionItem[];
  combinedProvinces: ProvinceItem[];
};

type ResidenceDataWrapper = {
  ResidenceData: ResidenceData;
};

export type MappedResidence = {
  propertyId?: string;
  residence: ResidenceItem;
  language?: string;
  bilingual: boolean;
  residenceId?: string;
  residenceName?: string;
  cityId?: string;
  cityName?: string;
  propertySuitPlans?: PropertySuitPlan[];
  cityNameDisplay: string;
  provinceId?: string;
  provinceName: string;
  residenceAddress: string;
  postalCode?: string;
  Lat?: string;
  Lng?: string;
  cityLat?: string;
  cityLng?: string;
  url?: string;
  contactNumber?: string;
  livingOption: string[];
  livingOptions: CareServiceItem[];
};

export type ModelDataResult = Array<
  | MappedResidence
  | { provinces: ProvinceItem[] }
  | { careServices: CareServiceItemNormalized[] }
>;

const matchesLanguage = (
  item: LanguageMatchable | null | undefined,
  language: string,
) => {
  if (!language) return true;
  const itemLanguage =
    typeof item?.language === "string"
      ? item.language
      : item?.language?.name;
  if (itemLanguage) return itemLanguage === language;
  const languages = item?.languages;
  if (Array.isArray(languages)) {
    return languages.some((l) => l?.language?.name === language);
  }
  return true;
};

const toArray = <T>(value: T | T[] | null | undefined) =>
  Array.isArray(value) ? value : value ? [value] : [];

const extractResidenceData = (
  input: ResidenceSelectorInput,
): ResidenceSelectorData | undefined => {
  if (!input) return undefined;
  const wrapper = input as ResidenceSelectorWrapper;
  if (wrapper.fields?.data || wrapper.data) {
    return wrapper.fields?.data ?? wrapper.data;
  }
  return input as ResidenceSelectorData;
};

function deStructureProps(
  props: ResidenceSelectorInput,
): ResidenceDataWrapper {
  const dataRoot = extractResidenceData(props);
  if (!dataRoot?.dsEn || !dataRoot?.dsFr) {
    return {
      ResidenceData: {
        combinedResidences: [],
        combinedCareServices: [],
        combinedPromotions: [],
        combinedProvinces: [],
      },
    };
  }

  const residencesEn = dataRoot?.dsEn?.residences;
  const residencesFr = dataRoot?.dsFr?.residences;
  const residenceListEn = residencesEn?.targetItems ?? [];
  const residenceListFr = residencesFr?.targetItems ?? [];

  const residenceListEnWithLang = residenceListEn.map((residence) => ({
    ...residence,
    language: residence?.language ?? { name: "en" },
  }));
  const residenceListFrWithLang = residenceListFr.map((residence) => ({
    ...residence,
    language: residence?.language ?? { name: "fr" },
  }));

  const careServicesList =
    dataRoot?.careServices?.careService?.targetItems ?? [];
  const promosList = dataRoot?.promos?.promotion?.targetItems ?? [];
  const provincesList = dataRoot?.province?.province?.targetItems ?? [];

  return {
    ResidenceData: {
      combinedResidences: residenceListEnWithLang.concat(
        residenceListFrWithLang,
      ),
      combinedCareServices: careServicesList,
      combinedPromotions: promosList,
      combinedProvinces: provincesList,
    },
  };
}



export const careServiceValues = (
  combinedCareServices: CareServiceItem[] | null | undefined,
  language: LanguageCode,
  careServices: CareServiceRef[] | null | undefined,
): string[] => {
  const careServiceIds = (careServices ?? [])
    .map((el) => el.id)
    .filter((id): id is string => Boolean(id));
  const careServiceNames = (combinedCareServices ?? [])
    .filter((el) => (el.id ? careServiceIds.includes(el.id) : false))
    .filter((el) => matchesLanguage(el, language))
    .map(
      (el) =>
        el?.careServiceName?.value || el?.field?.value || el?.name || "",
    );
  // ?.join(" | ");
  return careServiceNames || [];
};

export const careServiceObj = (
  combinedCareServices: CareServiceItem[] | null | undefined,
  language: LanguageCode,
  careServices: CareServiceRef[] | null | undefined,
) => {
  const careServiceIds = (careServices ?? [])
    .map((el) => el.id)
    .filter((id): id is string => Boolean(id));
  const careServiceObjs = (combinedCareServices ?? [])
    .filter((el) => (el.id ? careServiceIds.includes(el.id) : false))
    .filter((el) => matchesLanguage(el, language));
  return careServiceObjs || [];
};

export const provinceValues = (
  combinedProvinces: ProvinceItem[] | null | undefined,
  language: LanguageCode,
  province: ProvinceItem[] | null | undefined,
) => {
  const provinceIds = (province ?? [])
    .map((el) => el.id)
    .filter((id): id is string => Boolean(id));
  const provinceNames = (combinedProvinces ?? [])
    .filter((el) => (el.id ? provinceIds.includes(el.id) : false))
    .filter((el) => matchesLanguage(el, language))
    .map(
      (el) =>
        el?.provinceName?.value || el?.field?.value || el?.name || "",
    )
    .join(" | ");
  return provinceNames || "";
};



export function populateModelData(
  residenceData: ResidenceData | null | undefined,
  language: LanguageCode,
  selectedProvinceId?: string,
): MappedResidence[] {
  if (!residenceData) return [];

  const mappedResidences = residenceData?.combinedResidences
    ?.map((residence) => {
      const isBilingual =
        residence?.bilingual?.boolValue ??
        (Array.isArray(residence?.languages) &&
          residence.languages.length > 1);
      const residenceLanguage =
        typeof residence?.language === "string"
          ? residence.language
          : residence?.language?.name ?? residence?._language;
      const localeForResidence = !isBilingual
        ? language
        : residenceLanguage || language;
      const cityItem = residence?.city?.targetItems?.[0];
      const cityNameDisplay =
        cityItem?.languages?.find((x) => x?.language?.name === language)
          ?.field?.value ??
        cityItem?.cityName?.value ??
        cityItem?.name ??
        "";
      const cityLat = cityItem?.lat?.value ?? cityItem?.languages?.[0]?.lat?.value;
      const cityLng = cityItem?.lng?.value ?? cityItem?.languages?.[0]?.lng?.value;
      const provinceTargetItems: ProvinceItem[] = [
        ...(residence?.province?.targetItems ?? []),
        ...(residence?.provinceSelector?.targetItems ?? []),
        ...toArray<ProvinceItem>(residence?.province?.targetItem),
        ...toArray<ProvinceItem>(residence?.provinceSelector?.targetItem),
      ];
      const provinceIdFallback =
        provinceTargetItems?.[0]?.id ??
        (typeof residence?.provinceId === "string"
          ? residence.provinceId
          : residence?.provinceId?.value);
      const provinceNameFallback =
        (typeof residence?.provinceName === "string"
          ? residence.provinceName
          : residence?.provinceName?.value) ??
        provinceTargetItems?.[0]?.provinceName?.value ??
        provinceTargetItems?.[0]?.name ??
        "";
      const localizedProvince =
        provinceValues(
          residenceData.combinedProvinces,
          localeForResidence,
          provinceTargetItems,
        ) || provinceNameFallback;
      const localizedCareService =
        careServiceValues(
          residenceData.combinedCareServices,
          localeForResidence,
          residence?.livingOption?.targetItems,
        ) || [];
      // const localizedPromo = promoValues(residenceData.combinedPromotions, !residence?.bilingual?.boolValue ? router.locale : residence?.language?.name, residence?.assignedPromos?.targetItems) || "";
      const localizedCareServiceObj =
        careServiceObj(
          residenceData.combinedCareServices,
          localeForResidence,
          residence?.livingOption?.targetItems,
        ) || [];

      return {
        propertyId: residence?.propertyId?.value,
        residence: residence,
        language: residenceLanguage,
        bilingual: isBilingual,
        residenceId: residence?.id,
        residenceName: residence?.navigationTitle?.value,
        cityId: cityItem?.id,
        cityName: cityItem?.name,
        propertySuitPlans: residence?.propertySuitPlans?.targetItems,
        cityNameDisplay,
        provinceId: provinceIdFallback,
        provinceName: localizedProvince || "",
        residenceAddress:
          (residence?.streetNameAndNumber?.value +
            ", " +
            (cityNameDisplay || cityItem?.name || "")) +
          ", " +
          (language === "fr"
            ? "(" + localizedProvince + ") "
            : localizedProvince + " ") +
          residence?.postalCode?.value,
        postalCode: residence?.postalCode?.value,
        Lat: residence?.Latitude?.value ?? residence?.lat?.value ?? cityLat,
        Lng: residence?.Longitude?.value ?? residence?.lng?.value ?? cityLng,
        cityLat,
        cityLng,
        url: residence?.url?.path,
        contactNumber: residence?.contactNumber?.value,
        livingOption: localizedCareService || [],
        livingOptions: localizedCareServiceObj || [],
        // assignedPromos: localizedPromo || "",
      };
    })
    .filter((residence) =>
      selectedProvinceId
        ? (residence.language === language || !residence.bilingual) &&
          residence.provinceId === selectedProvinceId
        : residence.language === language || !residence.bilingual,
    )
    .sort((a, b) => {
      const aId = a.propertyId ?? "";
      const bId = b.propertyId ?? "";
      return aId.localeCompare(bId);
    });
  return mappedResidences || [];
}

export function modelData(
  data: ResidenceSelectorData | null | undefined,
  language: LanguageCode,
): ModelDataResult {
  // Destructure to avoid repeated property access
  // Destructure data for cleaner access
  const { ResidenceData } = deStructureProps(data);
  const { combinedProvinces, combinedCareServices } = ResidenceData;

  // Filter operations optimized by directly accessing properties
  const provincesObj = (combinedProvinces ?? []).filter((p) =>
    matchesLanguage(p, language),
  );
  const careServicesObj: CareServiceItemNormalized[] = (combinedCareServices ?? [])
    .filter((p) => matchesLanguage(p, language))
    .map((c) => ({
      ...c,
      sortOrder: (() => {
        const raw =
          c?.sortOrder?.value ??
          combinedCareServices?.find((f) => f.id === c.id)?.sortOrder?.value;
        if (typeof raw === "number") return raw;
        if (typeof raw === "string") return Number(raw) || 0;
        return 0;
      })(),
    }))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  // Return statement optimized for readability
  return [
    ...populateModelData(ResidenceData, language, ""),
    { provinces: provincesObj },
    { careServices: careServicesObj },
  ];
}
