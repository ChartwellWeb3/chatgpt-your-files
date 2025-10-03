// "use client";

// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { ResidencePicker } from "@/components/residence-picker";
// import { usePipeline } from "@/lib/hooks/use-pipeline";
// import { cn } from "@/lib/utils";
// import type { Database } from "@/supabase/functions/_lib/database";
// import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
// import { useChat } from "ai/react";
// import { useState, useRef, useEffect } from "react";
// import { Send, Sparkles } from "lucide-react";

// export default function ChatPage() {
//   const supabase = createClientComponentClient<Database>();
//   const [selectedResidence, setSelectedResidence] = useState<string | null>(
//     null
//   );
//   const messagesEndRef = useRef<HTMLDivElement>(null);

//   const generateEmbedding = usePipeline(
//     "feature-extraction",
//     "Supabase/gte-small"
//   );

//   const { messages, input, handleInputChange, handleSubmit, isLoading } =
//     useChat({
//       api: "/api/chat", // Use the local proxy route instead of the Supabase URL
//     });

//   const isReady = !!generateEmbedding;

//   const scopeDisplayName =
//     selectedResidence === null ? "Common" : selectedResidence;

//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [messages]);

//   return (
//     <div className="gradient-bg min-h-screen flex flex-col items-center w-full">
//       <div className="w-full max-w-4xl bg-white/80 backdrop-blur-sm border-b border-border/50 px-6 py-4 flex items-center justify-between shadow-sm">
//         <div className="flex items-center gap-3">
//           <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full">
//             <Sparkles className="h-4 w-4 text-primary" />
//             <span className="text-sm font-semibold text-primary">
//               Chatting in:
//             </span>
//           </div>
//           <span className="font-bold text-lg">{scopeDisplayName}</span>
//           {selectedResidence && (
//             <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-md">
//               + Common
//             </span>
//           )}
//         </div>
//         <ResidencePicker
//           selectedResidence={selectedResidence}
//           onResidenceChange={setSelectedResidence}
//         />
//       </div>

//       <div className="flex flex-col w-full max-w-4xl gap-6 grow my-6 px-4 sm:px-6 overflow-hidden">
//         <div className="flex flex-col gap-4 grow overflow-y-auto px-2 py-4">
//           {messages.length === 0 && (
//             <div className="self-stretch flex grow items-center justify-center flex-col gap-4">
//               <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-8 shadow-lg">
//                 <svg
//                   className="opacity-20"
//                   width="120px"
//                   height="120px"
//                   version="1.1"
//                   viewBox="0 0 100 100"
//                   xmlns="http://www.w3.org/2000/svg"
//                 >
//                   <g fill="currentColor">
//                     <path d="m77.082 39.582h-29.164c-3.543 0-6.25 2.707-6.25 6.25v16.668c0 3.332 2.707 6.25 6.25 6.25h20.832l8.332 8.332v-8.332c3.543 0 6.25-2.918 6.25-6.25v-16.668c0-3.5391-2.707-6.25-6.25-6.25z" />
//                     <path d="m52.082 25h-29.164c-3.543 0-6.25 2.707-6.25 6.25v16.668c0 3.332 2.707 6.25 6.25 6.25v8.332l8.332-8.332h6.25v-8.332c0-5.832 4.582-10.418 10.418-10.418h10.418v-4.168c-0.003907-3.543-2.7109-6.25-6.2539-6.25z" />
//                   </g>
//                 </svg>
//               </div>
//               <p className="text-muted-foreground text-center max-w-md">
//                 Start a conversation by asking questions about your documents
//               </p>
//             </div>
//           )}

//           {messages.map(({ id, role, content }) => (
//             <div
//               key={id}
//               className={cn(
//                 "flex w-full",
//                 role === "user" ? "justify-end" : "justify-start"
//               )}
//             >
//               <div
//                 className={cn(
//                   "rounded-2xl px-5 py-3 max-w-[75%] text-[15px] leading-relaxed",
//                   role === "user"
//                     ? "chat-message-user text-white"
//                     : "chat-message-assistant text-foreground"
//                 )}
//               >
//                 {content}
//               </div>
//             </div>
//           ))}

//           {isLoading && (
//             <div className="flex justify-start">
//               <div className="chat-message-assistant rounded-2xl px-5 py-3">
//                 <div className="text-primary dot-pulse" />
//               </div>
//             </div>
//           )}

//           <div ref={messagesEndRef} />
//         </div>

//         <form
//           className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-2xl p-3 shadow-lg border border-border/50"
//           onSubmit={async (e) => {
//             e.preventDefault();
//             if (!generateEmbedding) {
//               throw new Error("Unable to generate embeddings");
//             }

//             const output = await generateEmbedding(input, {
//               pooling: "mean",
//               normalize: true,
//             });

//             const embedding = JSON.stringify(Array.from(output.data));

//             const {
//               data: { session },
//             } = await supabase.auth.getSession();

//             if (!session) {
//               return;
//             }

//             handleSubmit(e, {
//               options: {
//                 headers: {
//                   authorization: `Bearer ${session.access_token}`,
//                 },
//                 body: {
//                   embedding,
//                   residence_custom_id: selectedResidence,
//                 },
//               },
//             });
//           }}
//         >
//           <Input
//             type="text"
//             autoFocus
//             placeholder="Type your message..."
//             value={input}
//             onChange={handleInputChange}
//             className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base h-11"
//           />
//           <Button
//             type="submit"
//             disabled={!isReady || !input.trim()}
//             size="icon"
//             className="h-11 w-11 rounded-xl shrink-0"
//           >
//             <Send className="h-5 w-5" />
//           </Button>
//         </form>
//       </div>
//     </div>
//   );
// }
