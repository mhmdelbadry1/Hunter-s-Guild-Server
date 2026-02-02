require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const { Server } = require("socket.io");
const Docker = require("dockerode");
const multer = require("multer");
const archiver = require("archiver");
const AdmZip = require("adm-zip");

const app = express();
const server = http.createServer(app);

// Docker client (connects via socket)
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// Configuration from environment
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SESSION_SECRET = process.env.SESSION_SECRET || "session-secret";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;
const MC_CONTAINER_NAME = process.env.MC_CONTAINER_NAME || "minecraft-server";

// Paths
const SERVER_DIR = "/server";
const MODS_DIR = path.join(SERVER_DIR, "mods");
const CONFIG_DIR = path.join(SERVER_DIR, "config");
const WORLD_DIR = path.join(SERVER_DIR, "world");

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: true, // Allow all origins in Docker (Caddy handles CORS)
    credentials: true,
  }),
);
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, sameSite: "lax" },
  }),
);

// Initialize Socket.IO
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

// ===== AUTHENTICATION =====

const authenticate = (req, res, next) => {
  const token =
    req.cookies.token ||
    (req.headers.authorization && req.headers.authorization.split(" ")[1]);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// ===== API ROUTES =====

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get server public IP
app.get("/api/public-ip", async (req, res) => {
  try {
    const axios = require("axios");
    const response = await axios.get("https://api.ipify.org?format=json", {
      timeout: 5000,
    });
    res.json({ ip: response.data.ip });
  } catch (error) {
    console.error("Error fetching public IP:", error);
    res.status(500).json({ error: "Failed to fetch public IP" });
  }
});

// Login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    return res.json({ message: "Logged in successfully", token });
  }

  return res.status(401).json({ error: "Invalid credentials" });
});

// Logout
app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

// Validate token
app.get("/api/validate-token", authenticate, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ===== DOCKER CONTAINER MANAGEMENT =====

async function getMinecraftContainer() {
  const containers = await docker.listContainers({ all: true });
  return containers.find((c) =>
    c.Names.some((n) => n.includes(MC_CONTAINER_NAME)),
  );
}

const util = require("minecraft-server-util");

async function getContainerStatus() {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return { running: false, status: "not_found" };
    }

    const container = docker.getContainer(containerInfo.Id);
    const inspect = await container.inspect();

    // Extract environment variables first (always available)
    const envVars = {};
    if (inspect.Config && inspect.Config.Env) {
      inspect.Config.Env.forEach((env) => {
        const [key, value] = env.split("=");
        envVars[key] = value;
      });
    }

    // Calculate uptime if container is running
    let uptime = null;
    if (inspect.State.Running && inspect.State.StartedAt) {
      const startTime = new Date(inspect.State.StartedAt);
      const now = new Date();
      const uptimeSeconds = Math.floor((now - startTime) / 1000);
      uptime = uptimeSeconds;
    }

    let players = null;
    let serverReady = false;

    // Consider server ready if container has been running for more than 2 minutes
    // This is a fallback for when query is disabled
    const containerRunningTime = uptime || 0;
    const likelyReady = containerRunningTime > 120; // 2 minutes

    if (inspect.State.Running) {
      try {
        // For Forge/modded servers, try query protocol first, fallback to status
        let status;
        try {
          status = await util.queryFull("minecraft-server", 25565, {
            timeout: 5000,
          });
          players = {
            online: status.players.online,
            max: status.players.max,
            sample:
              status.players.list?.map((name) => ({ name, id: null })) || [],
          };
        } catch (queryErr) {
          // Fallback to status protocol
          status = await util.status("minecraft-server", 25565, {
            timeout: 5000,
          });
          players = {
            online: status.players.online,
            max: status.players.max,
            sample: status.players.sample || [],
          };
        }
        serverReady = true; // Server is accepting connections
      } catch (e) {
        // Server might be starting or query might be disabled
        console.log("Player query failed:", e.message);
        // Fallback: if container has been running for a while and is healthy, assume ready
        serverReady = likelyReady && inspect.State.Health?.Status === "healthy";
      }
    }

    // Determine actual status
    let actualStatus = inspect.State.Status;
    if (inspect.State.Running && !serverReady) {
      actualStatus = "starting"; // Container running but server not ready
    } else if (inspect.State.Running && serverReady) {
      actualStatus = "running"; // Fully operational
    }

    return {
      running: inspect.State.Running,
      status: actualStatus,
      serverReady: serverReady,
      startedAt: inspect.State.StartedAt,
      uptime: uptime,
      health: inspect.State.Health?.Status || "unknown",
      config: {
        mcVersion: envVars.MC_VERSION || "unknown",
        serverType: envVars.SERVER_TYPE || "unknown",
        forgeVersion: envVars.FORGE_VERSION || "",
      },
      players,
    };
  } catch (error) {
    console.error("Error getting container status:", error);
    return { running: false, status: "error", error: error.message };
  }
}

