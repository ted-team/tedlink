"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const { sanitizeResultFolderComponent, resultOutputDir, unpackResultArchive, normalizeMacIdentity } = require("../src/output");
const { renderStatusLine } = require("../src/status");
const { taskLine } = require("../src/tasks");
const { buildSubmitPayload, parseSubmitResponse, parseSseEvents, normalizeV3SubmitResponse, submitRequest } = require("../src/api");
const { createTarGzArchive } = require("../src/archive");
const { authTokenFromEnv } = require("../src/http");
const { isTerminalSessionState, isPauseSessionState } = require("../src/flow");
const {
  createRunRecord,
  parseArgs,
  persistStatusSession,
  resolveResumeSession,
  resumeWorkspaceDir,
  runAuthCommand,
  runId,
} = require("../src/cli");
const {
  buildSessionRecord,
  findSession,
  latestSession,
  listSessions,
  promptSummary,
  upsertSession,
} = require("../src/session_store");

const pendingTests = [];

runTest("sanitizes result folder names", () => {
  assert.equal(sanitizeResultFolderComponent("Five transistor OTA design"), "five_transistor_ota_desi");
  assert.equal(sanitizeResultFolderComponent("五管OTA设计"), "ota");
  assert.equal(resultOutputDir("/tmp/workspace", "ota_gain60db_pm65", "五管OTA设计", "session-full-prompt"), "/tmp/workspace/.tedlink/ota_gain60db_pm65");
  assert.equal(resultOutputDir("/tmp/workspace", "", "Five transistor OTA design", "session-full-prompt"), "/tmp/workspace/.tedlink/five_transistor_ota_desi");
  assert.equal(resultOutputDir("/tmp/workspace", "", "五管设计", "session-full-prompt"), "/tmp/workspace/.tedlink/tedlink_session_full_prompt");
});

runTest("normalizes mac identity", () => {
  assert.equal(normalizeMacIdentity("aa:bb:cc:dd:ee:ff"), "aa_bb_cc_dd_ee_ff");
});

runTest("renders status line", () => {
  const status = {
    process: { summary: "", total: 2, completed: 1, failed: 0, subtask_total: 0, subtask_completed: 0 },
    todos: [{ subtasks: [] }, { subtasks: [] }],
  };
  assert.equal(renderStatusLine(status), "2 todo(s), 1 completed");
});

runTest("formats task line", () => {
  const line = taskLine({
    title: "交付结果文件",
    state: "syncing",
    stage: "syncing",
    owner_node: "tedagent-sess-1",
    artifacts: ["secret.json"],
    subtasks: [],
    detail: { requested_outputs: [] },
  });
  assert.equal(line, "[writing_files] 交付结果文件 owner=tedlink artifacts=json (1 file)");
});

runTest("parses legacy submit response", () => {
  const result = parseSubmitResponse(Buffer.from(JSON.stringify({
    sessionid: "s1",
    status: "pending",
  })), "prompt");
  assert.equal(result.session.session_id, "s1");
  assert.equal(result.session.prompt, "prompt");
  assert.equal(result.session.state, "pending");
});

runTest("unpacks tar archives safely", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-cli-"));
  const archive = testTarArchive([["artifacts/report.md", Buffer.from("ok")]]);
  const written = unpackResultArchive(root, archive);
  assert.deepEqual(written, ["report.md"]);
  assert.equal(fs.readFileSync(path.join(root, "report.md"), "utf8"), "ok");
  assert.equal(fs.existsSync(path.join(root, "artifacts")), false);
});

runTest("unpacks gzip tar archives from tedlink-server", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-cli-gz-"));
  const archive = zlib.gzipSync(testTarArchive([["output_plots/result.txt", Buffer.from("ok")]]));
  const written = unpackResultArchive(root, archive);
  assert.deepEqual(written, ["output_plots/result.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "output_plots", "result.txt"), "utf8"), "ok");
});

runTest("parses tedlink-server SSE data events", () => {
  const events = parseSseEvents(Buffer.from([
    'data: {"event":"plan","content":"step"}',
    "",
    'data: {"event":"status_update","status":"WAITING_EXECUTOR","progress":30}',
    "",
  ].join("\n")));
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "plan");
  assert.equal(events[1].progress, 30);
});

runTest("raises tedlink-server SSE error events", () => {
  assert.throws(() => normalizeV3SubmitResponse(
    { session_id: "s1", prompt: "prompt" },
    [{ event: "error", content: "Claude API request failed" }],
  ), /Claude API request failed/);
});

