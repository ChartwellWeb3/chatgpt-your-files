"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "../ui/button";

interface IProps {
  href: string;
  children: React.ReactNode;
}

export default function NavLink({ href, children }: IProps) {
  const currentPath = usePathname();
  const isActive = currentPath === href; // Simple check for exact match

  // Define your styles conditionally
  const linkClasses = isActive
    ? "text-white  bg-green-600" // Active styles
    : "text-white bg-green-800"; // Inactive styles

  return (
    <Link href={href} >
      <Button className={linkClasses}>{children}</Button>
    </Link>
  );
}
