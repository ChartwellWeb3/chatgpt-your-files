// "use client";

// import { Button } from "@/components/ui/button";
// import {
//   Dialog,
//   DialogContent,
//   DialogDescription,
//   DialogFooter,
//   DialogHeader,
//   DialogTitle,
// } from "@/components/ui/dialog";
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuSeparator,
//   DropdownMenuTrigger,
// } from "@/components/ui/dropdown-menu";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { toast } from "@/components/ui/use-toast";
// import type { Database } from "@/supabase/functions/_lib/database";
// import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
// import { useQuery, useQueryClient } from "@tanstack/react-query";
// import {
//   ChevronDown,
//   Home,
//   Plus,
//   Trash2,
//   Building2,
//   Edit2,
// } from "lucide-react";
// import { useState } from "react";

// type Residence = {
//   id: number;
//   name: string;
//   custom_id: string;
//   created_at: string;
// };

// interface ResidencePickerProps {
//   selectedResidence: string | null;
//   onResidenceChange: (customId: string | null) => void;
// }

// export function ResidencePicker({
//   selectedResidence,
//   onResidenceChange,
// }: ResidencePickerProps) {
//   const supabase = createClientComponentClient<Database>();
//   const queryClient = useQueryClient();
//   const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
//   const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
//   const [newResidenceName, setNewResidenceName] = useState("");
//   const [newResidenceCustomId, setNewResidenceCustomId] = useState("");
//   const [renameResidenceName, setRenameResidenceName] = useState("");
//   const [residenceToRename, setResidenceToRename] = useState<Residence | null>(
//     null
//   );

//   const { data: residences, isLoading } = useQuery<Residence[]>(
//     ["residences"],
//     async () => {
//       const { data, error } = await supabase
//         .from("residences")
//         .select("*")
//         .order("created_at", { ascending: true });

//       if (error) {
//         toast({
//           variant: "destructive",
//           description: "Failed to fetch residences",
//         });
//         throw error;
//       }

//       return data as Residence[];
//     }
//   );

//   const createResidence = async () => {
//     if (!newResidenceName.trim()) {
//       toast({
//         variant: "destructive",
//         description: "Residence name cannot be empty",
//       });
//       return;
//     }

//     const customId =
//       newResidenceCustomId.trim() ||
//       newResidenceName
//         .toLowerCase()
//         .trim()
//         .replace(/\s+/g, "-")
//         .replace(/[^a-z0-9-]/g, "");

//     const { error } = await supabase.from("residences").insert({
//       name: newResidenceName.trim(),
//       custom_id: customId,
//     });

//     if (error) {
//       toast({
//         variant: "destructive",
//         description:
//           "Failed to create residence. The custom ID may already exist.",
//       });
//       return;
//     }

//     toast({
//       description: `Created residence: ${newResidenceName}`,
//     });

//     setNewResidenceName("");
//     setNewResidenceCustomId("");
//     setIsCreateDialogOpen(false);
//     queryClient.invalidateQueries(["residences"]);
//     onResidenceChange(customId);
//   };

//   const renameResidence = async () => {
//     if (!residenceToRename || !renameResidenceName.trim()) {
//       return;
//     }

//     const { error } = await supabase
//       .from("residences")
//       .update({ name: renameResidenceName.trim() })
//       .eq("id", residenceToRename.id);

//     if (error) {
//       toast({
//         variant: "destructive",
//         description: "Failed to rename residence",
//       });
//       return;
//     }

//     toast({
//       description: `Renamed residence to: ${renameResidenceName}`,
//     });

//     setRenameResidenceName("");
//     setResidenceToRename(null);
//     setIsRenameDialogOpen(false);
//     queryClient.invalidateQueries(["residences"]);
//   };

//   const deleteResidence = async (residence: Residence) => {
//     if (
//       !confirm(
//         `Are you sure you want to delete "${residence.name}"? This will also delete all associated files.`
//       )
//     ) {
//       return;
//     }

//     const { error } = await supabase
//       .from("residences")
//       .delete()
//       .eq("id", residence.id);

//     if (error) {
//       toast({
//         variant: "destructive",
//         description: "Failed to delete residence",
//       });
//       return;
//     }

//     toast({
//       description: `Deleted residence: ${residence.name}`,
//     });

//     if (selectedResidence === residence.custom_id) {
//       onResidenceChange(null);
//     }

//     queryClient.invalidateQueries(["residences"]);
//   };

//   const selectedResidenceName =
//     selectedResidence === null
//       ? "Common"
//       : residences?.find((r) => r.custom_id === selectedResidence)?.name ||
//         selectedResidence;

