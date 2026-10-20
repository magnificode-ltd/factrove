import { spawn } from "node:child_process";
import { signalProcessGroup } from "./local-runtime.mjs";

export function supervise(specs, hooks = {}) {
  const children = [];
  let recent = "";
  let shuttingDown = false;
  let exitCode = 0;
  let killTimer = null;

  function note(name, line) {
    recent = `${recent}[${name}] ${line}\n`.slice(-4000);
    process.stderr.write(`[${name}] ${line}\n`);
  }

  function prefix(name, stream) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) {
          note(name, line);
        }
      }
    });
    stream.on("end", () => {
      if (buffer.length > 0) {
        note(name, buffer);
      }
    });
  }

  function shutdown(signal, code) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    exitCode = code;
    hooks.beforeStop?.(recent);
    process.stderr.write("Stopping the API and web app.\n");
    for (const child of children) {
      signalProcessGroup(child, signal);
    }
    killTimer = setTimeout(() => {
      for (const child of children) {
        signalProcessGroup(child, "SIGKILL");
      }
    }, 5000);
  }

  function settled(child) {
    return child.exitCode !== null || child.signalCode !== null;
  }

  function finishIfDone() {
    if (children.length > 0 && children.every(settled)) {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      process.exit(exitCode);
    }
  }

  function start(spec) {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    hooks.onChild?.(spec.name, child.pid);
    if (child.stdout) {
      prefix(spec.name, child.stdout);
    }
    if (child.stderr) {
      prefix(spec.name, child.stderr);
    }
    child.on("error", (error) => {
      note(spec.name, error.message);
      shutdown("SIGTERM", 1);
      finishIfDone();
    });
    child.on("close", (code, signal) => {
      if (!shuttingDown) {
        note(spec.name, `exited (${signal ?? code})`);
        shutdown("SIGTERM", code ?? 1);
      }
      finishIfDone();
    });
  }

  // Detached children are in their own sessions, so a terminal hangup reaches only this process.
  // Register before the children start so a hangup during startup is not the default kill.
  process.on("SIGHUP", () => {
    shutdown("SIGTERM", 0);
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT", 0);
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM", 0);
  });
  process.on("exit", () => {
    for (const child of children) {
      if (!settled(child)) {
        signalProcessGroup(child, "SIGTERM");
      }
    }
    try {
      hooks.onExit?.();
    } catch {
      // A failed restore should not replace the shutdown exit code.
    }
  });

  for (const spec of specs) {
    start(spec);
  }
}
