import { AppShell } from "@/components/layout/app-shell";

export default function CommercialDataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