// Get server status
app.get("/api/status", authenticate, async (req, res) => {
  try {
    const status = await getContainerStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.post("/api/start", authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: "Minecraft container not found" });
    }

    const container = docker.getContainer(containerInfo.Id);

    io.emit("serverStatusUpdate", { action: "starting" });
    broadcastLog("[System] Starting server...");

    await container.start();

    // Wait a bit before attaching to ensure container is ready
    setTimeout(async () => {
      await attachGlobalLogStream(container, true); // silent = true to avoid duplicate messages
      broadcastLog("[System] Server container started.");
      io.emit("serverStatusUpdate", { action: "started" });
    }, 2000);

    res.json({ message: "Server starting..." });
  } catch (error) {
    if (error.statusCode === 304) {
      broadcastLog("[System] Server already running.");
      // Ensure log stream is attached even if already running
      const containerInfo = await getMinecraftContainer();
      if (containerInfo && !globalLogStream) {
        const container = docker.getContainer(containerInfo.Id);
        attachGlobalLogStream(container);
      }
      return res.json({ message: "Server already running" });
    }
    broadcastLog(`[System] Start failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Stop server
app.post("/api/stop", authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: "Minecraft container not found" });
    }

    const container = docker.getContainer(containerInfo.Id);

    io.emit("serverStatusUpdate", { action: "stopping" });
    broadcastLog("[System] Stopping server...");

    // Send stop command gracefully
    const exec = await container.exec({
      Cmd: ["rcon-cli", "stop"],
      AttachStdout: true,
      AttachStderr: true,
    });

    let rconSuccess = false;
    try {
      await exec.start();
      broadcastLog("[System] Sent graceful stop command via RCON.");
      rconSuccess = true;

      // Wait up to 15 seconds for graceful shutdown
      let waited = 0;
      while (waited < 15) {
        const inspect = await container.inspect();
        if (!inspect.State.Running) {
          broadcastLog("[System] Server stopped gracefully.");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        waited++;
      }
    } catch (e) {
      // If RCON fails, just stop the container
      broadcastLog("[System] RCON failed, forcing container stop...");
    }

    // If still running, force stop with shorter timeout
    const inspect = await container.inspect();
    if (inspect.State.Running) {
      broadcastLog("[System] Forcing container stop...");
      await container.stop({ t: 10 });
    }

    broadcastLog("[System] Server stopped.");
    io.emit("serverStatusUpdate", { action: "stopped" });

    // Clean up log stream
    if (globalLogStream) {
      try {
        globalLogStream.destroy();
        globalLogStream = null;
      } catch (e) {}
    }

    res.json({ message: "Server stopping..." });
  } catch (error) {
    if (error.statusCode === 304) {
      broadcastLog("[System] Server already stopped.");
      return res.json({ message: "Server already stopped" });
    }
    broadcastLog(`[System] Stop failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Restart server
app.post("/api/restart", authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: "Minecraft container not found" });
    }

    const container = docker.getContainer(containerInfo.Id);

    io.emit("serverStatusUpdate", { action: "restarting" });
    broadcastLog("[System] Restarting server...");

    // Clean up existing stream before restart
    if (globalLogStream) {
      try {
        globalLogStream.destroy();
        globalLogStream = null;
      } catch (e) {}
    }

    // Restart with shorter timeout
    await container.restart({ t: 10 });
    broadcastLog(
      "[System] Container restarted, waiting for server to start...",
    );

    // Send status update that server is starting
    io.emit("serverStatusUpdate", { action: "starting" });

    // Wait a bit before reattaching to ensure container is ready
    setTimeout(async () => {
      await attachGlobalLogStream(container, true); // silent = true to avoid duplicate messages
    }, 3000);

    // Poll for server ready state before sending 'started'
    const maxWait = 120000; // 2 minutes max
    const startTime = Date.now();
    const checkReady = async () => {
      try {
        const status = await getContainerStatus();
        if (status && status.serverReady) {
          broadcastLog("[System] Server started successfully.");
          io.emit("serverStatusUpdate", { action: "started" });
          return;
        }
        if (Date.now() - startTime < maxWait) {
          setTimeout(checkReady, 5000); // Check every 5 seconds
        } else {
          // Timeout - send started anyway to unblock UI
          broadcastLog("[System] Server start timeout, check status manually.");
          io.emit("serverStatusUpdate", { action: "started" });
        }
      } catch (e) {
        // Keep polling on error
        if (Date.now() - startTime < maxWait) {
          setTimeout(checkReady, 5000);
        } else {
          io.emit("serverStatusUpdate", { action: "started" });
        }
      }
    };

    // Start checking after 10 seconds
    setTimeout(checkReady, 10000);

    res.json({ message: "Server restarting..." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kill server (Force Stop)
app.post("/api/kill", authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: "Minecraft container not found" });
    }

    // Check if running first
    const container = docker.getContainer(containerInfo.Id);
    const inspect = await container.inspect();
    if (!inspect.State.Running) {
      return res.json({ message: "Server is already stopped" });
    }

    await container.kill();

    io.emit("serverStatusUpdate", { action: "killed" });
    res.json({ message: "Server killed." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send command to server (RCON)
app.post("/api/command", authenticate, async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: "Command required" });
  }

  try {
    // RCON connection details (container-level exec approach removed)
    const { Rcon } = require("rcon-client");
    const rconHost = process.env.RCON_HOST || "minecraft-server";
    const rconPort = parseInt(process.env.RCON_PORT || "25575", 10);
    const rconPassword = process.env.RCON_PASSWORD || "8a43386e";

    const rcon = new Rcon({
      host: rconHost,
      port: rconPort,
      password: rconPassword,
      timeout: 10000, // 10 seconds wait
    });
    await rcon.connect();
    const response = await rcon.send(command);
    await rcon.end();

    io.emit("log", `> ${command}\n[RCON] ${response}`);
    res.json({ message: "Command sent", response });
  } catch (error) {
    console.error("RCON command error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Kick Player
app.post("/api/kick", authenticate, async (req, res) => {
  const { playerName } = req.body;
  if (!playerName)
    return res.status(400).json({ error: "Player name required" });

  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo)
      return res.status(404).json({ error: "Container not found" });

    const container = docker.getContainer(containerInfo.Id);

    // Execute kick command via RCON
    const exec = await container.exec({
      Cmd: ["rcon-cli", "kick", playerName, "Kicked by admin"],
      AttachStdout: true,
      AttachStderr: true,
    });

    await exec.start();
    io.emit("log", `[System] Kicked player: ${playerName}`);

    res.json({ message: `Kicked ${playerName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== VERSION MANAGEMENT =====

// Get available versions
app.get("/api/versions", authenticate, async (req, res) => {
  try {
    // Fetch from Mojang API
    const response = await fetch(
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    );
    const manifest = await response.json();

    // Get release versions (last 30)
    const versions = manifest.versions
      .filter((v) => v.type === "release")
      .slice(0, 30)
      .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));

    res.json({
      serverTypes: ["vanilla", "forge"], // Only Vanilla and Forge
      versions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get valid Forge builds for a specific MC version
app.get("/api/versions/forge/:mcVersion", authenticate, async (req, res) => {
  const { mcVersion } = req.params;
  try {
    // Fetch from Forge Maven (promotions_slim contains recommended and latest)
    const response = await fetch(
      "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json",
    );
    const data = await response.json();
    const promos = data.promos;

    // We want to list builds. The promos only show "latest" and "recommended".
    // For a full list, we might need a different scrape.
    // However, for "Minimum Complete", showing "Recommended" and "Latest" is perfectly fine and safer.

    const builds = [];
    if (promos[`${mcVersion}-recommended`]) {
      builds.push({
        id: promos[`${mcVersion}-recommended`],
        type: "recommended",
      });
    }
    if (promos[`${mcVersion}-latest`]) {
      // Avoid duplicate if latest == recommended
      if (
        promos[`${mcVersion}-latest`] !== promos[`${mcVersion}-recommended`]
      ) {
        builds.push({ id: promos[`${mcVersion}-latest`], type: "latest" });
      }
    }

    // Fallback: if no promos found for this version (e.g. very old or very new), return empty
    res.json({ builds });
  } catch (error) {
    console.error("Error fetching forge builds:", error);
    res.status(500).json({ error: "Failed to fetch Forge builds" });
  }
});

// Change version (recreates container with new settings)
app.post("/api/version/change", authenticate, async (req, res) => {
  const { version, serverType, forgeVersion } = req.body;

  if (!version) {
    return res.status(400).json({ error: "Version required" });
  }

  const newType = serverType || "forge";

  try {
    const containerInfo = await getMinecraftContainer();
    let newEnv;
    let imageToUse;
    let hostConfigToUse;

    if (containerInfo) {
      // Container exists: Inherit configuration
      const container = docker.getContainer(containerInfo.Id);
      const inspect = await container.inspect();

      // Stop the container if running
      if (inspect.State.Running) {
        console.log("Stopping server for version change...");
        await container.stop({ t: 30 });
      }

      // Remove old container
      console.log("Removing old container...");
      await container.remove();

      imageToUse = inspect.Config.Image;
      hostConfigToUse = inspect.HostConfig;

      const oldEnv = inspect.Config.Env || [];
      newEnv = oldEnv.filter(
        (e) =>
          !e.startsWith("MC_VERSION=") &&
          !e.startsWith("SERVER_TYPE=") &&
          !e.startsWith("FORGE_VERSION="),
      );
    } else {
      // Container does not exist: Use defaults
      console.log("No existing container found. Creating fresh one.");

      // Try to auto-discover binds from API container (which is a sibling)
      // This ensures we use the correct named volumes and host paths (like server.properties)
      let binds = [];
      try {
        const os = require("os");
        const apiContainer = docker.getContainer(os.hostname());
        const apiInspect = await apiContainer.inspect();
        const mounts = apiInspect.Mounts || [];

        const getSource = (target) => {
          const m = mounts.find((m) => m.Destination === target);
          // For volumes use Name, for binds use Source (host path)
          return m ? (m.Type === "volume" ? m.Name : m.Source) : null;
        };

        const worldSource = getSource("/server/world") || "minecraft-world";
        const modsSource = getSource("/server/mods") || "minecraft-mods";
        const configSource = getSource("/server/config") || "minecraft-config";
        const propsSource = getSource("/server/server.properties");

        binds = [
          `${worldSource}:/server/world`,
          `${modsSource}:/server/mods`,
          `${configSource}:/server/config`,
        ];

        if (propsSource) {
          binds.push(`${propsSource}:/server/server.properties`);
        }
      } catch (err) {
        console.warn(
          "Failed to inspect self for binds, falling back to defaults:",
          err,
        );
        binds = [
          "minecraft-world:/server/world",
          "minecraft-mods:/server/mods",
          "minecraft-config:/server/config",
        ];
      }

      imageToUse = "minecraft-minecraft:latest";
      hostConfigToUse = {
        Binds: binds,
        PortBindings: {
          "25565/tcp": [{ HostPort: "25565" }],
        },
        Memory: 4 * 1024 * 1024 * 1024, // Default 4GB
      };

      newEnv = [
        "EULA=TRUE",
        "MEMORY=4G",
        "MAX_MEMORY=4G",
        "TYPE=FORGE",
        "TZ=UTC",
      ];
    }

    newEnv.push(`MC_VERSION=${version}`);
    newEnv.push(`SERVER_TYPE=${newType}`);

    if (newType === "forge" && forgeVersion) {
      newEnv.push(`FORGE_VERSION=${forgeVersion}`);
    }

    // Create new container with updated environment
    console.log(`Creating new container: ${newType} ${version}...`);
    const newContainer = await docker.createContainer({
      name: MC_CONTAINER_NAME,
      Image: imageToUse,
      Env: newEnv,
      HostConfig: hostConfigToUse,
      ExposedPorts: { "25565/tcp": {} },
      Tty: true,
      OpenStdin: true,
    });

    // Start the new container
    console.log("Starting new container...");
    await newContainer.start();

    attachGlobalLogStream(newContainer);

    // Update .env file to persist the version change
    try {
      const envPath = "/app/.env";
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, "utf8");

        const updateEnv = (key, value) => {
          const regex = new RegExp(`^${key}=.*`, "m");
          if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
          } else {
            envContent += `\n${key}=${value}`;
          }
        };

        updateEnv("MC_VERSION", version);
        updateEnv("SERVER_TYPE", newType);
        updateEnv("FORGE_VERSION", forgeVersion || "");

        fs.writeFileSync(envPath, envContent, "utf8");
        console.log(".env file updated with new version settings");
      }
    } catch (envError) {
      console.error("Failed to update .env file:", envError);
      // Non-critical error, don't fail the request
    }

    io.emit("serverStatusUpdate", {
      action: "version_changed",
      version,
      serverType: newType,
    });

    res.json({
      message: `Switching to ${newType} ${version}. Server is restarting with new version.`,
      version,
      serverType: newType,
      status: "recreating",
    });
  } catch (error) {
    console.error("Version change error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== MOD MANAGEMENT =====

// List mods
app.get("/api/mods", authenticate, (req, res) => {
  try {
    if (!fs.existsSync(MODS_DIR)) {
      return res.json({ mods: [] });
    }

    const files = fs.readdirSync(MODS_DIR);
    const mods = files
      .filter((f) => f.endsWith(".jar"))
      .map((f) => {
        const stats = fs.statSync(path.join(MODS_DIR, f));
        return {
          name: f,
          size: stats.size,
          modified: stats.mtime,
        };
      });

    res.json({ mods });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete mod
app.delete("/api/mods/:name", authenticate, (req, res) => {
  const modPath = path.join(MODS_DIR, req.params.name);

  try {
    if (!fs.existsSync(modPath)) {
      return res.status(404).json({ error: "Mod not found" });
    }

    fs.unlinkSync(modPath);
    res.json({ message: "Mod deleted", name: req.params.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload mod
const modUpload = multer({
  dest: "/tmp/mods",
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith(".jar") || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only .jar and .zip files allowed"));
    }
  },
});

app.post(
  "/api/mods/upload",
  authenticate,
  modUpload.array("mods"), // Changed from single("mod") to array("mods")
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      // Ensure mods directory exists
      if (!fs.existsSync(MODS_DIR)) {
        fs.mkdirSync(MODS_DIR, { recursive: true });
      }

      const uploadedFiles = [];
      const errors = [];

      for (const file of req.files) {
        // Handle ZIP files - extract all .jar files inside
        if (file.originalname.endsWith(".zip")) {
          try {
            const zip = new AdmZip(file.path);
            const zipEntries = zip.getEntries();

            zipEntries.forEach((entry) => {
              if (!entry.isDirectory && entry.entryName.endsWith(".jar")) {
                const jarName = path.basename(entry.entryName);
                const destPath = path.join(MODS_DIR, jarName);
                zip.extractEntryTo(entry, MODS_DIR, false, true);
                uploadedFiles.push(jarName);
              }
            });

            // Clean up the ZIP file
            fs.unlinkSync(file.path);
          } catch (zipError) {
            console.error(`ZIP extraction error for ${file.originalname}:`, zipError);
            try {
              fs.unlinkSync(file.path);
            } catch (e) {}
            errors.push({
              file: file.originalname,
              error: "Failed to extract ZIP file",
            });
          }
        } else {
          // Handle regular .jar files
          const destPath = path.join(MODS_DIR, file.originalname);

          // Use copy + unlink instead of rename to handle cross-device moves (EXDEV)
          try {
            fs.copyFileSync(file.path, destPath);
            fs.unlinkSync(file.path);
            uploadedFiles.push(file.originalname);
          } catch (moveError) {
            console.error(`File move error for ${file.originalname}:`, moveError);
            // Clean up temp file if copy failed
            try {
              fs.unlinkSync(file.path);
            } catch (e) {}
            errors.push({
              file: file.originalname,
              error: "Failed to save file",
            });
          }
        }
      }

      if (uploadedFiles.length === 0 && errors.length > 0) {
        throw new Error("Failed to save any of the uploaded files.");
      }

      res.json({
        message: `Uploaded ${uploadedFiles.length} mods successfully.`,
        uploaded: uploadedFiles,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Upload error:", error);
      // Clean up any remaining temp files in case of catastrophic failure
      if (req.files) {
        req.files.forEach((file) => {
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch (e) {}
        });
      }
      // Send a clean error message to the user
      res
        .status(500)
        .json({ error: "Failed to upload mods. Please try again." });
    }
  },
);

// ===== SERVER RESET =====

// Reset server (delete world, keep config)
app.post("/api/server/reset", authenticate, async (req, res) => {
  const { deleteWorld, deleteMods, deleteConfig } = req.body;

  try {
    // Stop the server first
    const containerInfo = await getMinecraftContainer();
    if (containerInfo) {
      const container = docker.getContainer(containerInfo.Id);
      const inspect = await container.inspect();

      console.log("[System] Stopping server for reset...");
      io.emit("log", "[System] Stopping server for data reset...");

      if (inspect.State.Running) {
        await container.stop({ t: 10 });
      }

      // Wait for file locks to release (don't remove container - we need it to start again)
      console.log("[System] Waiting for file locks to release...");
      io.emit("log", "[System] Waiting for file system to sync...");
      await new Promise((r) => setTimeout(r, 3000));
    }

    const deleted = [];

    // Helper to empty directory contents (for mounted volumes)
    const emptyDirectory = async (dirPath) => {
      if (!fs.existsSync(dirPath)) return;

      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const curPath = path.join(dirPath, file);
        try {
          fs.rmSync(curPath, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to delete ${curPath}:`, e);
          // Retry once
          await new Promise((r) => setTimeout(r, 500));
          try {
            fs.rmSync(curPath, { recursive: true, force: true });
          } catch (retryE) {}
        }
      }
    };

    // Delete world contents if requested
    if (deleteWorld) {
      await emptyDirectory(WORLD_DIR);
      deleted.push("world");
    }

    // Delete mods contents if requested
    if (deleteMods) {
      await emptyDirectory(MODS_DIR);
      deleted.push("mods");
    }

    // Delete config contents if requested
    if (deleteConfig) {
      await emptyDirectory(CONFIG_DIR);
      deleted.push("config");
    }

    io.emit("serverStatusUpdate", { action: "reset" });
    io.emit("log", "[System] Server reset complete. World data deleted.");
    console.log("[System] Reset complete. Container ready to start.");

    res.json({
      message: "Server reset complete",
      deleted,
      note: "Click Start to launch the server with fresh data",
    });
  } catch (error) {
    console.error("Reset error:", error);
    io.emit("log", `[Error] Reset failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ===== SERVER PROPERTIES =====

// Get server.properties
app.get("/api/server-properties", authenticate, (req, res) => {
  const propsPath = path.join(SERVER_DIR, "server.properties");

  try {
    if (!fs.existsSync(propsPath)) {
      return res.json({ properties: {} });
    }

    const content = fs.readFileSync(propsPath, "utf-8");
    const properties = {};

    content.split("\n").forEach((line) => {
      if (line && !line.startsWith("#")) {
        const [key, ...valueParts] = line.split("=");
        if (key) {
          properties[key.trim()] = valueParts.join("=").trim();
        }
      }
    });

    res.json({ properties });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update server.properties
app.put("/api/server-properties", authenticate, (req, res) => {
  const { properties } = req.body;
  const propsPath = path.join(SERVER_DIR, "server.properties");

  try {
    // Always force enable-query=true for proper status monitoring
    properties["enable-query"] = "true";

    let content = "#Minecraft server properties\n";
    content += `#Updated ${new Date().toISOString()}\n`;

    Object.entries(properties).forEach(([key, value]) => {
      content += `${key}=${value}\n`;
    });

    fs.writeFileSync(propsPath, content);
    res.json({ message: "Properties updated. Restart server to apply." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save server.properties
app.post("/api/server-properties/save", authenticate, async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "Missing or invalid content" });
  }

  try {
    const propsPath = path.join(SERVER_DIR, "server.properties");
    // Use direct write for better compatibility with Docker volume mounts on Windows
    fs.writeFileSync(propsPath, content, "utf8");

    res.json({ message: "server.properties saved successfully" });
  } catch (error) {
    console.error("Failed to save server.properties:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== FILE BROWSER =====

app.get("/api/dir", authenticate, (req, res) => {
  const requestedPath = req.query.path || "/";
  const fullPath = path.join(SERVER_DIR, requestedPath);

  try {
    // Security: ensure we stay within SERVER_DIR
    if (!fullPath.startsWith(SERVER_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Path not found" });
    }

    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: "Not a directory" });
    }

    // Recursive function to build directory tree
    const buildTree = (dirPath, maxDepth = 3, currentDepth = 0) => {
      if (currentDepth >= maxDepth) return [];

      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
          .filter((item) => {
            // Skip hidden files and system directories
            if (item.name.startsWith(".")) return false;
            if (["node_modules", "__pycache__"].includes(item.name))
              return false;
            return true;
          })
          .map((item) => {
            const itemPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
              return {
                name: item.name,
                type: "directory",
                children: buildTree(itemPath, maxDepth, currentDepth + 1),
              };
            } else {
              const itemStats = fs.statSync(itemPath);
              return {
                name: item.name,
                type: "file",
                size: itemStats.size,
              };
            }
          });
      } catch (err) {
        console.error(`Error reading directory ${dirPath}:`, err.message);
        return [];
      }
    };

    const directory = buildTree(fullPath);

    res.json({ path: requestedPath, directory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file or directory (with password confirmation)
app.post("/api/files/delete", authenticate, (req, res) => {
  const { path: filePath, password } = req.body;

  // Verify password
  if (!password || password !== ADMIN_PASS) {
    return res.status(401).json({ error: "Invalid password" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "Path is required" });
  }

  // Build full path and verify it's within SERVER_DIR
  const fullPath = path.join(SERVER_DIR, filePath);

  // Security: ensure we stay within SERVER_DIR
  if (!fullPath.startsWith(SERVER_DIR)) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Prevent deleting root level critical files/folders
  const relativePath = path.relative(SERVER_DIR, fullPath);
  const topLevel = relativePath.split(path.sep)[0];
  const criticalPaths = ["server.jar", "eula.txt", "libraries", "versions"];

  if (
    criticalPaths.includes(topLevel) ||
    criticalPaths.includes(relativePath)
  ) {
    return res
      .status(403)
      .json({ error: "Cannot delete critical server files" });
  }

  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "File or directory not found" });
    }

    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      // Recursively delete directory
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`Deleted directory: ${filePath}`);
      res.json({ message: "Directory deleted successfully", path: filePath });
    } else {
      // Delete file
      fs.unlinkSync(fullPath);
      console.log(`Deleted file: ${filePath}`);
      res.json({ message: "File deleted successfully", path: filePath });
    }
  } catch (error) {
    console.error(`Error deleting ${filePath}:`, error);
    res.status(500).json({ error: `Failed to delete: ${error.message}` });
  }
});

