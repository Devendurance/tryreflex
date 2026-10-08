import type { Metadata } from "next";
import { DecisionDesk } from "@/components/decisions/decision-desk";

export const metadata: Metadata = { title: "Decision Desk | Reflex" };

export default function DecisionsPage() {
  return <DecisionDesk />;
}
