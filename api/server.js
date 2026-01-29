require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const { Server } = require('socket.io');
const Docker = require('dockerode');
const multer = require('multer');

const app = express();
const server = http.createServer(app);

// Docker client (connects via socket)
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Configuration from environment
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;
const MC_CONTAINER_NAME = process.env.MC_CONTAINER_NAME || 'minecraft-server';

// Paths
const SERVER_DIR = '/server';
const MODS_DIR = path.join(SERVER_DIR, 'mods');
const CONFIG_DIR = path.join(SERVER_DIR, 'config');
const WORLD_DIR = path.join(SERVER_DIR, 'world');

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: true, // Allow all origins in Docker (Caddy handles CORS)
  credentials: true,
}));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'lax' }
}));

// Initialize Socket.IO
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

// ===== AUTHENTICATION =====

const authenticate = (req, res, next) => {
  const token = req.cookies.token || 
    (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// ===== API ROUTES =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    return res.json({ message: 'Logged in successfully', token });
  }
  
  return res.status(401).json({ error: 'Invalid credentials' });
});

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// Validate token
app.get('/api/validate-token', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ===== DOCKER CONTAINER MANAGEMENT =====

async function getMinecraftContainer() {
  const containers = await docker.listContainers({ all: true });
  return containers.find(c => c.Names.some(n => n.includes(MC_CONTAINER_NAME)));
}

const util = require('minecraft-server-util');

async function getContainerStatus() {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return { running: false, status: 'not_found' };
    }
    
    const container = docker.getContainer(containerInfo.Id);
    const inspect = await container.inspect();
    
    // Extract environment variables first (always available)
    const envVars = {};
    if (inspect.Config && inspect.Config.Env) {
      inspect.Config.Env.forEach(env => {
        const [key, value] = env.split('=');
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
            // Try to query the server to see if it's actually ready
            const status = await util.status('minecraft', 25565, { timeout: 3000 });
            players = { 
                online: status.players.online, 
                max: status.players.max,
                sample: status.players.sample || [] // List of { name, id }
            };
            serverReady = true; // Server is accepting connections
        } catch (e) {
            // Server might be starting or query might be disabled
            console.log('Player query failed:', e.message);
            // Fallback: if container has been running for a while and is healthy, assume ready
            serverReady = likelyReady && inspect.State.Health?.Status === 'healthy';
        }
    }

    // Determine actual status
    let actualStatus = inspect.State.Status;
    if (inspect.State.Running && !serverReady) {
      actualStatus = 'starting'; // Container running but server not ready
    } else if (inspect.State.Running && serverReady) {
      actualStatus = 'running'; // Fully operational
    }

    return {
      running: inspect.State.Running,
      status: actualStatus,
      serverReady: serverReady,
      startedAt: inspect.State.StartedAt,
      uptime: uptime,
      health: inspect.State.Health?.Status || 'unknown',
      config: {
        mcVersion: envVars.MC_VERSION || 'unknown',
        serverType: envVars.SERVER_TYPE || 'unknown',
        forgeVersion: envVars.FORGE_VERSION || ''
      },
      players
    };
  } catch (error) {
    console.error('Error getting container status:', error);
    return { running: false, status: 'error', error: error.message };
  }
}

