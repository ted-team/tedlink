"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { tedlinkHome } = require("./session_store");

const AUTH_BASE_URL = "http://49.232.144.199:9543";
const AUTH_FILE_NAME = "auth.json";

function authBaseUrl() {
  const configured = process.env.TEDLINK_BASE_URL;
  if (configured && configured.trim()) {
    return configured.trim();
  }
  return AUTH_BASE_URL;
}

function authStorePath() {
  return path.join(tedlinkHome(), AUTH_FILE_NAME);
}

function envAuthTokenSource() {
  const authToken = envValue("TEDLINK_AUTH_TOKEN");
  if (authToken) {
    return { name: "TEDLINK_AUTH_TOKEN", token: authToken };
  }
  const legacyToken = envValue("TEDLINK_TOKEN");
  if (legacyToken) {
    return { name: "TEDLINK_TOKEN", token: legacyToken };
  }
  return { name: "", token: null };
}

function currentTokenSource() {
  const envSource = envAuthTokenSource();
  if (envSource.token) {
    return envSource;
  }
  const store = loadAuthStore();
  if (store.token) {
    return { name: authStorePath(), token: store.token };
  }
  return { name: "", token: null };
}

function loadAuthStore(filePath = authStorePath()) {
  if (!fs.existsSync(filePath)) {
    return emptyAuthStore();
  }
  try {
    return normalizeAuthStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (err) {
    throw new Error(`failed to read TedLink auth store ${filePath}: ${err.message}`);
  }
}

function saveAuthStore(store, filePath = authStorePath()) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeAuthStore(store), null, 2), { mode: 0o600 });
}

function saveExistingToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    throw new Error("token is required");
  }
  const store = {
    version: 1,
    auth_base_url: authBaseUrl(),
    token: trimmed,
    token_info: { masked_token: maskToken(trimmed) },
    user: null,
    updated_at: new Date().toISOString(),
  };
  saveAuthStore(store);
  return store;
}

function clearAuthStore(filePath = authStorePath()) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      throw err;
    }
  }
}

async function loginAndCreateToken({
  baseUrl = authBaseUrl(),
  email,
  password,
  tokenName = "tedlink_cli",
  expiresInDays = 365,
  permanent = false,
}) {
  const login = await postJson(baseUrl, "/api/v1/auth/login", { email, password });
  const accessToken = String(login.access_token || "").trim();
  if (!accessToken) {
    throw new Error("login response did not include access_token");
  }

  const created = await postJson(
    baseUrl,
    "/api/v1/me/tokens",
    stripUndefined({
      name: tokenName,
      expires_in_days: permanent ? undefined : expiresInDays,
      permanent,
    }),
    accessToken,
  );
  const token = String(created.token || "").trim();
  if (!token) {
    throw new Error("token creation response did not include token");
  }

  const store = {
    version: 1,
    auth_base_url: baseUrl,
    token,
    token_info: withoutPlainToken(created),
    user: login.user || null,
    updated_at: new Date().toISOString(),
  };
  saveAuthStore(store);
  return { store, token };
}

async function sendEmailVerification({ baseUrl = authBaseUrl(), email }) {
  return postJson(baseUrl, "/api/v1/applications/email-verifications", { email });
}

function postJson(baseUrl, pathSuffix, payload, bearerToken = null) {
  return requestJson(baseUrl, "POST", pathSuffix, payload, bearerToken);
}

function requestJson(baseUrl, method, pathSuffix, payload, bearerToken = null) {
  const parsed = new URL(String(baseUrl).trim());
  if (parsed.protocol !== "http:") {
    throw new Error("only http:// auth base URLs are supported");
  }
  const body = Buffer.from(JSON.stringify(stripUndefined(payload)));
  const headers = {
    Host: `${parsed.hostname}:${parsed.port || 80}`,
    Connection: "close",
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const basePath = parsed.pathname === "/" ? "" : parsed.pathname;
  const options = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 80,
    method,
    path: `${basePath}${pathSuffix}`,
    headers,
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        const statusCode = res.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode}: ${responseBody.toString("utf8").replace(/\n/g, " ")}`));
          return;
        }
        try {
          resolve(JSON.parse(responseBody.toString("utf8")));
        } catch {
          reject(new Error(`invalid JSON response from ${pathSuffix}: ${responsePreview(responseBody)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function emptyAuthStore() {
  return {
    version: 1,
    auth_base_url: authBaseUrl(),
    token: null,
    token_info: null,
    user: null,
    updated_at: "",
  };
}

function normalizeAuthStore(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    auth_base_url: String(data.auth_base_url || authBaseUrl()),
    token: data.token ? String(data.token) : null,
    token_info: data.token_info && typeof data.token_info === "object" ? data.token_info : null,
    user: data.user && typeof data.user === "object" ? data.user : null,
    updated_at: data.updated_at ? String(data.updated_at) : "",
  };
}

function withoutPlainToken(tokenResponse) {
  const copy = { ...(tokenResponse || {}) };
  delete copy.token;
  return copy;
}

function stripUndefined(value) {
  const result = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function maskToken(token) {
  const value = String(token || "");
  if (value.length <= 12) {
    return `${value.slice(0, 4)}****`;
  }
  return `${value.slice(0, 12)}****${value.slice(-4)}`;
}

function missingTokenMessage() {
  return [
    "TedLink token is not configured.",
    "Provide an existing token with:",
    "  tedlink auth token --token <tedlink-token>",
    "or:",
    "  export TEDLINK_AUTH_TOKEN=<tedlink-token>",
    "If you do not have a token, run:",
    "  tedlink auth login --email <email> --password <password>",
    "or start registration with:",
    "  tedlink auth register --email <email>",
  ].join("\n");
}

function responsePreview(response) {
  const text = Buffer.from(response).toString("utf8");
  const compact = text.split(/\s+/).join(" ");
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function envValue(name) {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

module.exports = {
  AUTH_BASE_URL,
  authBaseUrl,
  authStorePath,
  clearAuthStore,
  currentTokenSource,
  envAuthTokenSource,
  loadAuthStore,
  loginAndCreateToken,
  missingTokenMessage,
  saveAuthStore,
  saveExistingToken,
  sendEmailVerification,
};
