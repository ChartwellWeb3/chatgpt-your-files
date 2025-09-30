"use client";

import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { ResidencePicker } from "@/components/residence-picker";
import type { Database } from "@/supabase/functions/_lib/database";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export default function FilesPage() {
  const supabase = createClientComponentClient<Database>();
  const router = useRouter();
  const [selectedResidence, setSelectedResidence] = useState<string | null>(
    null
  );

  const { data: documents, refetch } = useQuery(["files"], async () => {
    const { data, error } = await supabase
      .from("documents_with_storage_path")
      .select();

    if (error) {
      toast({
        variant: "destructive",
        description: "Failed to fetch documents",
      });
      throw error;
    }

    return data;
  });

  const filteredDocuments = documents?.filter((doc) => {
    if (selectedResidence === null) {
      return doc.is_common === true;
    }
    return doc.residence_custom_id === selectedResidence;
  });

  const deleteDocument = async (documentId: number, storagePath: string) => {
    if (!confirm("Are you sure you want to delete this file?")) {
      return;
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from("files")
      .remove([storagePath]);

    if (storageError) {
      toast({
        variant: "destructive",
        description: "Failed to delete file from storage",
      });
      return;
    }

    // Delete document record (sections will cascade delete)
    const { error: dbError } = await supabase
      .from("documents")
      .delete()
      .eq("id", documentId);

    if (dbError) {
      toast({
        variant: "destructive",
        description: "Failed to delete document record",
      });
      return;
    }

    toast({
      description: "File deleted successfully",
    });

    refetch();
  };

  return (
    <div className="max-w-6xl m-4 sm:m-10 flex flex-col gap-8 grow items-stretch">
      <div className="flex flex-col gap-4 border-b pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">File Upload</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Upload files to{" "}
              {selectedResidence === null ? "Common" : selectedResidence}
            </p>
          </div>
          <ResidencePicker
            selectedResidence={selectedResidence}
            onResidenceChange={setSelectedResidence}
          />
        </div>
        <Input
          type="file"
          name="file"
          className="cursor-pointer w-full max-w-xs"
          onChange={async (e) => {
            const selectedFile = e.target.files?.[0];

            if (selectedFile) {
              const uuid = crypto.randomUUID();
              const scope =
                selectedResidence === null ? "common" : selectedResidence;
              const storagePath = `${scope}/${uuid}/${selectedFile.name}`;

              const { error } = await supabase.storage
                .from("files")
                .upload(storagePath, selectedFile);

              if (error) {
                toast({
                  variant: "destructive",
                  description:
                    "There was an error uploading the file. Please try again.",
                });
                return;
              }

              toast({
                description: `File uploaded to ${
                  selectedResidence === null ? "Common" : selectedResidence
                }`,
              });

              refetch();
              router.push("/chat");
            }
          }}
        />
      </div>
      {filteredDocuments && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredDocuments.map((document) => (
            <div
              key={document.id}
              className="relative flex flex-col gap-2 justify-center items-center border rounded-md p-4 sm:p-6 text-center overflow-hidden group"
            >
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  if (document.id && document.storage_object_path) {
                    deleteDocument(document.id, document.storage_object_path);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
              <div
                className="flex flex-col gap-2 justify-center items-center cursor-pointer hover:bg-slate-100 w-full h-full"
                onClick={async () => {
                  if (!document.storage_object_path) {
                    toast({
                      variant: "destructive",
                      description: "Failed to download file, please try again.",
                    });
                    return;
                  }

                  const { data, error } = await supabase.storage
                    .from("files")
                    .createSignedUrl(document.storage_object_path, 60);

                  if (error) {
                    toast({
                      variant: "destructive",
                      description: "Failed to download file. Please try again.",
                    });
                    return;
                  }

                  window.location.href = data.signedUrl;
                }}
              >
                <svg
                  width="50px"
                  height="50px"
                  version="1.1"
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="m82 31.199c0.10156-0.60156-0.10156-1.1992-0.60156-1.6992l-24-24c-0.39844-0.39844-1-0.5-1.5977-0.5h-0.19922-31c-3.6016 0-6.6016 3-6.6016 6.6992v76.5c0 3.6992 3 6.6992 6.6016 6.6992h50.801c3.6992 0 6.6016-3 6.6016-6.6992l-0.003906-56.699v-0.30078zm-48-7.1992h10c1.1016 0 2 0.89844 2 2s-0.89844 2-2 2h-10c-1.1016 0-2-0.89844-2-2s0.89844-2 2-2zm32 52h-32c-1.1016 0-2-0.89844-2-2s0.89844-2 2-2h32c1.1016 0 2 0.89844 2 2s-0.89844 2-2 2zm0-16h-32c-1.1016 0-2-0.89844-2-2s0.89844-2 2-2h32c1.1016 0 2 0.89844 2 2s-0.89844 2-2 2zm0-16h-32c-1.1016 0-2-0.89844-2-2s0.89844-2 2-2h32c1.1016 0 2 0.89844 2 2s-0.89844 2-2 2zm-8-15v-17.199l17.199 17.199z" />
                </svg>

                {document.name}
              </div>
            </div>
          ))}
        </div>
      )}
      {filteredDocuments && filteredDocuments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <p>
            No files in{" "}
            {selectedResidence === null ? "Common" : selectedResidence}
          </p>
          <p className="text-sm mt-2">Upload a file to get started</p>
        </div>
      )}
    </div>
  );
}
