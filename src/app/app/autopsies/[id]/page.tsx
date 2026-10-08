"use client";

import { useParams } from "next/navigation";
import { AutopsyDetail } from "@/components/autopsy/autopsy-views";

export default function AutopsyPage() {
  const { id } = useParams<{ id: string }>();
  return <AutopsyDetail key={id} id={id} />;
}