runTest("normalizes staged executor history into activity", () => {
  const { parseSessionStatusResponse } = require("../src/api");
  const status = parseSessionStatusResponse(Buffer.from(JSON.stringify({
    session_id: "s1",
    status: "EXECUTING",
    result_slug: "ota_gain60db_pm65",
    progress: 20,
    workspace_path: "/tmp/work",
    artifact_dir: "artifacts",
    initial_prompt: "按照计算参考文档执行参数计算",
    history_summary: [
      {
        role: "executor",
        created_at: "2026-06-02T00:00:00Z",
        content: [
          "[PLAN]",
          "1. 创建 calculation_record.md",
          "[TASK]",
          "运行第一轮仿真",
          "[TOOLS]",
          "第一轮参数 gm/id=12，增益不足，下一轮增大尾电流。",
          "[SUBTASK]",
          "更新 DESIGN_MAP 参数",
          "[COMPLETED]",
          "完成第一轮记录。",
        ].join("\n"),
      },
    ],
  })));
  assert.equal(status.session.metadata.result_slug, "ota_gain60db_pm65");
  assert.deepEqual(status.activity.map((item) => item.action), ["plan", "task", "tool", "subtask", "completed"]);
  assert.match(status.activity[2].message, /下一轮增大尾电流/);
});

runTest("normalizes markdown staged executor history into activity", () => {
  const { parseSessionStatusResponse } = require("../src/api");
  const status = parseSessionStatusResponse(Buffer.from(JSON.stringify({
    session_id: "s1",
    status: "EXECUTING",
    workspace_path: "/tmp/work",
    history_summary: [
      {
        role: "executor",
        content: [
          "## Plan",
          "- Goal: 执行参数计算",
          "## Task",
          "- Current task: 第一轮仿真",
          "## Progress",
          "- Key result: 增益不足",
          "- Next direction: 增大尾电流",
          "## Completed",
          "- Result: 已记录 calculation_record.md",
        ].join("\n"),
      },
    ],
  })));
  assert.deepEqual(status.activity.map((item) => item.action), ["plan", "task", "tool", "completed"]);
  assert.match(status.activity[2].message, /Next direction/);
});

runTest("defaults Claude model to claude-sonnet-4-6", () => {
  const previous = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  try {
    const payload = buildSubmitPayload("prompt", null, "user", "mac", true, true, true, [], [], ".", false);
    assert.equal(payload.model, "claude-sonnet-4-6");
  } finally {
    restoreEnv("ANTHROPIC_MODEL", previous);
  }
});

runTest("reads decision url from environment only", () => {
  const previous = process.env.TEDLINK_BASE_URL;
  process.env.TEDLINK_BASE_URL = "http://127.0.0.1:9543";
  try {
    const args = parseArgs(["--prompt", "hello"]);
    assert.equal(args.decision_url, "http://127.0.0.1:9543");
    assert.throws(() => parseArgs(["--decision-url", "http://x", "--prompt", "hello"]), /unrecognized option/);
  } finally {
    if (previous === undefined) {
      delete process.env.TEDLINK_BASE_URL;
    } else {
      process.env.TEDLINK_BASE_URL = previous;
    }
  }
});

runTest("parses session list command", () => {
  const args = parseArgs(["session", "list", "--output", "json"]);
  assert.equal(args.command, "session-list");
  assert.equal(args.output, "json");
});

runTest("parses session all command", () => {
  const args = parseArgs(["session", "all", "--output", "json"]);
  assert.equal(args.command, "session-list");
  assert.equal(args.output, "json");
});

runTest("parses auth status command", () => {
  const args = parseArgs(["auth", "status", "--output", "json"]);
  assert.equal(args.command, "auth-status");
  assert.equal(args.output, "json");
});

runTest("parses auth token command", () => {
  const args = parseArgs(["auth", "token", "--token", "secret"]);
  assert.equal(args.command, "auth-token");
  assert.equal(args.token, "secret");
});

runTest("parses auth login command", () => {
  const args = parseArgs(["auth", "login", "--email", "user@example.com", "--password", "secret"]);
  assert.equal(args.command, "auth-login");
  assert.equal(args.email, "user@example.com");
  assert.equal(args.password, "secret");
});

runTest("parses resume flag with optional session id", () => {
  let args = parseArgs(["--resume", "--prompt", "继续优化"]);
  assert.equal(args.resume, true);
  assert.equal(args.resume_session_id, null);
  args = parseArgs(["--resume", "s1", "--prompt", "继续优化"]);
  assert.equal(args.resume, true);
  assert.equal(args.resume_session_id, "s1");
  args = parseArgs(["--resume=s2", "--prompt", "继续优化"]);
  assert.equal(args.resume, true);
  assert.equal(args.resume_session_id, "s2");
});

