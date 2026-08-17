import http from "node:http";
import https from "node:https";

export const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:5173/";

export function resolveDevServerUrl(value = DEFAULT_DEV_SERVER_URL) {
  const parsed = new URL(String(value || DEFAULT_DEV_SERVER_URL).trim());

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`DEV_SERVER_PROTOCOL_NOT_SUPPORTED:${parsed.protocol}`);
  }

  if (parsed.hostname === "localhost" || parsed.hostname === "::1" || parsed.hostname === "[::1]") {
    parsed.hostname = "127.0.0.1";
  }

  if (!parsed.port) {
    parsed.port = parsed.protocol === "https:" ? "443" : "5173";
  }

  if (!parsed.pathname) parsed.pathname = "/";
  return parsed.toString();
}

function requestDevServer(url, requestTimeoutMs) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, { headers: { Connection: "close" } }, (response) => {
      response.resume();
      const statusCode = Number(response.statusCode || 0);
      if (statusCode >= 200 && statusCode < 400) {
        resolve();
        return;
      }
      reject(new Error(`DEV_SERVER_HTTP_${statusCode}`));
    });

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error("DEV_SERVER_REQUEST_TIMEOUT"));
    });
    request.on("error", reject);
  });
}

export async function waitForDevServer(
  value,
  { timeoutMs = 60_000, intervalMs = 250, requestTimeoutMs = 2_000 } = {},
) {
  const url = new URL(resolveDevServerUrl(value));
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await requestDevServer(url, requestTimeoutMs);
      return url.toString();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "UNKNOWN";
  throw new Error(`DEV_SERVER_UNAVAILABLE:${url.toString()}:${reason}`);
}
