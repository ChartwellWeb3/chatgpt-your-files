"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import type { Database } from "@/supabase/functions/_lib/database";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Home, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Residence = {
  id: number;
  name: string;
  custom_id: string;
  created_at: string;
};

interface ResidencePickerProps {
  selectedResidence: string | null;
  onResidenceChange: (customId: string | null) => void;
}

export function ResidencePicker({
  selectedResidence,
  onResidenceChange,
}: ResidencePickerProps) {
  const supabase = createClientComponentClient<Database>();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newResidenceName, setNewResidenceName] = useState("");
  const [renameResidenceName, setRenameResidenceName] = useState("");
  const [residenceToRename, setResidenceToRename] = useState<Residence | null>(
    null
  );

  const { data: residences, isLoading } = useQuery<Residence[]>(
    ["residences"],
    async () => {
      const { data, error } = await supabase
        .from("residences")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        toast({
          variant: "destructive",
          description: "Failed to fetch residences",
        });
        throw error;
      }

      return data as Residence[];
    }
  );

  const createResidence = async () => {
    if (!newResidenceName.trim()) {
      toast({
        variant: "destructive",
        description: "Residence name cannot be empty",
      });
      return;
    }

    const customId = newResidenceName
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    const { error } = await supabase.from("residences").insert({
      name: newResidenceName.trim(),
      custom_id: customId,
    });

    if (error) {
      toast({
        variant: "destructive",
        description: "Failed to create residence. It may already exist.",
      });
      return;
    }

    toast({
      description: `Created residence: ${newResidenceName}`,
    });

    setNewResidenceName("");
    setIsCreateDialogOpen(false);
    queryClient.invalidateQueries(["residences"]);
    onResidenceChange(customId);
  };

  const renameResidence = async () => {
    if (!residenceToRename || !renameResidenceName.trim()) {
      return;
    }

    const { error } = await supabase
      .from("residences")
      .update({ name: renameResidenceName.trim() })
      .eq("id", residenceToRename.id);

    if (error) {
      toast({
        variant: "destructive",
        description: "Failed to rename residence",
      });
      return;
    }

    toast({
      description: `Renamed residence to: ${renameResidenceName}`,
    });

    setRenameResidenceName("");
    setResidenceToRename(null);
    setIsRenameDialogOpen(false);
    queryClient.invalidateQueries(["residences"]);
  };

  const deleteResidence = async (residence: Residence) => {
    if (
      !confirm(
        `Are you sure you want to delete "${residence.name}"? This will also delete all associated files.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("residences")
      .delete()
      .eq("id", residence.id);

    if (error) {
      toast({
        variant: "destructive",
        description: "Failed to delete residence",
      });
      return;
    }

    toast({
      description: `Deleted residence: ${residence.name}`,
    });

    if (selectedResidence === residence.custom_id) {
      onResidenceChange(null);
    }

    queryClient.invalidateQueries(["residences"]);
  };

  const selectedResidenceName =
    selectedResidence === null
      ? "Common"
      : residences?.find((r) => r.custom_id === selectedResidence)?.name ||
        selectedResidence;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-[200px] justify-between bg-transparent"
          >
            <span className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              {isLoading ? "Loading..." : selectedResidenceName}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[250px]">
          <DropdownMenuItem onClick={() => onResidenceChange(null)}>
            <Home className="mr-2 h-4 w-4" />
            Common
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {residences?.map((residence) => (
            <div
              key={residence.id}
              className="flex items-center justify-between hover:bg-accent px-2 py-1.5 rounded-sm"
            >
              <button
                className="flex-1 text-left text-sm"
                onClick={() => onResidenceChange(residence.custom_id)}
              >
                {residence.name}
              </button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResidenceToRename(residence);
                    setRenameResidenceName(residence.name);
                    setIsRenameDialogOpen(true);
                  }}
                >
                  <span className="text-xs">✏️</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteResidence(residence);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Residence
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Residence</DialogTitle>
            <DialogDescription>
              Create a new residence to organize your files. All users can
              access and manage files in any residence.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="residence-name">Residence Name</Label>
              <Input
                id="residence-name"
                placeholder="e.g., Residence A, Project X"
                value={newResidenceName}
                onChange={(e) => setNewResidenceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    createResidence();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={createResidence}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Residence</DialogTitle>
            <DialogDescription>
              Change the name of this residence. The custom ID will remain the
              same.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename-residence">New Name</Label>
              <Input
                id="rename-residence"
                placeholder="Enter new name"
                value={renameResidenceName}
                onChange={(e) => setRenameResidenceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameResidence();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRenameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={renameResidence}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