// ===== BACKUP =====

app.post("/api/backup", authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: "Minecraft container not found" });
    }

    const container = docker.getContainer(containerInfo.Id);

    // Execute backup script
    const exec = await container.exec({
      Cmd: ["/backup.sh"],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start();
    let output = "";

    stream.on("data", (chunk) => (output += chunk.toString()));
    stream.on("end", () => {
      res.json({ message: "Backup completed", output });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== LOG STREAMING & BUFFERING =====

let globalLogStream = null;
const logBuffer = [];
const MAX_LOG_BUFFER = 500;

function broadcastLog(message) {
  // Add to buffer
  const cleanMessage = message.toString();
  logBuffer.push(cleanMessage);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }

  // Broadcast to all clients
  io.emit("log", cleanMessage);
}

// Function to attach robust log streaming to a container
async function attachGlobalLogStream(container, silent = false) {
  try {
    if (globalLogStream) {
      // Destroy existing stream if we are re-attaching (e.g. after container recreation)
      try {
        globalLogStream.destroy();
        console.log("[System] Destroyed previous log stream.");
      } catch (e) {}
      globalLogStream = null;
    }

    console.log("[System] Attaching global log stream...");
    if (!silent) {
      broadcastLog(`[System] Attaching log stream...`);
    }

    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 50, // Only fetch recent on attach to avoid flood
      timestamps: true,
    });

    globalLogStream = stream;

    stream.on("data", (chunk) => {
      // Docker sends an 8-byte header with stream type and size
      // We slice it off to get the raw text
      if (chunk.length > 8) {
        const payload = chunk.slice(8).toString("utf8");
        broadcastLog(payload);
      }
    });

    stream.on("end", () => {
      console.log("[System] Log stream ended.");
      broadcastLog("[System] Log stream ended.");
      globalLogStream = null;

      // Try to reattach after a short delay if container is still running
      setTimeout(async () => {
        try {
          const inspect = await container.inspect();
          if (inspect.State.Running) {
            console.log("[System] Attempting to reattach log stream...");
            attachGlobalLogStream(container);
          }
        } catch (e) {
          console.log(
            "[System] Container no longer available for reattachment.",
          );
        }
      }, 2000);
    });

    stream.on("error", (err) => {
      console.error("[System] Log stream error:", err);
      broadcastLog(`[System] Log stream error: ${err.message}`);
      globalLogStream = null;
    });
  } catch (error) {
    console.error("Failed to attach log stream:", error);
    broadcastLog(`[System] Failed to attach logs: ${error.message}`);
  }
}

// Initial attachment on startup (if container runs)
(async () => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (containerInfo) {
      const container = docker.getContainer(containerInfo.Id);
      if ((await container.inspect()).State.Running) {
        attachGlobalLogStream(container);
      }
    }
  } catch (e) {
    console.error("Startup log attach failed:", e);
  }
})();

