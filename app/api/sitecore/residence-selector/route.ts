import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SITECORE_QUERY = `
query ProvinceCityResidenceSelector($datasource: String!, $language: String!) {
  dsEn: item(path: $datasource, language: "en") {
    ...residences
  }

  dsFr: item(path: $datasource, language: "fr") {
    ...residences
  }

  careServices: item(path: $datasource, language: $language) {
    ...careServices
  }

  province: item(path: $datasource, language: $language) {
    ...province
  }
}

# =========================
# RESIDENCES
# =========================
fragment residences on Item {
  residences: field(name: "ResidenceSelector") {
    ... on MultilistField {
      targetItems {
        id
        name

        # which languages exist for this residence
        languages {
          language {
            name
          }
        }

        # main residence page URL
        url {
          path
        }

        propertyId: field(name: "PropertyID") {
          value
        }

        propertyName: field(name: "Property Name") {
          value
        }

        navigationTitle: field(name: "NavigationTitle") {
          value
        }

        contactNumber: field(name: "Contact Number") {
          value
        }

        streetNameAndNumber: field(name: "StreetNameAndNumber") {
          value
        }

        postalCode: field(name: "Postal code") {
          value
        }

        isPriorityProperty: field(name: "isPriorityProperty") {
          ... on CheckboxField {
            boolValue
          }
        }

        # =========================
        # SUITE PLANS
        # =========================
        propertySuitPlans: field(name: "Property Suit Plans") {
          ... on MultilistField {
            targetItems {
              id
              name

              regularPrice: field(name: "Regular SuitePrice") {
                value
              }

              promoPrice: field(name: "Promotion Price") {
                value
              }

              promoStartDate: field(name: "Start Date") {
                jsonValue
              }

              promoEndDate: field(name: "End Date") {
                jsonValue
              }
            }
          }
        }

        # =========================
        # CITY / SUBCITY
        # =========================
        city: field(name: "City") {
          ... on MultilistField {
            targetItems {
              id
              name

              languages {
                language {
                  name
                }
              }

              cityName: field(name: "City Name") {
                value
              }

              lat: field(name: "Lat") {
                value
              }

              lng: field(name: "Lng") {
                value
              }

              subCity: field(name: "SubCity") {
                ... on MultilistField {
                  targetItems {
                    id
                    name

                    languages {
                      language {
                        name
                      }
                    }

                    subCityName: field(name: "City Name") {
                      value
                    }

                    cityLandingPage: field(name: "CityLandingPage") {
                      ... on LinkField {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }

        # =========================
        # PROVINCE (FOR RESIDENCE)
        # =========================
        province: field(name: "Province") {
          ... on MultilistField {
            targetItems {
              id
              name

              languages {
                language {
                  name
                }
              }

              provinceName: field(name: "Province Name") {
                value
              }

              provinceAbbreviation: field(name: "Province Abbreviation") {
                value
              }
            }
          }
        }

        # =========================
        # LIVING OPTIONS
        # =========================
        livingOption: field(name: "Living Option") {
          ... on MultilistField {
            targetItems {
              id
              name

              sortOrder: field(name: "__Sortorder") {
                value
              }

              careService: field(name: "Care Service") {
                jsonValue
              }

              careServiceIcon: field(name: "Care Service Icon") {
                jsonValue
              }
            }
          }
        }
      }
    }
  }
}

# =========================
# CARE SERVICES
# =========================
fragment careServices on Item {
  careService: field(name: "CareServices") {
    ... on MultilistField {
      targetItems {
        id
        name

        sortOrder: field(name: "__Sortorder") {
          value
        }

        languages {
          language {
            name
          }
        }

        careServiceName: field(name: "Care Service") {
          value
        }

        careServiceIcon: field(name: "Care Service Icon") {
          jsonValue
        }
      }
    }
  }
}

# =========================
# PROVINCE
# =========================
fragment province on Item {
  province: field(name: "ProvinceSelector") {
    ... on MultilistField {
      targetItems {
        id
        name

        languages {
          language {
            name
          }
        }

        provinceName: field(name: "Province Name") {
          value
        }

        provinceAbbreviation: field(name: "Province Abbreviation") {
          value
        }

        searchLink: field(name: "SearchLink") {
          ... on LinkField {
            url
          }
        }
      }
    }
  }
}



`;

function toJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

export async function GET(request: Request) {
  const endpoint = process.env.SITECORE_GRAPHQL_ENDPOINT;
  const datasource = process.env.SITECORE_RESIDENCE_DATASOURCE;
  const edgeContextId = process.env.SITECORE_EDGE_CONTEXT_ID;
  const gqlToken = process.env.SITECORE_GQL_TOKEN;
  const { searchParams } = new URL(request.url);
  const languageParam = searchParams.get("language");
  const language = languageParam === "en" ? "en" : "fr";

  if (!endpoint) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing SITECORE_GRAPHQL_ENDPOINT",
      },
      { status: 500 },
    );
  }

  if (!datasource) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing SITECORE_RESIDENCE_DATASOURCE",
      },
      { status: 500 },
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (gqlToken) headers["X-GQL-TOKEN"] = gqlToken;
  if (edgeContextId) headers["sc_apikey"] = edgeContextId;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({
      query: SITECORE_QUERY,
      variables: {
        datasource,
        language,
      },
    }),
  });

  const raw = await response.text();
  const payload = toJson(raw);

  console.log(
    "[sitecore][residence-selector] Response payload:\n",
    JSON.stringify(payload, null, 2),
  );

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: response.status,
        payload,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    payload,
  });
}
