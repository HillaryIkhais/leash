import HomePage from "@/components/home/HomePage";
import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = `${APP_TITLE} — Authority contracts for autonomous work`;
const SEO_DESCRIPTION =
  "Issue a run contract: refund ceiling, permitted and forbidden actions, lifetime. Every agent, child agent, and MCP client touching the case inherits exactly this.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function HomeRoute() {
  return <HomePage />;
}