//   return (
//     <div className="flex items-center gap-2">
//       <DropdownMenu>
//         <DropdownMenuTrigger>
//           <Button
//             variant="outline"
//             className="min-w-[200px] justify-between bg-card hover:bg-accent/10 border-2 transition-all"
//           >
//             <span className="flex items-center gap-2">
//               <Building2 className="h-4 w-4 text-primary" />
//               <span className="font-medium">
//                 {isLoading ? "Loading..." : selectedResidenceName}
//               </span>
//             </span>
//             <ChevronDown className="h-4 w-4 opacity-50" />
//           </Button>
//         </DropdownMenuTrigger>
//         <DropdownMenuContent align="start" className="w-[280px]">
//           <DropdownMenuItem
//             onClick={() => onResidenceChange(null)}
//             className="cursor-pointer"
//           >
//             <Home className="mr-2 h-4 w-4 text-primary" />
//             <span className="font-medium">Common</span>
//           </DropdownMenuItem>
//           <DropdownMenuSeparator />
//           {residences?.map((residence) => (
//             <div
//               key={residence.id}
//               className="flex items-center justify-between hover:bg-accent/10 px-2 py-2 rounded-md mx-1 transition-colors group"
//             >
//               <button
//                 className="flex-1 text-left text-sm font-medium flex items-center gap-2"
//                 onClick={() => onResidenceChange(residence.custom_id)}
//               >
//                 <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
//                 {residence.name}
//               </button>
//               <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
//                 <Button
//                   variant="ghost"
//                   size="sm"
//                   className="h-7 w-7 p-0 hover:bg-accent"
//                   onClick={(e) => {
//                     e.stopPropagation();
//                     setResidenceToRename(residence);
//                     setRenameResidenceName(residence.name);
//                     setIsRenameDialogOpen(true);
//                   }}
//                 >
//                   <Edit2 className="h-3.5 w-3.5" />
//                 </Button>
//                 <Button
//                   variant="ghost"
//                   size="sm"
//                   className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
//                   onClick={(e) => {
//                     e.stopPropagation();
//                     deleteResidence(residence);
//                   }}
//                 >
//                   <Trash2 className="h-3.5 w-3.5" />
//                 </Button>
//               </div>
//             </div>
//           ))}
//           <DropdownMenuSeparator />
//           <DropdownMenuItem
//             onClick={() => setIsCreateDialogOpen(true)}
//             className="cursor-pointer text-primary font-medium"
//           >
//             <Plus className="mr-2 h-4 w-4" />
//             Create New Residence
//           </DropdownMenuItem>
//         </DropdownMenuContent>
//       </DropdownMenu>

//       <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
//         <DialogContent className="sm:max-w-[500px]">
//           <DialogHeader>
//             <DialogTitle className="text-2xl font-semibold">
//               Create New Residence
//             </DialogTitle>
//             <DialogDescription className="text-base">
//               Create a new residence to organize your files. All users can
//               access and manage files in any residence.
//             </DialogDescription>
//           </DialogHeader>
//           <div className="grid gap-6 py-6">
//             <div className="grid gap-3">
//               <Label htmlFor="residence-name" className="text-sm font-semibold">
//                 Residence Name <span className="text-destructive">*</span>
//               </Label>
//               <Input
//                 id="residence-name"
//                 placeholder="e.g., Residence A, Project X, Building 101"
//                 value={newResidenceName}
//                 onChange={(e) => setNewResidenceName(e.target.value)}
//                 onKeyDown={(e) => {
//                   if (e.key === "Enter" && !e.shiftKey) {
//                     e.preventDefault();
//                     createResidence();
//                   }
//                 }}
//                 className="h-11 text-base"
//               />
//             </div>
//             <div className="grid gap-3">
//               <Label
//                 htmlFor="residence-custom-id"
//                 className="text-sm font-semibold"
//               >
//                 Custom ID{" "}
//               </Label>
//               <Input
//                 id="residence-custom-id"
//                 placeholder="e.g., res-a, project-x, bldg-101"
//                 value={newResidenceCustomId}
//                 onChange={(e) => setNewResidenceCustomId(e.target.value)}
//                 onKeyDown={(e) => {
//                   if (e.key === "Enter" && !e.shiftKey) {
//                     e.preventDefault();
//                     createResidence();
//                   }
//                 }}
//                 className="h-11 text-base font-mono"
//               />
//               <p className="text-xs text-muted-foreground">
//                 A unique identifier for this residence.
//               </p>
//             </div>
//           </div>
//           <DialogFooter className="gap-2">
//             <Button
//               variant="outline"
//               onClick={() => {
//                 setIsCreateDialogOpen(false);
//                 setNewResidenceName("");
//                 setNewResidenceCustomId("");
//               }}
//               className="h-10"
//             >
//               Cancel
//             </Button>
//             <Button onClick={createResidence} className="h-10 px-6">
//               Create Residence
//             </Button>
//           </DialogFooter>
//         </DialogContent>
//       </Dialog>

//       {/* <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
//         <DialogContent className="sm:max-w-[500px]">
//           <DialogHeader>
//             <DialogTitle className="text-2xl font-semibold">
//               Rename Residence
//             </DialogTitle>
//             <DialogDescription className="text-base">
//               Change the name of this residence. The custom ID will remain the
//               same.
//             </DialogDescription>
//           </DialogHeader>
//           <div className="grid gap-6 py-6">
//             <div className="grid gap-3">
//               <Label
//                 htmlFor="rename-residence"
//                 className="text-sm font-semibold"
//               >
//                 New Name
//               </Label>
//               <Input
//                 id="rename-residence"
//                 placeholder="Enter new name"
//                 value={renameResidenceName}
//                 onChange={(e) => setRenameResidenceName(e.target.value)}
//                 onKeyDown={(e) => {
//                   if (e.key === "Enter") {
//                     renameResidence();
//                   }
//                 }}
//                 className="h-11 text-base"
//               />
//             </div>
//           </div>
//           <DialogFooter className="gap-2">
//             <Button
//               variant="outline"
//               onClick={() => setIsRenameDialogOpen(false)}
//               className="h-10"
//             >
//               Cancel
//             </Button>
//             <Button onClick={renameResidence} className="h-10 px-6">
//               Rename
//             </Button>
//           </DialogFooter>
//         </DialogContent>
//       </Dialog> */}
//     </div>
//   );
// }