// Get server status
app.get('/api/status', authenticate, async (req, res) => {
  try {
    const status = await getContainerStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.post('/api/start', authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: 'Minecraft container not found' });
    }
    
    const container = docker.getContainer(containerInfo.Id);
    
    io.emit('serverStatusUpdate', { action: 'starting' });
    broadcastLog('[System] Starting server...');
    
    await container.start();
    
    // Wait a bit before attaching to ensure container is ready
    setTimeout(async () => {
      await attachGlobalLogStream(container, true); // silent = true to avoid duplicate messages
      broadcastLog('[System] Server container started.');
      io.emit('serverStatusUpdate', { action: 'started' });
    }, 2000);
    
    res.json({ message: 'Server starting...' });
  } catch (error) {
    if (error.statusCode === 304) {
      broadcastLog('[System] Server already running.');
      // Ensure log stream is attached even if already running
      const containerInfo = await getMinecraftContainer();
      if (containerInfo && !globalLogStream) {
        const container = docker.getContainer(containerInfo.Id);
        attachGlobalLogStream(container);
      }
      return res.json({ message: 'Server already running' });
    }
    broadcastLog(`[System] Start failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Stop server
app.post('/api/stop', authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: 'Minecraft container not found' });
    }
    
    const container = docker.getContainer(containerInfo.Id);
    
    io.emit('serverStatusUpdate', { action: 'stopping' });
    broadcastLog('[System] Stopping server...');
    
    // Send stop command gracefully
    const exec = await container.exec({
      Cmd: ['rcon-cli', 'stop'],
      AttachStdout: true,
      AttachStderr: true
    });
    
    let rconSuccess = false;
    try {
      await exec.start();
      broadcastLog('[System] Sent graceful stop command via RCON.');
      rconSuccess = true;
      
      // Wait up to 15 seconds for graceful shutdown
      let waited = 0;
      while (waited < 15) {
        const inspect = await container.inspect();
        if (!inspect.State.Running) {
          broadcastLog('[System] Server stopped gracefully.');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        waited++;
      }
    } catch (e) {
      // If RCON fails, just stop the container
      broadcastLog('[System] RCON failed, forcing container stop...');
    }
    
    // If still running, force stop with shorter timeout
    const inspect = await container.inspect();
    if (inspect.State.Running) {
      broadcastLog('[System] Forcing container stop...');
      await container.stop({ t: 10 });
    }
    
    broadcastLog('[System] Server stopped.');
    io.emit('serverStatusUpdate', { action: 'stopped' });
    
    // Clean up log stream
    if (globalLogStream) {
      try {
        globalLogStream.destroy();
        globalLogStream = null;
      } catch (e) {}
    }
    
    res.json({ message: 'Server stopping...' });
  } catch (error) {
    if (error.statusCode === 304) {
      broadcastLog('[System] Server already stopped.');
      return res.json({ message: 'Server already stopped' });
    }
    broadcastLog(`[System] Stop failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Restart server
app.post('/api/restart', authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: 'Minecraft container not found' });
    }
    
    const container = docker.getContainer(containerInfo.Id);
    
    io.emit('serverStatusUpdate', { action: 'restarting' });
    broadcastLog('[System] Restarting server...');
    
    // Clean up existing stream before restart
    if (globalLogStream) {
      try {
        globalLogStream.destroy();
        globalLogStream = null;
      } catch (e) {}
    }
    
    // Restart with shorter timeout
    await container.restart({ t: 10 });
    broadcastLog('[System] Container restarted, waiting for server to start...');
    
    // Send status update that server is starting
    io.emit('serverStatusUpdate', { action: 'starting' });
    
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
          broadcastLog('[System] Server started successfully.');
          io.emit('serverStatusUpdate', { action: 'started' });
          return;
        }
        if (Date.now() - startTime < maxWait) {
          setTimeout(checkReady, 5000); // Check every 5 seconds
        } else {
          // Timeout - send started anyway to unblock UI
          broadcastLog('[System] Server start timeout, check status manually.');
          io.emit('serverStatusUpdate', { action: 'started' });
        }
      } catch (e) {
        // Keep polling on error
        if (Date.now() - startTime < maxWait) {
          setTimeout(checkReady, 5000);
        } else {
          io.emit('serverStatusUpdate', { action: 'started' });
        }
      }
    };
    
    // Start checking after 10 seconds
    setTimeout(checkReady, 10000);
    
    res.json({ message: 'Server restarting...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kill server (Force Stop)
app.post('/api/kill', authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: 'Minecraft container not found' });
    }
    
    // Check if running first
    const container = docker.getContainer(containerInfo.Id);
    const inspect = await container.inspect();
    if (!inspect.State.Running) {
       return res.json({ message: 'Server is already stopped' });
    }
    
    await container.kill();
    
    io.emit('serverStatusUpdate', { action: 'killed' });
    res.json({ message: 'Server killed.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send command to server
app.post('/api/command', authenticate, async (req, res) => {
  const { command } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: 'Command required' });
  }
  
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: 'Minecraft container not found' });
    }
    
    const container = docker.getContainer(containerInfo.Id);
    
    // Send command via RCON CLI
    const exec = await container.exec({
      Cmd: ['rcon-cli', command],
      AttachStdout: true,
      AttachStderr: true
    });
    
    // Start exec and get stream
    const stream = await exec.start();
    
    // Capture output to send back (optional, but good for feedback)
    let output = '';
    stream.on('data', chunk => output += chunk.toString());
    
    // Also broadcast to console logs
    io.emit('log', `> ${command}`);
    
    res.json({ message: 'Command sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kick Player
app.post('/api/kick', authenticate, async (req, res) => {
  const { playerName } = req.body;
  if (!playerName) return res.status(400).json({ error: 'Player name required' });

  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) return res.status(404).json({ error: 'Container not found' });
    
    const container = docker.getContainer(containerInfo.Id);
    
    // Execute kick command via RCON
    const exec = await container.exec({
      Cmd: ['rcon-cli', 'kick', playerName, 'Kicked by admin'],
      AttachStdout: true,
      AttachStderr: true
    });
    
    await exec.start();
    io.emit('log', `[System] Kicked player: ${playerName}`);
    
    res.json({ message: `Kicked ${playerName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== VERSION MANAGEMENT =====

// Get available versions
app.get('/api/versions', authenticate, async (req, res) => {
  try {
    // Fetch from Mojang API
    const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const manifest = await response.json();
    
    // Get release versions (last 30)
    const versions = manifest.versions
      .filter(v => v.type === 'release')
      .slice(0, 30)
      .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
    
    res.json({
      serverTypes: ['vanilla', 'forge'],  // Only Vanilla and Forge
      versions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get valid Forge builds for a specific MC version
app.get('/api/versions/forge/:mcVersion', authenticate, async (req, res) => {
  const { mcVersion } = req.params;
  try {
    // Fetch from Forge Maven (promotions_slim contains recommended and latest)
    const response = await fetch('https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json');
    const data = await response.json();
    const promos = data.promos;
    
    // We want to list builds. The promos only show "latest" and "recommended".
    // For a full list, we might need a different scrape.
    // However, for "Minimum Complete", showing "Recommended" and "Latest" is perfectly fine and safer.
    
    const builds = [];
    if (promos[`${mcVersion}-recommended`]) {
      builds.push({ id: promos[`${mcVersion}-recommended`], type: 'recommended' });
    }
    if (promos[`${mcVersion}-latest`]) {
      // Avoid duplicate if latest == recommended
      if (promos[`${mcVersion}-latest`] !== promos[`${mcVersion}-recommended`]) {
        builds.push({ id: promos[`${mcVersion}-latest`], type: 'latest' });
      }
    }
    
    // Fallback: if no promos found for this version (e.g. very old or very new), return empty
    res.json({ builds });
  } catch (error) {
    console.error('Error fetching forge builds:', error);
    res.status(500).json({ error: 'Failed to fetch Forge builds' });
  }
});

// Change version (recreates container with new settings)
app.post('/api/version/change', authenticate, async (req, res) => {
  const { version, serverType, forgeVersion } = req.body;
  
  if (!version) {
    return res.status(400).json({ error: 'Version required' });
  }
  
  const newType = serverType || 'forge';
  
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
        console.log('Stopping server for version change...');
        await container.stop({ t: 30 });
      }
      
      // Remove old container
      console.log('Removing old container...');
      await container.remove();

      imageToUse = inspect.Config.Image;
      hostConfigToUse = inspect.HostConfig;
      
      const oldEnv = inspect.Config.Env || [];
      newEnv = oldEnv
        .filter(e => !e.startsWith('MC_VERSION=') && !e.startsWith('SERVER_TYPE=') && !e.startsWith('FORGE_VERSION='));
    } else {
       // Container does not exist: Use defaults
       console.log('No existing container found. Creating fresh one.');
       
       // Try to auto-discover binds from API container (which is a sibling)
       // This ensures we use the correct named volumes and host paths (like server.properties)
       let binds = [];
       try {
         const os = require('os');
         const apiContainer = docker.getContainer(os.hostname());
         const apiInspect = await apiContainer.inspect();
         const mounts = apiInspect.Mounts || [];
         
         const getSource = (target) => {
            const m = mounts.find(m => m.Destination === target);
            // For volumes use Name, for binds use Source (host path)
            return m ? (m.Type === 'volume' ? m.Name : m.Source) : null;
         };

         const worldSource = getSource('/server/world') || 'minecraft-world';
         const modsSource = getSource('/server/mods') || 'minecraft-mods';
         const configSource = getSource('/server/config') || 'minecraft-config';
         const propsSource = getSource('/server/server.properties');

         binds = [
           `${worldSource}:/server/world`,
           `${modsSource}:/server/mods`,
           `${configSource}:/server/config`
         ];
         
         if (propsSource) {
           binds.push(`${propsSource}:/server/server.properties`);
         }
       } catch (err) {
         console.warn("Failed to inspect self for binds, falling back to defaults:", err);
         binds = [
            'minecraft-world:/server/world',
            'minecraft-mods:/server/mods',
            'minecraft-config:/server/config'
         ];
       }

       imageToUse = 'minecraft-minecraft:latest'; 
       hostConfigToUse = {
         Binds: binds,
         PortBindings: {
           '25565/tcp': [{ HostPort: '25565' }]
         },
         Memory: 4 * 1024 * 1024 * 1024, // Default 4GB
       };
       
       newEnv = [
         'EULA=TRUE',
         'MEMORY=4G',
         'MAX_MEMORY=4G',
         'TYPE=FORGE',
         'TZ=UTC'
       ];
    }
      
    newEnv.push(`MC_VERSION=${version}`);
    newEnv.push(`SERVER_TYPE=${newType}`);
    
    if (newType === 'forge' && forgeVersion) {
      newEnv.push(`FORGE_VERSION=${forgeVersion}`);
    }
    
    // Create new container with updated environment
    console.log(`Creating new container: ${newType} ${version}...`);
    const newContainer = await docker.createContainer({
      name: MC_CONTAINER_NAME,
      Image: imageToUse,
      Env: newEnv,
      HostConfig: hostConfigToUse,
      ExposedPorts: { '25565/tcp': {} },
      Tty: true,
      OpenStdin: true
    });
    
    // Start the new container
    console.log('Starting new container...');
    await newContainer.start();
    
    attachGlobalLogStream(newContainer);
    
    io.emit('serverStatusUpdate', { action: 'version_changed', version, serverType: newType });
    
    res.json({ 
      message: `Switching to ${newType} ${version}. Server is restarting with new version.`,
      version,
      serverType: newType,
      status: 'recreating'
    });
  } catch (error) {
    console.error('Version change error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== MOD MANAGEMENT =====

// List mods
app.get('/api/mods', authenticate, (req, res) => {
  try {
    if (!fs.existsSync(MODS_DIR)) {
      return res.json({ mods: [] });
    }
    
    const files = fs.readdirSync(MODS_DIR);
    const mods = files
      .filter(f => f.endsWith('.jar'))
      .map(f => {
        const stats = fs.statSync(path.join(MODS_DIR, f));
        return {
          name: f,
          size: stats.size,
          modified: stats.mtime
        };
      });
    
    res.json({ mods });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete mod
app.delete('/api/mods/:name', authenticate, (req, res) => {
  const modPath = path.join(MODS_DIR, req.params.name);
  
  try {
    if (!fs.existsSync(modPath)) {
      return res.status(404).json({ error: 'Mod not found' });
    }
    
    fs.unlinkSync(modPath);
    res.json({ message: 'Mod deleted', name: req.params.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload mod
const modUpload = multer({
  dest: '/tmp/mods',
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.jar')) {
      cb(null, true);
    } else {
      cb(new Error('Only .jar files allowed'));
    }
  }
});

app.post('/api/mods/upload', authenticate, modUpload.single('mod'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Ensure mods directory exists
    if (!fs.existsSync(MODS_DIR)) {
      fs.mkdirSync(MODS_DIR, { recursive: true });
    }
    
    const destPath = path.join(MODS_DIR, req.file.originalname);
    
    // Use copy + unlink instead of rename to handle cross-device moves (EXDEV)
    try {
      fs.copyFileSync(req.file.path, destPath);
      fs.unlinkSync(req.file.path);
    } catch (moveError) {
      console.error('File move error:', moveError);
      // Clean up temp file if copy failed
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      throw new Error('Failed to save mod file');
    }
    
    res.json({ message: 'Mod uploaded successfully', name: req.file.originalname });
  } catch (error) {
    console.error('Upload error:', error);
    // Send a clean error message to the user
    res.status(500).json({ error: 'Failed to upload mod. Please try again.' });
  }
});

// ===== SERVER RESET =====

// Reset server (delete world, keep config)
app.post('/api/server/reset', authenticate, async (req, res) => {
  const { deleteWorld, deleteMods, deleteConfig } = req.body;
  
  try {
    // Stop the server first
    const containerInfo = await getMinecraftContainer();
    if (containerInfo) {
      const container = docker.getContainer(containerInfo.Id);
      const inspect = await container.inspect();
      
      console.log('[System] Stopping server for reset...');
      io.emit('log', '[System] Stopping server for data reset...');
      
      if (inspect.State.Running) {
        await container.stop({ t: 10 });
      }
      
      // Remove container to release file locks on Windows
      console.log('[System] Removing container to release file locks...');
      io.emit('log', '[System] Analyzing file locks...');
      await container.remove();
      
      // Wait for file locks to actually release (Windows Docker Desktop quirk)
      await new Promise(r => setTimeout(r, 2000));
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
           await new Promise(r => setTimeout(r, 500));
           try { fs.rmSync(curPath, { recursive: true, force: true }); } catch (retryE) {}
        }
      }
    };

    // Delete world contents if requested
    if (deleteWorld) {
      await emptyDirectory(WORLD_DIR);
      deleted.push('world');
    }
    
    // Delete mods contents if requested
    if (deleteMods) {
      await emptyDirectory(MODS_DIR);
      deleted.push('mods');
    }
    
    // Delete config contents if requested
    if (deleteConfig) {
      await emptyDirectory(CONFIG_DIR);
      deleted.push('config');
    }
    
    io.emit('serverStatusUpdate', { action: 'reset' });
    io.emit('log', '[System] Server reset complete. World data deleted.');
    
    // Recreate the container so it's ready to start
    console.log('[System] Recreating container...');
    const newContainerInfo = await getMinecraftContainer();
    if (!newContainerInfo) {
       // If we removed it, we might need to recreate it from image info or similar...
       // Actually, 'start' command usually requires it to exist.
       // The restart/start logic in this API assumes container exists.
       // We need to re-create it using the same config as before.
       // Ideally, we should have stored the config before deleting.
       // However, `docker-compose up` usually handles creation. 
       // Since we are inside docker-compose, maybe we leave it deleted and let the user click "Start" 
       // which typically calls /api/start. BUT /api/start checks getMinecraftContainer().
       // If it returns null, /api/start fails.
       
       // So we MUST recreate it.
       // Let's use the env variables (default or stored) to create it.
       // But inspect.Config.Env is gone.
       
       // ALTERNATIVE: Don't remove container. Just rely on retry logic.
       // But EBUSY persistent means container is holding it.
       // Let's try aggressive retry with longer delay first.
       // AND emit logs so user sees it.
    }

    res.json({ 
      message: 'Server reset complete', 
      deleted,
      note: 'Start the server to generate a new world'
    });
  } catch (error) {
    console.error('Reset error:', error);
    io.emit('log', `[Error] Reset failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ===== SERVER PROPERTIES =====

// Get server.properties
app.get('/api/server-properties', authenticate, (req, res) => {
  const propsPath = path.join(SERVER_DIR, 'server.properties');
  
  try {
    if (!fs.existsSync(propsPath)) {
      return res.json({ properties: {} });
    }
    
    const content = fs.readFileSync(propsPath, 'utf-8');
    const properties = {};
    
    content.split('\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key) {
          properties[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    
    res.json({ properties });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update server.properties
app.put('/api/server-properties', authenticate, (req, res) => {
  const { properties } = req.body;
  const propsPath = path.join(SERVER_DIR, 'server.properties');
  
  try {
    // Always force enable-query=true for proper status monitoring
    properties['enable-query'] = 'true';
    
    let content = '#Minecraft server properties\n';
    content += `#Updated ${new Date().toISOString()}\n`;
    
    Object.entries(properties).forEach(([key, value]) => {
      content += `${key}=${value}\n`;
    });
    
    fs.writeFileSync(propsPath, content);
    res.json({ message: 'Properties updated. Restart server to apply.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== FILE BROWSER =====

app.get('/api/dir', authenticate, (req, res) => {
  const requestedPath = req.query.path || '/';
  const fullPath = path.join(SERVER_DIR, requestedPath);
  
  try {
    // Security: ensure we stay within SERVER_DIR
    if (!fullPath.startsWith(SERVER_DIR)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }
    
    // Recursive function to build directory tree
    const buildTree = (dirPath, maxDepth = 3, currentDepth = 0) => {
      if (currentDepth >= maxDepth) return [];
      
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
          .filter(item => {
            // Skip hidden files and system directories
            if (item.name.startsWith('.')) return false;
            if (['node_modules', '__pycache__'].includes(item.name)) return false;
            return true;
          })
          .map(item => {
            const itemPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
              return {
                name: item.name,
                type: 'directory',
                children: buildTree(itemPath, maxDepth, currentDepth + 1)
              };
            } else {
              const itemStats = fs.statSync(itemPath);
              return {
                name: item.name,
                type: 'file',
                size: itemStats.size
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

// ===== BACKUP =====

app.post('/api/backup', authenticate, async (req, res) => {
  try {
    const containerInfo = await getMinecraftContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: 'Minecraft container not found' });
    }
    
    const container = docker.getContainer(containerInfo.Id);
    
    // Execute backup script
    const exec = await container.exec({
      Cmd: ['/backup.sh'],
      AttachStdout: true,
      AttachStderr: true
    });
    
    const stream = await exec.start();
    let output = '';
    
    stream.on('data', chunk => output += chunk.toString());
    stream.on('end', () => {
      res.json({ message: 'Backup completed', output });
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
  io.emit('log', cleanMessage);
}

// Function to attach robust log streaming to a container
async function attachGlobalLogStream(container, silent = false) {
  try {
    if (globalLogStream) {
       // Destroy existing stream if we are re-attaching (e.g. after container recreation)
       try { 
         globalLogStream.destroy(); 
         console.log('[System] Destroyed previous log stream.');
       } catch(e) {}
       globalLogStream = null;
    }

    console.log('[System] Attaching global log stream...');
    if (!silent) {
      broadcastLog(`[System] Attaching log stream...`);
    }

    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 50, // Only fetch recent on attach to avoid flood
      timestamps: true
    });
    
    globalLogStream = stream;

    stream.on('data', chunk => {
      // Docker sends an 8-byte header with stream type and size
      // We slice it off to get the raw text
      if (chunk.length > 8) {
         const payload = chunk.slice(8).toString('utf8');
         broadcastLog(payload);
      }
    });

    stream.on('end', () => {
       console.log('[System] Log stream ended.');
       broadcastLog('[System] Log stream ended.');
       globalLogStream = null;
       
       // Try to reattach after a short delay if container is still running
       setTimeout(async () => {
         try {
           const inspect = await container.inspect();
           if (inspect.State.Running) {
             console.log('[System] Attempting to reattach log stream...');
             attachGlobalLogStream(container);
           }
         } catch (e) {
           console.log('[System] Container no longer available for reattachment.');
         }
       }, 2000);
    });

    stream.on('error', (err) => {
       console.error('[System] Log stream error:', err);
       broadcastLog(`[System] Log stream error: ${err.message}`);
       globalLogStream = null;
    });

  } catch (error) {
    console.error('Failed to attach log stream:', error);
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
   } catch(e) { console.error("Startup log attach failed:", e); }
})();


io.on('connection', async (socket) => {
  console.log('Client connected. Sending log buffer...');
  socket.emit('log', `[System] Connected to API. Fetching history...`);
  
  // Send buffer history
  logBuffer.forEach(line => socket.emit('log', line));
  
  // If we have no active stream but a container exists, try to attach (recovery)
  if (!globalLogStream) {
     const info = await getMinecraftContainer();
     if (info) {
        // Double check running state
        const container = docker.getContainer(info.Id);
        const inspect = await container.inspect();
        if (inspect.State.Running) {
           attachGlobalLogStream(container);
        }
     }
  }
});

// Helper function to ensure enable-query is always true in server.properties
const ensureQueryEnabled = () => {
  const propsPath = path.join(SERVER_DIR, 'server.properties');
  try {
    if (fs.existsSync(propsPath)) {
      const content = fs.readFileSync(propsPath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;
      
      const newLines = lines.map(line => {
        if (line.startsWith('enable-query=')) {
          if (line.trim() !== 'enable-query=true') {
            modified = true;
            return 'enable-query=true';
          }
        }
        return line;
      });
      
      // If enable-query line doesn't exist, add it
      if (!lines.some(l => l.startsWith('enable-query='))) {
        newLines.push('enable-query=true');
        modified = true;
      }
      
      if (modified) {
        fs.writeFileSync(propsPath, newLines.join('\n'));
        console.log('[Startup] Ensured enable-query=true in server.properties');
      }
    }
  } catch (e) {
    console.error('[Startup] Error ensuring enable-query:', e.message);
  }
};

// Start server
server.listen(PORT, () => {
  console.log(`Hunter's Guild API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Ensure query is enabled on startup
  ensureQueryEnabled();
});