io.on("connection", (socket) => {
  console.log("Client connected. Sending log buffer...");
  socket.emit("log", `[System] Connected to API. Fetching history...`);
  // Send recent buffered logs to the new client
  for (const msg of logBuffer) {
    socket.emit("log", msg);
  }
});

// Ensure enable-query is set in server.properties so status queries work
function ensureQueryEnabled() {
  try {
    const propsPath = path.join(SERVER_DIR, "server.properties");
    if (!fs.existsSync(propsPath)) {
      // Create minimal properties file with enable-query
      const content = `# Minecraft server properties\nenable-query=true\n`;
      fs.writeFileSync(propsPath, content, "utf8");
      console.log("[Startup] Created server.properties with enable-query=true");
      return;
    }

    const content = fs.readFileSync(propsPath, "utf8");
    const lines = content.split(/\r?\n/);
    let found = false;
    const out = lines.map((line) => {
      if (/^\s*enable-query\s*=/.test(line)) {
        found = true;
        return "enable-query=true";
      }
      return line;
    });

    if (!found) {
      out.push("enable-query=true");
    }

    fs.writeFileSync(propsPath, out.join("\n"), "utf8");
    console.log("[Startup] Ensured enable-query=true in server.properties");
  } catch (e) {
    console.error("[Startup] Error ensuring enable-query:", e.message);
  }
}

