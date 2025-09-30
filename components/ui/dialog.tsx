import * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = ({ children }: { children: React.ReactNode }) => {
  return <div className="dialog">{children}</div>;
};

const DialogContent = ({ children }: { children: React.ReactNode }) => {
  return <div className="dialog-content">{children}</div>;
};

const DialogDescription = ({ children }: { children: React.ReactNode }) => {
  return <p className="dialog-description">{children}</p>;
};

const DialogFooter = ({ children }: { children: React.ReactNode }) => {
  return <div className="dialog-footer">{children}</div>;
};

const DialogHeader = ({ children }: { children: React.ReactNode }) => {
  return <div className="dialog-header">{children}</div>;
};

const DialogTitle = ({ children }: { children: React.ReactNode }) => {
  return <h2 className="dialog-title">{children}</h2>;
};

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
