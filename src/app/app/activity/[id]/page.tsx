"use client";

import { useParams } from "next/navigation";
import { ActivityDetail } from "@/components/activity/activity-detail";

export default function ActivityRecordPage() {
  const { id } = useParams<{ id: string }>();
  return <ActivityDetail key={id} id={id} />;
}