// ===== MODPACK MANAGEMENT =====

const crypto = require("crypto");
const AdmZip = require("adm-zip");

// Generate hash for a file
function getFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Generate SHA1 and SHA512 hashes for Modrinth format
function getModrinthHashes(filePath) {
  const content = fs.readFileSync(filePath);
  return {
    sha1: crypto.createHash("sha1").update(content).digest("hex"),
    sha512: crypto.createHash("sha512").update(content).digest("hex"),
  };
}

// Extract mod metadata from JAR file
function extractModMetadata(jarPath) {
  try {
    const zip = new AdmZip(jarPath);

    // Try Forge format (mods.toml)
    const forgeToml = zip.getEntry("META-INF/mods.toml");
    if (forgeToml) {
      const content = forgeToml.getData().toString("utf8");
      // Basic TOML parsing for modId
      const modIdMatch = content.match(/modId\s*=\s*["']([^"']+)["']/);
      const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
      const displayNameMatch = content.match(
        /displayName\s*=\s*["']([^"']+)["']/,
      );
      return {
        modId: modIdMatch ? modIdMatch[1] : null,
        version: versionMatch ? versionMatch[1] : null,
        displayName: displayNameMatch ? displayNameMatch[1] : null,
        loader: "forge",
      };
    }

    // Try Fabric format (fabric.mod.json)
    const fabricJson = zip.getEntry("fabric.mod.json");
    if (fabricJson) {
      const json = JSON.parse(fabricJson.getData().toString("utf8"));
      return {
        modId: json.id,
        version: json.version,
        displayName: json.name,
        loader: "fabric",
      };
    }

    return null;
  } catch (e) {
    console.error(
      `[Modpack] Failed to extract metadata from ${path.basename(jarPath)}:`,
      e.message,
    );
    return null;
  }
}

