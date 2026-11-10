"use client";

import { InfoDialog } from "@/app/chat-bot-analytics/sections/InfoDialog";

const explanations = {
  mentionRate: {
    title: "Chartwell mention rate",
    summary: "How often an answer names the brand, whether positively, neutrally, or negatively.",
    calculation: "Answers mentioning the brand ÷ all completed answers in this selection × 100. Each brand counts once per answer, even if its name appears several times.",
    example: "Chartwell appears in 9 of 10 completed answers: its mention rate is 90%.",
    interpretation: "A mention is not necessarily a recommendation. The main Overview uses questions without brand names to measure whether AI brings up Chartwell on its own.",
  },
  averageRank: {
    title: "Average rank",
    summary: "The brand’s average position in explicitly ordered, numbered recommendations. A smaller number is better.",
    calculation: "Add the recorded positions and divide by the number of answers with a recognized rank. Answers without a rank are left out of this average.",
    example: "Ranks of #2 and #4 produce an average rank of #3. A plain bullet list does not make its second item rank #2.",
    interpretation: "A dash or “Not ranked” means no rank was recorded. It does not mean the brand ranked last. A small number of ranked answers can make this metric change sharply.",
  },
  top3: {
    title: "In the top 3",
    summary: "How often an answer explicitly ranks the brand first, second, or third.",
    calculation: "Completed answers with a recorded rank of #1, #2, or #3 ÷ all completed answers in this selection × 100. The denominator includes answers without a rank.",
    example: "2 of 10 completed answers rank Chartwell in the top 3: the result is 20%.",
    interpretation: "If no answers contain recognized ranks, this can show 0% even when Chartwell is mentioned. Check Average rank and individual answers before treating it as a poor ranking.",
  },
  shareOfMentions: {
    title: "Share of brand mentions",
    summary: "The brand’s portion of all operator-brand mentions detected in these answers.",
    calculation: "Answers mentioning the brand ÷ the sum of answer-level mentions for every detected brand × 100. Each brand counts once per answer; several brands can appear in one answer.",
    example: "Chartwell has 10 mentions and other brands have 30 combined: Chartwell’s share is 10 ÷ 40 = 25%.",
    interpretation: "This differs from mention rate: its denominator is brand mentions, not answers. It measures saved AI answers, not search volume or market share.",
  },
  answersMentioning: {
    title: "Answers mentioning it",
    summary: "The number of completed answers that name this operator brand.",
    calculation: "Count each completed answer mentioning the brand once. The “of” total is every completed answer matching the current filters.",
    example: "“6 of 10” means six answers mention the brand and four do not; its mention rate is 60%.",
    interpretation: "Multiple residences belonging to a recognized operator are grouped under that operator. Repeating the brand in one answer does not add more mentions.",
  },
  weekly: {
    title: "Chartwell mentions over time",
    summary: "Chartwell’s discovery mention rate for each week in your selected period.",
    calculation: "For each week starting Monday in Toronto time, divide completed answers mentioning Chartwell by all completed discovery answers in that week. Answers are grouped by their requested collection time.",
    example: "If 3 of 5 completed discovery answers mention Chartwell in a week, the point shows 60%.",
    interpretation: "A gap means no completed answers match that week; it is not 0%. The first or last week may cover only part of a week. Changes in the question mix or number of answers can affect the trend.",
  },
  topic: {
    title: "Chartwell mentions by topic",
    summary: "How often Chartwell appears within each question topic.",
    calculation: "Within each topic, divide completed discovery answers mentioning Chartwell by all completed discovery answers for that topic. Use the topic saved with each run.",
    example: "Chartwell appears in 4 of 5 memory-care answers: that topic shows 80%.",
    interpretation: "Each topic has its own denominator. Compare the answer counts as well as the percentages; one answer provides less evidence than twenty.",
  },
  market: {
    title: "Chartwell mentions by market",
    summary: "How often Chartwell appears for each market assigned to your questions.",
    calculation: "Within each market, divide completed discovery answers mentioning Chartwell by all completed discovery answers for that market. Use the market saved with each run.",
    example: "Chartwell appears in 6 of 10 Toronto answers: Toronto shows 60%.",
    interpretation: "A question’s assigned market determines its group. This does not measure where actual searchers live, and a small answer count can make a percentage volatile.",
  },
  completed: {
    title: "Completed reporting answers",
    summary: "Saved reporting answers whose collection and analysis both finished successfully.",
    calculation: "Count successful reporting runs with a successful saved analysis. Each completed run is one observation, even if the same question was collected before.",
    example: "Running five questions twice produces ten observations if all ten finish successfully.",
    interpretation: "Tests, failed, cancelled, and unfinished runs never count as completed answers or as answers where a brand was absent. Repeating one question more often gives it more weight.",
  },
  failed: {
    title: "Failed, cancelled, or interrupted answers",
    summary: "Reporting runs that failed, were cancelled, or no longer have an active processing lease.",
    calculation: "Count failed or cancelled runs, plus runs still marked in progress whose worker lease has expired.",
    example: "Eight completed runs and two failed runs give eight observations for mention rate, not ten.",
    interpretation: "These runs do not lower mention rate. Inspect their saved answer details and collection status; a failed analysis may already have an answer that can be reused.",
  },
  pending: {
    title: "Answers in progress or waiting",
    summary: "Reporting runs waiting in the queue or currently being processed.",
    calculation: "Count queued runs and runs marked in progress whose processing lease has not expired.",
    example: "A newly queued Run all may show twelve waiting answers before any complete.",
    interpretation: "They enter statistics only after collection and analysis succeed. Processing continues in Supabase after the browser closes.",
  },
  mappingReview: {
    title: "Answers awaiting brand mapping review",
    summary: "Saved answers with a residence-to-operator relationship that needs administrator verification.",
    calculation: "Count reporting runs paused with Needs review status. An answer with several unresolved relationships still counts once.",
    example: "An answer names a residence, while its extracted parent operator is not supported by the current catalog. It is held for verification.",
    interpretation: "The answer and extracted mentions are preserved. An administrator verifies each relationship using a reference source. The worker then validates the saved analysis before the answer enters statistics.",
  },
  library: {
    title: "Question library counts",
    summary: "Saved questions in this environment, grouped by their current approval status.",
    calculation: "Approved questions are eligible for reporting. Needs review means saved drafts. Archived questions stay in history but are excluded from new collection. The approval bar is approved ÷ (approved + drafts).",
    example: "Eight approved questions and two drafts show 80% approved; archived questions are left out of that bar.",
    interpretation: "These are question counts, not answer counts. Library totals cover all pages and do not change with reporting dates. Editing a question requires approval again.",
  },
  cited: {
    title: "Answers citing this website",
    summary: "How many completed answers link to this website as a cited source.",
    calculation: "Count distinct completed answers with at least one provider-reported citation from this domain. Multiple links from the same domain in one answer count once.",
    example: "One answer citing three pages on chartwell.com adds one to its citing-answer count.",
    interpretation: "This counts answers, not clicks or visits. A citation does not establish why the AI recommended a brand or whether the information is correct.",
  },
  consulted: {
    title: "Answers consulting this website",
    summary: "How many completed answers report looking at this website during web research.",
    calculation: "Count distinct completed answers with a provider-reported consulted source from this domain. Several consulted pages from one domain count once per answer.",
    example: "If three answers each consult two pages on a domain, its consulting-answer count is three.",
    interpretation: "A consulted page may not be cited in the answer. An answer can both cite and consult the same domain, so these columns should not be added together as unique answers. Only sources reported by the provider can be counted.",
  },
  pages: {
    title: "Unique source pages",
    summary: "The number of different source URLs recorded for a website.",
    calculation: "Count distinct normalized URLs from both cited and consulted sources for this domain across the selected completed answers.",
    example: "The same normalized page appearing in ten answers counts as one unique page. Two different pages count as two.",
    interpretation: "This measures the variety of saved source links, not all pages indexed by AI or visited by users. The source table shows up to 100 domains.",
  },
  batch: {
    title: "Collection progress",
    summary: "What is happening to each question captured when this collection started.",
    calculation: "Queued means waiting; collecting means requesting an answer; analyzing means interpreting a saved answer; completed means both stages succeeded; failed means processing stopped with an error; cancelled means the run was stopped. The progress bar is completed ÷ total questions.",
    example: "Eight completed questions in a batch of twelve fill about 67% of the bar. Failed or cancelled questions do not fill it.",
    interpretation: "Only completed reporting answers enter statistics. Retry failed keeps the same runs and can reuse saved answers for analysis. Cancelling stops unfinished work and retains completed reporting answers.",
  },
} as const;

