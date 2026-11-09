import { vercelPreset } from "@vercel/react-router";
import type { Config } from "@react-router/dev/config";

export default {
  ...vercelPreset(),
  appDirectory: "app",
  ssr: true,
  splitRouteModules: false,
  routeDiscovery: { mode: "initial" },
} satisfies Config;