// Query Modrinth API for mod download URL
async function getModrinthDownloadUrl(modId, mcVersion, loader = "forge") {
  try {
    const axios = require("axios");

    // First try to find project by modId (slug)
    const searchUrl = `https://api.modrinth.com/v2/project/${modId}`;
    let projectRes;
    try {
      projectRes = await axios.get(searchUrl, {
        headers: { "User-Agent": "HuntersGuild-ModpackGenerator/1.0" },
        timeout: 5000,
      });
    } catch (e) {
      // Project not found by slug, try search
      const searchQuery = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(modId)}&facets=[["project_type:mod"]]&limit=5`;
      const searchRes = await axios.get(searchQuery, {
        headers: { "User-Agent": "HuntersGuild-ModpackGenerator/1.0" },
        timeout: 5000,
      });

      if (!searchRes.data.hits || searchRes.data.hits.length === 0) {
        return null;
      }

      // Find best match (exact slug match or first result)
      const match =
        searchRes.data.hits.find((h) => h.slug === modId) ||
        searchRes.data.hits[0];
      projectRes = await axios.get(
        `https://api.modrinth.com/v2/project/${match.slug}`,
        {
          headers: { "User-Agent": "HuntersGuild-ModpackGenerator/1.0" },
          timeout: 5000,
        },
      );
    }

    if (!projectRes.data) return null;

    const projectSlug = projectRes.data.slug;

    // Get versions for this MC version and loader
    const versionsUrl = `https://api.modrinth.com/v2/project/${projectSlug}/version?game_versions=["${mcVersion}"]&loaders=["${loader}"]`;
    const versionsRes = await axios.get(versionsUrl, {
      headers: { "User-Agent": "HuntersGuild-ModpackGenerator/1.0" },
      timeout: 5000,
    });

    if (!versionsRes.data || versionsRes.data.length === 0) {
      // Try without version filter
      const allVersionsUrl = `https://api.modrinth.com/v2/project/${projectSlug}/version?loaders=["${loader}"]`;
      const allVersionsRes = await axios.get(allVersionsUrl, {
        headers: { "User-Agent": "HuntersGuild-ModpackGenerator/1.0" },
        timeout: 5000,
      });

      if (!allVersionsRes.data || allVersionsRes.data.length === 0) return null;

      // Find closest MC version
      const targetMajor = mcVersion.split(".").slice(0, 2).join(".");
      const matchingVersion = allVersionsRes.data.find((v) =>
        v.game_versions.some((gv) => gv.startsWith(targetMajor)),
      );

      if (!matchingVersion) return null;

      const primaryFile =
        matchingVersion.files.find((f) => f.primary) ||
        matchingVersion.files[0];
      return {
        url: primaryFile.url,
        sha512: primaryFile.hashes.sha512,
        sha1: primaryFile.hashes.sha1,
        size: primaryFile.size,
        source: "modrinth",
      };
    }

    // Get the first (latest) version
    const latestVersion = versionsRes.data[0];
    const primaryFile =
      latestVersion.files.find((f) => f.primary) || latestVersion.files[0];

    return {
      url: primaryFile.url,
      sha512: primaryFile.hashes.sha512,
      sha1: primaryFile.hashes.sha1,
      size: primaryFile.size,
      source: "modrinth",
    };
  } catch (e) {
    console.log(
      `[Modpack] Could not fetch Modrinth URL for ${modId}: ${e.message}`,
    );
    return null;
  }
}

