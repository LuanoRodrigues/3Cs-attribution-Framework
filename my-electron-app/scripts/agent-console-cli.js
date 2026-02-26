require("./load-dotenv");

const readline = require("node:readline");
const fs = require("node:fs");

const HELP = `
Usage:
  npm run agent:cli -- "your message"
  npm run agent:cli

Options:
  --mode <openai|app>  Route turns to OpenAI directly or to running Electron app (default: openai)
  --model <name>   Override model (default: OPENAI_CHAT_MODEL or gpt-4.1-mini)
  --speak <text>   In app mode, call agent.speak_text with this text
  --help           Show this help
`.trim();

function parseArgs(argv) {
  const out = {
    mode: "openai",
    model: String(process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim(),
    speak: "",
    text: ""
  };
  const tokens = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] || "");
    if (!token) continue;
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (token === "--model") {
      const next = String(tokens[i + 1] || "").trim();
      if (next) {
        out.model = next;
        i += 1;
      }
      continue;
    }
    if (token === "--mode") {
      const next = String(tokens[i + 1] || "").trim().toLowerCase();
      if (next === "openai" || next === "app") {
        out.mode = next;
        i += 1;
      }
      continue;
    }
    if (token === "--speak") {
      const next = String(tokens[i + 1] || "").trim();
      if (next) {
        out.speak = next;
        i += 1;
      }
      continue;
    }
    if (token.startsWith("--speak=")) {
      const value = token.slice("--speak=".length).trim();
      if (value) out.speak = value;
      continue;
    }
    if (token.startsWith("--mode=")) {
      const value = token.slice("--mode=".length).trim().toLowerCase();
      if (value === "openai" || value === "app") out.mode = value;
      continue;
    }
    if (token === "--app") {
      out.mode = "app";
      continue;
    }
    if (token.startsWith("--model=")) {
      const value = token.slice("--model=".length).trim();
      if (value) out.model = value;
      continue;
    }
    if (token.startsWith("-")) continue;
    out.text = out.text ? `${out.text} ${token}` : token;
  }
  return out;
}

async function callOpenAi({ apiKey, baseUrl, model, input, history }) {
  const userText = String(input || "").trim();
  if (!userText) {
    return { ok: false, error: "Input text is required." };
  }
  const body = {
    model,
    input: [
      ...history,
      { role: "user", content: [{ type: "input_text", text: userText }] }
    ]
  };
  const res = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `OpenAI error (${res.status}): ${String(raw || "").slice(0, 400)}`
    };
  }
  const textParts = [];
  if (Array.isArray(parsed?.output)) {
    for (const item of parsed.output) {
      if (!item || typeof item !== "object") continue;
      if (!Array.isArray(item.content)) continue;
      for (const contentItem of item.content) {
        if (contentItem?.type === "output_text" && typeof contentItem?.text === "string") {
          textParts.push(contentItem.text);
        }
      }
    }
  }
  const text = textParts.join("\n").trim() || "(empty response)";
  return {
    ok: true,
    text,
    response: parsed
  };
}

async function runSingleTurn(config, history) {
  const result = config.mode === "app"
    ? (config.speak
      ? await callElectronAppSpeak({ text: config.speak })
      : await callElectronAppRun({ input: config.text }))
    : await callOpenAi({ ...config, history, input: config.text });
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  console.log(result.text);
}

async function runInteractive(config) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });
  const history = [];
  const ask = (prompt) =>
    new Promise((resolve) => {
      rl.question(prompt, resolve);
    });

  console.log(`Agent CLI ready. mode=${config.mode}${config.mode === "openai" ? ` model=${config.model}` : ""}`);
  console.log("Type /exit to quit. In app mode: /speak your text");

  while (true) {
    const input = String(await ask("you> ")).trim();
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (config.mode === "app" && input.startsWith("/speak ")) {
      const speakText = input.slice("/speak ".length).trim();
      if (!speakText) {
        console.error("Usage: /speak <text>");
        continue;
      }
      const spoken = await callElectronAppSpeak({ text: speakText });
      if (!spoken.ok) {
        console.error(spoken.error);
        continue;
      }
      console.log(`assistant> [spoken] ${spoken.text}`);
      continue;
    }
    const result = config.mode === "app"
      ? await callElectronAppRun({ input })
      : await callOpenAi({ ...config, history, input });
    if (!result.ok) {
      console.error(result.error);
      continue;
    }
    console.log(`assistant> ${result.text}`);
    if (config.mode === "openai") {
      history.push({ role: "user", content: [{ type: "input_text", text: input }] });
      history.push({ role: "assistant", content: [{ type: "output_text", text: result.text }] });
      if (history.length > 12) {
        history.splice(0, history.length - 12);
      }
    }
  }
  rl.close();
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

function callElectronAppAction(action, payload) {
  const net = require("node:net");
  const port = Number(process.env.AGENT_CLI_PORT || "8333");
  const hosts = resolveBridgeHosts();
  return new Promise((resolve) => {
    const tryAt = (index) => {
      if (index >= hosts.length) {
        resolve({ ok: false, error: `Cannot reach running app on hosts [${hosts.join(", ")}] port ${port}` });
        return;
      }
      const host = hosts[index];
      const socket = net.createConnection({ host, port }, () => {
        socket.write(JSON.stringify({ action, payload }));
        socket.end();
      });
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
      });
      socket.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(buffer || "{}");
        } catch (error) {
          resolve({ ok: false, error: `Invalid app response: ${String(error)}` });
          return;
        }
        if (String(parsed?.status || "") !== "ok") {
          resolve({ ok: false, error: String(parsed?.message || "app command failed") });
          return;
        }
        const text = String(parsed?.reply || parsed?.message || "ok");
        resolve({ ok: true, text, response: parsed });
      });
      socket.on("error", () => {
        tryAt(index + 1);
      });
    };
    tryAt(0);
  });
}

function callElectronAppRun({ input }) {
  return callElectronAppAction("agent.run", { text: String(input || "") });
}

function callElectronAppSpeak({ text }) {
  return callElectronAppAction("agent.speak_text", { text: String(text || "") });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  let apiKey = "";
  let baseUrl = "";
  if (args.mode === "openai") {
    apiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "").trim();
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY in my-electron-app/.env");
      process.exit(2);
      return;
    }
    baseUrl = String(process.env.OPENAI_API_BASE || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
      .trim()
      .replace(/\/+$/, "");
  }
  const config = { apiKey, baseUrl, mode: args.mode, model: args.model, text: String(args.text || ""), speak: String(args.speak || "") };
  if (config.text || (config.mode === "app" && config.speak)) {
    await runSingleTurn(config, []);
    return;
  }
  await runInteractive(config);
}

void main();
