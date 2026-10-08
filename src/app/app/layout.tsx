import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const metadata: Metadata = { title: "Workspace | Reflex", robots: { index: false } };

export default function AppLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
