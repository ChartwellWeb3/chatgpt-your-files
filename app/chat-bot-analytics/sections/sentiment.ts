import type { ConversationAnalysis } from "@/app/types/types";

type Sentiment = ConversationAnalysis["sentiment"];

export function getSentimentLabel(sentiment: Sentiment): string {
  switch (sentiment) {
    case "satisfied":
      return "Satisfied";
    case "neutral":
      return "Neutral";
    case "angry":
      return "Not satisfied";
    default:
      return "Unknown";
  }
}
