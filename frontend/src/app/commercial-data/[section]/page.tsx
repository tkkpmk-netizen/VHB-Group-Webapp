import { CommercialFoundationWorkspace } from "@/modules/commercial/foundation-workspace";
import { redirect } from "next/navigation";

export default async function CommercialSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const moved: Record<string, string> = {
    products: "/products",
    customers: "/customers",
    render: "/order-list",
  };
  if (moved[section]) redirect(moved[section]);
  return <CommercialFoundationWorkspace section={section} />;
}
