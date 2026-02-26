require("./load-dotenv");

const net = require("node:net");
const fs = require("node:fs");

function parseArgs(argv) {
  const out = {
    runText: String(process.env.AGENT_BRIDGE_TEST_TEXT || "hello").trim(),
    speakText: String(process.env.AGENT_BRIDGE_TEST_SPEAK || "How can I help you?").trim(),
    skipSpeak: false,
    timeoutMs: 8000
  };
  const tokens = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] || "");
    if (!token) continue;
    if (token === "--skip-speak") {
      out.skipSpeak = true;
      continue;
    }
    if (token === "--run-text") {
      const next = String(tokens[i + 1] || "").trim();
      if (next) {
        out.runText = next;
        i += 1;
      }
      continue;
    }
    if (token.startsWith("--run-text=")) {
      const value = token.slice("--run-text=".length).trim();
      if (value) out.runText = value;
      continue;
    }
    if (token === "--speak-text") {
      const next = String(tokens[i + 1] || "").trim();
      if (next) {
        out.speakText = next;
        i += 1;
      }
      continue;
    }
    if (token.startsWith("--speak-text=")) {
      const value = token.slice("--speak-text=".length).trim();
      if (value) out.speakText = value;
      continue;
    }
    if (token === "--timeout-ms") {
      const next = Number(tokens[i + 1]);
      if (Number.isFinite(next) && next > 100) {
        out.timeoutMs = Math.floor(next);
        i += 1;
      }
      continue;
    }
    if (token.startsWith("--timeout-ms=")) {
      const value = Number(token.slice("--timeout-ms=".length));
      if (Number.isFinite(value) && value > 100) out.timeoutMs = Math.floor(value);
      continue;
    }
  }
  return out;
}

function resolveBridgeHosts() {
  const configured = String(process.env.AGENT_CLI_HOST || "127.0.0.1").trim();
  const hosts = [];
  const push = (host) => {
    const value = String(host || "").trim();
    if (!value) return;
    if (!hosts.includes(value)) hosts.push(value);
  };
  push(configured);
  if (configured === "127.0.0.1" || configured === "localhost") {
    push("localhost");
    try {
      const resolv = fs.readFileSync("/etc/resolv.conf", "utf8");
      const match = resolv.match(/^\s*nameserver\s+([0-9.]+)\s*$/m);
      if (match?.[1]) push(match[1]);
    } catch {
      // ignore
    }
  }
  return hosts;
}

function requestBridge(action, payload, timeoutMs) {
  const port = Number(process.env.AGENT_CLI_PORT || "8333");
  const hosts = resolveBridgeHosts();
  return new Promise((resolve) => {
    const tryAt = (index) => {
      if (index >= hosts.length) {
        resolve({ ok: false, error: `connect_failed hosts=[${hosts.join(", ")}] port=${port}` });
        return;
      }
      const host = hosts[index];
      const socket = net.createConnection({ host, port }, () => {
        socket.write(JSON.stringify({ action, payload }));
        socket.end();
      });
      let buffer = "";
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({ ok: false, error: `timeout after ${timeoutMs}ms (host=${host})` });
      }, timeoutMs);
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
      });
      socket.on("end", () => {
        clearTimeout(timer);
        let parsed = {};
        try {
          parsed = JSON.parse(buffer || "{}");
        } catch (error) {
          finish({ ok: false, error: `invalid_json:${String(error)}` });
          return;
        }
        if (String(parsed?.status || "") !== "ok") {
          finish({ ok: false, error: String(parsed?.message || "request_failed"), response: parsed });
          return;
        }
        finish({ ok: true, response: parsed });
      });
      socket.on("error", () => {
        clearTimeout(timer);
        tryAt(index + 1);
      });
    };
    tryAt(0);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const steps = [
    { name: "health", action: "health", payload: {} },
    { name: "agent.run", action: "agent.run", payload: { text: args.runText } }
  ];
  if (!args.skipSpeak) {
    steps.push({ name: "agent.speak_text", action: "agent.speak_text", payload: { text: args.speakText } });
  }

  let failed = false;
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    const result = await requestBridge(step.action, step.payload, args.timeoutMs);
    if (!result.ok) {
      failed = true;
      console.error(`[bridge-test] ${step.name}: FAIL ${result.error}`);
      continue;
    }
    const reply = String(result.response?.reply || result.response?.message || "ok");
    console.log(`[bridge-test] ${step.name}: OK ${reply}`);
  }

  if (failed) {
    process.exit(1);
    return;
  }
  console.log("[bridge-test] all checks passed");
}

void main();
