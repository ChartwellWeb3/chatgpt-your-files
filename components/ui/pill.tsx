export const pill = (text: string, tone: "ok" | "muted" = "muted") => {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
        tone === "ok"
          ? "bg-emerald-500/15 text-green-400"
          : "bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {text}
    </span>
  );
};
