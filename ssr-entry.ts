import { createRequestHandler } from "react-router";
import { createServer } from "@agent-native/core/server";

const { app } = createServer();
const reactHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_agent-native/")) {
      return app.fetch(request);
    }
    return reactHandler(request);
  },
};