runTest("parses fpath option", () => {
  const args = parseArgs([
    "--prompt",
    "run",
    "--fpath",
    "input.txt",
    "--fpath=docs",
  ]);
  assert.deepEqual(args.fpaths, ["input.txt", "docs"]);
});

runTest("creates tar gz archive from fpath files and directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-fpath-"));
  fs.writeFileSync(path.join(root, "notes.txt"), "note");
  fs.mkdirSync(path.join(root, "project"));
  fs.writeFileSync(path.join(root, "project", "README.md"), "readme");
  const archive = createTarGzArchive([
    path.join(root, "notes.txt"),
    path.join(root, "project"),
  ]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-fpath-out-"));
  const written = unpackResultArchive(out, archive);
  assert.deepEqual(written, ["notes.txt", "project/README.md"]);
  assert.equal(fs.readFileSync(path.join(out, "notes.txt"), "utf8"), "note");
  assert.equal(fs.readFileSync(path.join(out, "project", "README.md"), "utf8"), "readme");
});

runTest("uploads fpath tar gz archive before executing prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-upload-"));
  const inputPath = path.join(root, "input.txt");
  const docsPath = path.join(root, "docs");
  fs.writeFileSync(inputPath, "input-content");
  fs.mkdirSync(docsPath);
  fs.writeFileSync(path.join(docsPath, "README.md"), "docs-content");
  const previousAuth = process.env.TEDLINK_AUTH_TOKEN;
  process.env.TEDLINK_AUTH_TOKEN = "upload-token";
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const bodyText = body.toString("latin1");
      seen.push(req.url);
      try {
        assert.equal(req.headers.authorization, "Bearer upload-token");
        if (req.url === "/api/v3/session/create") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ session_id: "s-upload" }));
          return;
        }
        if (req.url === "/api/v3/session/upload-tar-gz?session_id=s-upload") {
          assert.match(String(req.headers["content-type"] || ""), /^multipart\/form-data; boundary=/);
          assert.match(bodyText, /name="archive"; filename="tedlink-input\.tar\.gz"/);
          const uploadedArchive = multipartArchiveContent(body);
          const uploadedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-uploaded-"));
          assert.deepEqual(unpackResultArchive(uploadedRoot, uploadedArchive), [
            "input.txt",
            "docs/README.md",
          ]);
          assert.equal(fs.readFileSync(path.join(uploadedRoot, "input.txt"), "utf8"), "input-content");
          assert.equal(fs.readFileSync(path.join(uploadedRoot, "docs", "README.md"), "utf8"), "docs-content");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            session_id: "s-upload",
            owner_user_id: "u1",
            uploaded_paths: ["./input.txt", "./docs/"],
            extracted_file_count: 2,
            extracted_dir_count: 1,
          }));
          return;
        }
        if (req.url === "/api/v3/execute/chat") {
          assert.deepEqual(seen, [
            "/api/v3/session/create",
            "/api/v3/session/upload-tar-gz?session_id=s-upload",
            "/api/v3/execute/chat",
          ]);
          res.setHeader("Content-Type", "text/event-stream");
          res.end('data: {"event":"status_update","status":"COMPLETED"}\n\n');
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      } catch (err) {
        res.statusCode = 500;
        res.end(err && err.stack ? err.stack : String(err));
      }
    });
  });
  try {
    const decisionUrl = await listenUrl(server);
    const result = await submitRequest(
      decisionUrl,
      "prompt",
      null,
      "user",
      "mac",
      true,
      true,
      true,
      [],
      [],
      root,
      false,
      null,
      [inputPath, docsPath],
    );
    assert.equal(result.session.session_id, "s-upload");
    assert.deepEqual(seen, [
      "/api/v3/session/create",
      "/api/v3/session/upload-tar-gz?session_id=s-upload",
      "/api/v3/execute/chat",
    ]);
  } finally {
    restoreEnv("TEDLINK_AUTH_TOKEN", previousAuth);
    await closeServer(server);
  }
});

runTest("persists session list records with prompt summaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-store-"));
  const storePath = path.join(root, "sessions.json");
  const record = buildSessionRecord({
    sessionId: "s1",
    prompt: "帮我设计一个五管运算放大器，要求有网表和仿真波形和报告",
    decisionUrl: "http://127.0.0.1:9543",
    workspaceDir: "/tmp/work",
    state: "executing",
  });
  upsertSession(record, storePath);
  const sessions = listSessions(storePath);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session_id, "s1");
  assert.equal(sessions[0].prompt_summary, promptSummary(record.prompt));
});

