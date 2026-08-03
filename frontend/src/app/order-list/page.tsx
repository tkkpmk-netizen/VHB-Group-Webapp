import { AppShell } from "@/components/layout/app-shell";
import { RenderLabWorkspace } from "@/modules/commercial/render-lab";
import { JobTray } from "@/modules/commercial/workbench";

export default function OrderListPage() {
  return <AppShell><RenderLabWorkspace /><JobTray /></AppShell>;
}
