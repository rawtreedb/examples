import type { Metadata } from "next";
import { AnalyticsSection } from "../analytics-section";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Organization usage analytics powered by RawTree.",
};

export default function AnalyticsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <AnalyticsSection />
    </>
  );
}
