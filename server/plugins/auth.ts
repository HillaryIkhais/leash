import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";
import type { AuthSession } from "@agent-native/core/server";

const DEMO_SESSION: AuthSession = {
  email: "demo@leash.dev",
  name: "Demo",
  emailVerified: true,
};

const demoSession = () => ({ ...DEMO_SESSION });

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  marketing: false,
  getAdditionalSession: demoSession,
  getAdditionalBrowserSession: demoSession,
  trustCustomEmailVerification: true,
});
