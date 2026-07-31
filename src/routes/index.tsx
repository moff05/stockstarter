import { createFileRoute } from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "StockStarter" },
      { name: "description", content: "Track holdings, returns, allocations and quarterly capital statements." },
    ],
  }),
  component: () => null,
});