runTest("resolves latest resume session from TEDLINK_HOME", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-home-"));
  const previousHome = process.env.TEDLINK_HOME;
  process.env.TEDLINK_HOME = root;
  try {
    upsertSession(buildSessionRecord({
      sessionId: "old",
      prompt: "old prompt",
      decisionUrl: "http://old",
      workspaceDir: "/tmp/old",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    upsertSession(buildSessionRecord({
      sessionId: "new",
      prompt: "new prompt",
      decisionUrl: "http://new",
      workspaceDir: "/tmp/new",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }));
    assert.equal(latestSession().session_id, "new");
    assert.equal(resolveResumeSession({ resume_session_id: null }).session_id, "new");
    assert.equal(resolveResumeSession({ resume_session_id: "old" }).session_id, "old");
  } finally {
    restoreEnv("TEDLINK_HOME", previousHome);
  }
});

runTest("resume ignores stored tedlink-server workspace paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-home-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-work-"));
  const previousHome = process.env.TEDLINK_HOME;
  const previousCwd = process.cwd();
  process.env.TEDLINK_HOME = root;
  try {
    upsertSession(buildSessionRecord({
      sessionId: "server-path",
      prompt: "继续优化",
      decisionUrl: "http://server",
      workspaceDir: "/home/tedlink/.tedlink-server/sessions/52_54_00_67_1f_d5_user/server-path",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }));
    process.chdir(work);
    assert.equal(resumeWorkspaceDir(parseArgs(["--resume", "server-path"])), fs.realpathSync(work));
  } finally {
    process.chdir(previousCwd);
    restoreEnv("TEDLINK_HOME", previousHome);
  }
});

runTest("persists local workspace instead of server status workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-home-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-work-"));
  const output = path.join(work, ".tedlink", "result");
  const previousHome = process.env.TEDLINK_HOME;
  process.env.TEDLINK_HOME = root;
  try {
    persistStatusSession(
      { decision_url: "http://server" },
      {
        session: {
          session_id: "s1",
          state: "completed",
          prompt: "优化晶体管面积",
          workspace: {
            workspace_dir: "/home/tedlink/.tedlink-server/sessions/52_54_00_67_1f_d5_user/s1",
          },
        },
      },
      work,
      output,
      "mac",
    );
    assert.equal(findSession("s1").workspace_dir, work);
  } finally {
    restoreEnv("TEDLINK_HOME", previousHome);
  }
});

runTest("creates local run records with pid and metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-run-"));
  const record = createRunRecord({ output: "text", quiet: false }, root, "local", "生成 OTA");
  assert.match(record.runDir, /\.tedlink[/\\]runs[/\\]\d{8}-\d{6}-\d+$/);
  assert.equal(fs.readFileSync(path.join(record.runDir, "pid"), "utf8"), `${process.pid}\n`);
  const metadata = JSON.parse(fs.readFileSync(path.join(record.runDir, "meta.json"), "utf8"));
  assert.equal(metadata.pid, process.pid);
  assert.equal(metadata.mode, "local");
  assert.equal(metadata.workspace_dir, root);
  assert.equal(metadata.prompt_summary, "生成 OTA");
});

runTest("formats run ids like shell date pid wrappers", () => {
  const id = runId(new Date(2026, 0, 2, 3, 4, 5), 123);
  assert.equal(id, "20260102-030405-123");
});

runTest("completed with warnings is terminal", () => {
  assert.equal(isTerminalSessionState("completed_with_warnings"), true);
});

runTest("waiting executor and waiting input are pause states", () => {
  assert.equal(isPauseSessionState("WAITING_EXECUTOR"), true);
  assert.equal(isPauseSessionState("waiting_input"), true);
  assert.equal(isPauseSessionState("running"), false);
});

runTest("uses TEDLINK_AUTH_TOKEN for HTTP auth", () => {
  const previousAuth = process.env.TEDLINK_AUTH_TOKEN;
  const previousLegacy = process.env.TEDLINK_TOKEN;
  process.env.TEDLINK_AUTH_TOKEN = "auth-token";
  process.env.TEDLINK_TOKEN = "legacy-token";
  try {
    assert.deepEqual(authTokenFromEnv(), { name: "TEDLINK_AUTH_TOKEN", value: "auth-token" });
  } finally {
    restoreEnv("TEDLINK_AUTH_TOKEN", previousAuth);
    restoreEnv("TEDLINK_TOKEN", previousLegacy);
  }
});

