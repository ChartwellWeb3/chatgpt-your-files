import * as React from "react";

const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
  return <div className="dropdown-menu">{children}</div>;
};

const DropdownMenuContent = ({ children }: { children: React.ReactNode }) => {
  return <div className="dropdown-menu-content">{children}</div>;
};

const DropdownMenuItem = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) => {
  return (
    <div className="dropdown-menu-item" onClick={onClick}>
      {children}
    </div>
  );
};

const DropdownMenuSeparator = () => {
  return <div className="dropdown-menu-separator" />;
};

const DropdownMenuTrigger = ({ children }: { children: React.ReactNode }) => {
  return <div className="dropdown-menu-trigger">{children}</div>;
};

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