// Scan mods folder and generate Modrinth modpack manifest
async function generateModpackManifest() {
  try {
    const modsDir = MODS_DIR;
    const modpackDir = path.join(__dirname, "..", "modpack");

    // Ensure modpack directory exists
    if (!fs.existsSync(modpackDir)) {
      fs.mkdirSync(modpackDir, { recursive: true });
    }

    // Read current MC version from env
    const mcVersion = process.env.MC_VERSION || "1.21.1";
    const forgeVersion = process.env.FORGE_VERSION || "61.0.8";
    let domain = process.env.DOMAIN || "http://localhost";

    // Ensure domain has protocol (default to https for production, http for localhost)
    if (
      domain &&
      !domain.startsWith("http://") &&
      !domain.startsWith("https://")
    ) {
      domain = domain.includes("localhost")
        ? `http://${domain}`
        : `https://${domain}`;
    }

    // Scan mods folder
    const modFiles = fs.existsSync(modsDir)
      ? fs.readdirSync(modsDir).filter((f) => f.endsWith(".jar"))
      : [];

    console.log(`[Modpack] Processing ${modFiles.length} mods...`);

    // Build files array for Modrinth format
    const files = [];
    let modrinthCount = 0;
    let serverCount = 0;

    for (const modFile of modFiles) {
      const modPath = path.join(modsDir, modFile);
      const stats = fs.statSync(modPath);

      console.log(`[Modpack] Processing: ${modFile}`);

      // Extract mod metadata from JAR
      const metadata = extractModMetadata(modPath);
      let downloadUrl = null;
      let hashes = null;
      let fileSize = stats.size;

      // Try to get Modrinth download URL
      if (metadata && metadata.modId) {
        console.log(
          `[Modpack]   Found modId: ${metadata.modId}${metadata.displayName ? ` (${metadata.displayName})` : ""}`,
        );
        const modrinthData = await getModrinthDownloadUrl(
          metadata.modId,
          mcVersion,
          metadata.loader || "forge",
        );

        if (modrinthData) {
          downloadUrl = modrinthData.url;
          hashes = {
            sha1: modrinthData.sha1,
            sha512: modrinthData.sha512,
          };
          fileSize = modrinthData.size;
          modrinthCount++;
          console.log(`[Modpack]   ✅ Using Modrinth CDN`);
        } else {
          console.log(
            `[Modpack]   ⚠️  Not found on Modrinth, using server URL`,
          );
        }
      } else {
        console.log(
          `[Modpack]   ⚠️  Could not extract modId, using server URL`,
        );
      }

      // Fallback to server URL if Modrinth lookup failed
      if (!downloadUrl) {
        downloadUrl = `${domain}/api/modpack/download-mod/${encodeURIComponent(modFile)}`;
        hashes = getModrinthHashes(modPath);
        serverCount++;
      }

      files.push({
        path: `mods/${modFile}`,
        hashes: hashes,
        env: {
          client: "required",
          server: "required",
        },
        downloads: [downloadUrl],
        fileSize: fileSize,
      });
    }

    console.log(
      `[Modpack] ✅ Summary: ${modrinthCount} from Modrinth CDN, ${serverCount} from server`,
    );

    // Generate modrinth.index.json
    const modrinthIndex = {
      formatVersion: 1,
      game: "minecraft",
      versionId: `hunters-guild-${Date.now()}`,
      name: "Hunter's Guild Modpack",
      summary: `Hunter's Guild Server modpack with ${modFiles.length} mods`,
      files: files,
      dependencies: {
        minecraft: mcVersion,
        forge: forgeVersion,
      },
    };

    // Write modrinth.index.json
    fs.writeFileSync(
      path.join(modpackDir, "modrinth.index.json"),
      JSON.stringify(modrinthIndex, null, 2),
      "utf8",
    );

    console.log(`[Modpack] ✅ Generated modpack manifest`);

    return {
      success: true,
      modCount: modFiles.length,
      modrinthCount,
      serverCount,
      mcVersion,
      forgeVersion,
      packUrl: `${process.env.DOMAIN || "http://localhost"}/modpack/pack.toml`,
    };
  } catch (error) {
    console.error("Error generating modpack:", error);
    throw error;
  }
}

