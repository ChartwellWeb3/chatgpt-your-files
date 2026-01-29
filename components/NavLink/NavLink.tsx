"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "../ui/button";

interface IProps {
  href: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export default function NavLink({ href, children, icon }: IProps) {
  const currentPath = usePathname();
  const isActive = currentPath === href; // Simple check for exact match

  // Define your styles conditionally
  const linkClasses = isActive
    ? "text-white bg-green-600 gap-2" // Active styles
    : "text-white bg-green-800 gap-2"; // Inactive styles

  return (
    <Link href={href}>
      <Button className={linkClasses}>
        {icon ? (
          <span className="text-base leading-none" aria-hidden>
            {icon}
          </span>
        ) : null}
        {children}
      </Button>
    </Link>
  );
}