export type GeoMetricKey = keyof typeof explanations;
type Scope = "discovery" | "branded" | "filtered" | "library" | "batch" | "question";
const scopeDescriptions: Record<Scope, string> = {
  question: "Uses successful reporting answers for this question's current wording/version, topic, market, language, and brand-name classification, within the selected benchmark and Toronto date range. Failed, cancelled, interrupted, and unresolved mapping-review answers are excluded. Branded-question percentages describe prompted brand responses and never enter Overview discovery totals. A dash means there are no eligible answers, or no detected brands for share of mentions.",
  discovery: "Uses questions without brand names for the selected benchmark, dates, topic, market, and language. Branded answers can be inspected through Answer validation.",
  branded: "Uses questions with brand names for the selected benchmark, dates, topic, market, and language. These answers never enter the main discovery metrics and can be checked in Answer validation.",
  filtered: "Uses the benchmark, dates, topic, market, language, and question type selected above. Choose questions without brand names when assessing discovery.",
  library: "Covers the whole question library in this environment, including questions on other pages. Reporting filters do not limit these totals.",
  batch: "Covers this collection’s captured question set. Reporting filters and the visible question page do not limit its progress counts.",
};

export function GeoMetricHelp({ metric, label, scope = "filtered", comparison = false }: {
  metric: GeoMetricKey;
  label?: string;
  scope?: Scope;
  comparison?: boolean;
}) {
  const explanation = explanations[metric];
  return <InfoDialog title={label || explanation.title} summary={explanation.summary} triggerLabel={`${label || explanation.title} info`} buttonClassName="shrink-0">
    <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-2 text-left leading-6">
      <p><strong className="font-medium text-foreground">How it works: </strong>{explanation.calculation}</p>
      <p className="rounded-lg border bg-muted/30 p-3"><strong className="font-medium text-foreground">Example: </strong>{explanation.example}</p>
      <p><strong className="font-medium text-foreground">How to read it: </strong>{explanation.interpretation}</p>
      <p><strong className="font-medium text-foreground">What is included: </strong>{scopeDescriptions[scope]}{scope !== "library" && scope !== "batch" && " Test answers never affect reporting statistics."}</p>
      {comparison && <p><strong className="font-medium text-foreground">Period comparison: </strong>Compared with the previous period of the same length using the same filters. Percentage changes are shown in percentage points: 40% to 50% is +10 points. Rank changes compare places; a lower rank is better. Missing data shows “Not enough data to compare periods.” Changing the question mix can affect comparisons.</p>}
    </div>
  </InfoDialog>;
}

export function GeoMetricLabel({ children, ...props }: Parameters<typeof GeoMetricHelp>[0] & { children: string }) {
  return <span className="inline-flex items-center gap-1"><span>{children}</span><GeoMetricHelp label={children} {...props}/></span>;
}