// Generate modpack
app.post("/api/modpack/generate", authenticate, async (req, res) => {
  try {
    // Check if server is Forge
    const serverType = process.env.SERVER_TYPE || "vanilla";
    if (serverType.toLowerCase() !== "forge") {
      return res.status(400).json({
        error: "Modpack generation is only available for Forge servers",
        userMessage:
          "This feature is only available when running a Forge server. Your server is currently set to " +
          serverType +
          ".",
      });
    }

    // Check if mods folder exists and has mods
    const modsDir = MODS_DIR;
    if (!fs.existsSync(modsDir)) {
      return res.status(400).json({
        error: "Mods folder not found",
        userMessage:
          "No mods folder found. Please make sure your Forge server is properly set up.",
      });
    }

    const modFiles = fs.readdirSync(modsDir).filter((f) => f.endsWith(".jar"));
    if (modFiles.length === 0) {
      return res.status(400).json({
        error: "No mods found",
        userMessage:
          "No mods found in the mods folder. Please add at least one mod (.jar file) before generating a modpack.",
      });
    }

    const result = await generateModpackManifest();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      userMessage:
        "An error occurred while generating the modpack. Please try again.",
    });
  }
});

// Get modpack status
app.get("/api/modpack/status", authenticate, async (req, res) => {
  try {
    const serverType = process.env.SERVER_TYPE || "vanilla";
    const isForge = serverType.toLowerCase() === "forge";

    const modpackDir = path.join(__dirname, "..", "modpack");
    const indexFile = path.join(modpackDir, "modrinth.index.json");

    const modsDir = MODS_DIR;
    const modFiles = fs.existsSync(modsDir)
      ? fs.readdirSync(modsDir).filter((f) => f.endsWith(".jar"))
      : [];

    if (!fs.existsSync(indexFile)) {
      return res.json({
        exists: false,
        modCount: modFiles.length,
        lastGenerated: null,
        isForge,
        serverType,
        canGenerate: isForge && modFiles.length > 0,
      });
    }

    const stats = fs.statSync(indexFile);

    res.json({
      exists: true,
      modCount: modFiles.length,
      lastGenerated: stats.mtime,
      isForge,
      serverType,
      canGenerate: isForge && modFiles.length > 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve pack.toml
app.get("/modpack/pack.toml", (req, res) => {
  const packFile = path.join(__dirname, "..", "modpack", "pack.toml");
  if (!fs.existsSync(packFile)) {
    return res.status(404).send("Modpack not generated yet");
  }
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", 'attachment; filename="pack.toml"');
  res.sendFile(packFile);
});

// Serve index.toml
app.get("/modpack/index.toml", (req, res) => {
  const indexFile = path.join(__dirname, "..", "modpack", "index.toml");
  if (!fs.existsSync(indexFile)) {
    return res.status(404).send("Modpack not generated yet");
  }
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", 'attachment; filename="index.toml"');
  res.sendFile(indexFile);
});

// Serve mod metadata files
app.get("/modpack/mods/:filename", (req, res) => {
  const filename = req.params.filename;
  const modFile = path.join(__dirname, "..", "modpack", "mods", filename);
  if (!fs.existsSync(modFile)) {
    return res.status(404).send("Mod metadata not found");
  }
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.sendFile(modFile);
});

// Download modpack as .mrpack ZIP file (for Prism Launcher import)
app.get("/modpack/download", async (req, res) => {
  try {
    const modpackDir = path.join(__dirname, "..", "modpack");
    const indexFile = path.join(modpackDir, "modrinth.index.json");

    if (!fs.existsSync(indexFile)) {
      return res
        .status(404)
        .send("Modpack not generated yet. Please generate the modpack first.");
    }

    // Read modrinth.index.json to get modpack name for filename
    const indexContent = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    const packName = (indexContent.name || "modpack").replace(
      /[^a-zA-Z0-9-_]/g,
      "_",
    );

    // Set headers for ZIP download
    res.setHeader("Content-Type", "application/x-modrinth-modpack+zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${packName}.mrpack"`,
    );

    // Create ZIP archive
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      throw err;
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add modrinth.index.json to root of ZIP (REQUIRED)
    archive.file(indexFile, { name: "modrinth.index.json" });

    // Finalize the archive
    await archive.finalize();
  } catch (error) {
    console.error("Error creating modpack ZIP:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Download individual mod (for players)
app.get("/api/modpack/download-mod/:filename", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const modPath = path.join(MODS_DIR, filename);

    if (!fs.existsSync(modPath)) {
      return res.status(404).json({ error: "Mod not found" });
    }

    res.download(modPath, filename);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Hunter's Guild API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  // Ensure query is enabled on startup
  ensureQueryEnabled();
});
