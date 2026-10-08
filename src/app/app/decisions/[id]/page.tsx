"use client";

import { useParams } from "next/navigation";
import { DecisionDetail } from "@/components/decisions/decision-detail";

export default function DecisionPage() {
  const { id } = useParams<{ id: string }>();
  return <DecisionDetail key={id} id={id} />;
}
