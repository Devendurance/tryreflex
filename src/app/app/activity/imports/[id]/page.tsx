"use client";

import { useParams } from "next/navigation";
import { ImportDetail } from "@/components/activity/activity-detail";

export default function ImportReceiptPage() {
  const { id } = useParams<{ id: string }>();
  return <ImportDetail key={id} id={id} />;
}
