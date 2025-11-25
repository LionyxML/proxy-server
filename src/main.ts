import express from "express";
import fetch from "node-fetch";
import https from "https";

const app = express();

const LOCAL_PORT = 9000;
const TARGET_URL = "https://your_other_host.com";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// ============= Delay Configuration (ms) =============
const delayedRoutes: Record<string, number> = {
  "/api/user/features": 5000,
};

// ============= Failure Simulation =============
// Format: [endpoint, timesToFail, statusCode]
// timesToFail: number of times to fail before returning OK
// -1 = fail indefinitely
const failRoutes: Array<[string, number, number]> = [
  ["/api/user/features", 4, 400],
];

const failCounters: Record<string, number> = {};

// OPTIONS (CORS preflight) Middleware
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader("Access-Control-Allow-Headers", "*");
    return res.sendStatus(204);
  }
  next();
});

// Delay Middleware
app.use(async (req, _res, next) => {
  const route = Object.keys(delayedRoutes).find((r) =>
    req.originalUrl.startsWith(r),
  );
  if (!route) return next();

  const ms = delayedRoutes[route];
  console.log(`⏳ Delaying ${route} by ${ms}ms`);
  await new Promise((resolve) => setTimeout(resolve, ms));
  next();
});

// Proxy middleware with failure simulation
app.use(async (req, res) => {
  const url = TARGET_URL + req.originalUrl;

  const failRoute = failRoutes.find(([ep]) => req.originalUrl.startsWith(ep));
  if (failRoute) {
    const [ep, timesToFail, statusCode] = failRoute;
    if (!failCounters[ep]) failCounters[ep] = 0;

    if (timesToFail === -1 || failCounters[ep] < timesToFail) {
      failCounters[ep]++;
      console.log(
        `❌ Failing ${ep} (${failCounters[ep]}/${timesToFail === -1 ? "∞" : timesToFail}) with ${statusCode}`,
      );
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      return res.status(statusCode).end();
    }
  }

  console.log(`➡️ Proxying: ${req.method} ${url}`);

  const cleanHeaders: any = {
    ...req.headers,
    host: new URL(TARGET_URL).host,
    origin: undefined,
    referer: undefined,
    "accept-encoding": "identity",
    connection: "close",
  };

  try {
    const body: Buffer | undefined =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => resolve(Buffer.concat(chunks)));
            req.on("error", reject);
          });

    const apiRes = await fetch(url, {
      method: req.method,
      headers: cleanHeaders,
      body,
      agent: insecureAgent,
    });

    res.status(apiRes.status);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );

    const rawBody = await apiRes.arrayBuffer();

    if (rawBody.byteLength > 0) {
      const contentType =
        apiRes.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      return res.end(Buffer.from(rawBody));
    } else {
      return res.end();
    }
  } catch (error: any) {
    console.error("Proxy error:", error);
    res.status(500).end(`Proxy failed: ${error.message}`);
  }
});

app.listen(LOCAL_PORT, () => {
  console.log(`🚀 Proxy running at: http://localhost:${LOCAL_PORT}`);
  console.log(`🚀 Redirecting   to: ${TARGET_URL}`);
});
