import * as React from "react";

const Label = ({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) => {
  return (
    <label htmlFor={htmlFor} className="label">
      {children}
    </label>
  );
};

export { Label };
