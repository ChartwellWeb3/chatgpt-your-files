type Level = 1 | 2 | 3;

type AllowedPrefix = { name: string; path: string };

const PREFIXES: Record<string, AllowedPrefix> = {
  home: { name: "Home", path: "/" },
  content: {
    name: "Chatbot Content Management",
    path: "/chatbot-content-management",
  },
  sitecoreResidenceSelectorApi: {
    name: "Sitecore Residence Selector API",
    path: "/api/sitecore/residence-selector",
  },
  analytics: { name: "Chat Bot Analytics", path: "/chat-bot-analytics" },
  promptTesting: { name: "Prompt Testing", path: "/chatbot-prompt-testing" },
  websitePerformance: { name: "Chartwell website performance", path: "/chartwell-website-performance" },
  performanceApi: { name: "Website performance data", path: "/api/performance" },
  api: { name: "API", path: "/api" },
  team: { name: "Team Management", path: "/team" },
};

const LEVEL_ALLOWED_KEYS: Record<Level, (keyof typeof PREFIXES)[]> = {
  3: ["home", "analytics", "websitePerformance", "performanceApi", "team"],
  2: [
    "home",
    "content",
    "sitecoreResidenceSelectorApi",
    "analytics",
    "promptTesting",
    "websitePerformance",
    "performanceApi",
    "team",
  ],
  1: ["home", "content", "analytics", "promptTesting", "websitePerformance", "performanceApi", "api", "team"],
};

export const LEVEL_ALLOWED_PREFIXES: Record<Level, AllowedPrefix[]> = {
  3: LEVEL_ALLOWED_KEYS[3].map((k) => PREFIXES[k]),
  2: LEVEL_ALLOWED_KEYS[2].map((k) => PREFIXES[k]),
  1: LEVEL_ALLOWED_KEYS[1].map((k) => PREFIXES[k]),
};

export const LEVEL3_ALLOWED_PREFIXES = LEVEL_ALLOWED_PREFIXES[3];
export const LEVEL2_ALLOWED_PREFIXES = LEVEL_ALLOWED_PREFIXES[2];
export const LEVEL1_ALLOWED_PREFIXES = LEVEL_ALLOWED_PREFIXES[1];