runTest("uses TEDLINK_TOKEN when TEDLINK_AUTH_TOKEN is unset", () => {
  const previousAuth = process.env.TEDLINK_AUTH_TOKEN;
  const previousLegacy = process.env.TEDLINK_TOKEN;
  delete process.env.TEDLINK_AUTH_TOKEN;
  process.env.TEDLINK_TOKEN = "legacy-token";
  try {
    assert.deepEqual(authTokenFromEnv(), { name: "TEDLINK_TOKEN", value: "legacy-token" });
  } finally {
    restoreEnv("TEDLINK_AUTH_TOKEN", previousAuth);
    restoreEnv("TEDLINK_TOKEN", previousLegacy);
  }
});

runTest("auth status reports TEDLINK_TOKEN without exposing token", () => {
  const previousAuth = process.env.TEDLINK_AUTH_TOKEN;
  const previousLegacy = process.env.TEDLINK_TOKEN;
  const originalLog = console.log;
  const lines = [];
  delete process.env.TEDLINK_AUTH_TOKEN;
  process.env.TEDLINK_TOKEN = "legacy-secret";
  console.log = (line) => lines.push(String(line));
  try {
    runAuthCommand({ command: "auth-status", output: "json", auth_base_url: "http://127.0.0.1:9543" });
    const status = JSON.parse(lines.join("\n"));
    assert.equal(status.token_configured, true);
    assert.equal(status.token_source, "TEDLINK_TOKEN");
    assert.deepEqual(status.token_sources_priority, ["TEDLINK_AUTH_TOKEN", "TEDLINK_TOKEN", "auth_store"]);
    assert.equal(lines.join("\n").includes("legacy-secret"), false);
  } finally {
    console.log = originalLog;
    restoreEnv("TEDLINK_AUTH_TOKEN", previousAuth);
    restoreEnv("TEDLINK_TOKEN", previousLegacy);
  }
});

runTest("auth token stores token and HTTP auth reads auth store", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tedlink-auth-home-"));
  const previousHome = process.env.TEDLINK_HOME;
  const previousAuth = process.env.TEDLINK_AUTH_TOKEN;
  const previousLegacy = process.env.TEDLINK_TOKEN;
  const originalLog = console.log;
  const lines = [];
  process.env.TEDLINK_HOME = root;
  delete process.env.TEDLINK_AUTH_TOKEN;
  delete process.env.TEDLINK_TOKEN;
  console.log = (line) => lines.push(String(line));
  try {
    runAuthCommand({ command: "auth-token", output: "json", token: "stored-secret" });
    assert.equal(lines.join("\n").includes("stored-secret"), false);
    const source = authTokenFromEnv();
    assert.equal(source.value, "stored-secret");
    assert.match(source.name, /auth\.json$/);
    lines.length = 0;
    runAuthCommand({ command: "auth-status", output: "json", auth_base_url: "http://127.0.0.1:9543" });
    const status = JSON.parse(lines.join("\n"));
    assert.equal(status.token_configured, true);
    assert.match(status.token_source, /auth\.json$/);
  } finally {
    console.log = originalLog;
    restoreEnv("TEDLINK_HOME", previousHome);
    restoreEnv("TEDLINK_AUTH_TOKEN", previousAuth);
    restoreEnv("TEDLINK_TOKEN", previousLegacy);
  }
});

function runTest(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pendingTests.push(result
        .then(() => console.log(`ok - ${name}`))
        .catch((err) => {
          console.error(`not ok - ${name}`);
          console.error(err && err.stack ? err.stack : String(err));
          process.exitCode = 1;
        }));
      return;
    }
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  }
}

process.once("beforeExit", async () => {
  await Promise.all(pendingTests);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function testTarArchive(entries) {
  const parts = [];
  for (const [entryPath, content] of entries) {
    const header = Buffer.alloc(512);
    Buffer.from(entryPath).copy(header, 0, 0, Math.min(Buffer.byteLength(entryPath), 100));
    const size = Buffer.from(`${content.length.toString(8).padStart(11, "0")}\0`);
    size.copy(header, 124);
    header[156] = "0".charCodeAt(0);
    parts.push(header, content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) {
      parts.push(Buffer.alloc(padding));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function listenUrl(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function multipartArchiveContent(body) {
  const contentStartMarker = Buffer.from("\r\n\r\n");
  const contentStart = body.indexOf(contentStartMarker);
  assert.notEqual(contentStart, -1);
  const contentEnd = body.lastIndexOf(Buffer.from("\r\n--"));
  assert.ok(contentEnd > contentStart);
  return body.subarray(contentStart + contentStartMarker.length, contentEnd);
}
