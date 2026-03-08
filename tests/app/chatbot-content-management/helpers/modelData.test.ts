import { describe, expect, it } from "vitest";
import {
  careServiceValues,
  modelData,
  populateModelData,
  provinceValues,
} from "@/app/chatbot-content-management/helpers";

const sitecoreData = {
  dsEn: {
    residences: {
      targetItems: [
        {
          id: "res-en",
          propertyId: { value: "200" },
          language: { name: "en" },
          languages: [{ language: { name: "en" } }],
          navigationTitle: { value: "Residence English" },
          city: {
            targetItems: [
              { id: "city-en", name: "Toronto", cityName: { value: "Toronto" } },
            ],
          },
          province: {
            targetItems: [{ id: "on", provinceName: { value: "Ontario" } }],
          },
          streetNameAndNumber: { value: "1 Main St" },
          postalCode: { value: "A1A1A1" },
          livingOption: { targetItems: [{ id: "cs-en-2" }, { id: "cs-en-1" }] },
          url: { path: "/res-en" },
          contactNumber: { value: "111-111-1111" },
        },
      ],
    },
  },
  dsFr: {
    residences: {
      targetItems: [
        {
          id: "res-fr",
          propertyId: { value: "100" },
          language: { name: "fr" },
          languages: [{ language: { name: "fr" } }],
          navigationTitle: { value: "Residence Francaise" },
          city: {
            targetItems: [
              { id: "city-fr", name: "Montreal", cityName: { value: "Montreal" } },
            ],
          },
          province: {
            targetItems: [{ id: "qc", provinceName: { value: "Quebec" } }],
          },
          streetNameAndNumber: { value: "2 Rue Centrale" },
          postalCode: { value: "H1H1H1" },
          livingOption: { targetItems: [{ id: "cs-fr" }] },
          url: { path: "/res-fr" },
          contactNumber: { value: "222-222-2222" },
        },
      ],
    },
  },
  careServices: {
    careService: {
      targetItems: [
        {
          id: "cs-en-1",
          careServiceName: { value: "Independent Living" },
          sortOrder: { value: "1" },
          languages: [{ language: { name: "en" } }],
        },
        {
          id: "cs-en-2",
          careServiceName: { value: "Assisted Living" },
          sortOrder: { value: "2" },
          languages: [{ language: { name: "en" } }],
        },
        {
          id: "cs-fr",
          careServiceName: { value: "Soins memoire" },
          sortOrder: { value: "1" },
          languages: [{ language: { name: "fr" } }],
        },
      ],
    },
  },
  province: {
    province: {
      targetItems: [
        { id: "on", provinceName: { value: "Ontario" }, languages: [{ language: { name: "en" } }] },
        { id: "qc", provinceName: { value: "Quebec" }, languages: [{ language: { name: "fr" } }] },
      ],
    },
  },
};

describe("chatbot-content-management helpers", () => {
  it("maps care service names by language and selected ids", () => {
    const values = careServiceValues(
      sitecoreData.careServices.careService.targetItems,
      "en",
      [{ id: "cs-en-1" }, { id: "cs-fr" }],
    );

    expect(values).toEqual(["Independent Living"]);
  });

  it("maps province labels by language", () => {
    const value = provinceValues(
      sitecoreData.province.province.targetItems,
      "fr",
      [{ id: "qc" }],
    );

    expect(value).toBe("Quebec");
  });

  it("returns residence rows sorted by propertyId", () => {
    const allRows = modelData(sitecoreData as any, "en");
    const mappedRows = allRows.filter(
      (row) => !("provinces" in row) && !("careServices" in row),
    );

    expect(mappedRows.map((row) => row.propertyId)).toEqual(["100", "200"]);
  });

  it("filters populated model data by province id", () => {
    const rows = populateModelData(
      {
        combinedResidences: [
          ...(sitecoreData.dsEn.residences.targetItems as any[]),
          ...(sitecoreData.dsFr.residences.targetItems as any[]),
        ],
        combinedCareServices: sitecoreData.careServices.careService.targetItems as any[],
        combinedPromotions: [],
        combinedProvinces: sitecoreData.province.province.targetItems as any[],
      },
      "fr",
      "qc",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].provinceId).toBe("qc");
    expect(rows[0].propertyId).toBe("100");
  });
});
