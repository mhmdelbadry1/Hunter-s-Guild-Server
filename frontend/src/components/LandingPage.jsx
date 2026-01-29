import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '../styles/LandingPage.css';
import image from '../assets/image1.png';
import logo from '../assets/Hunter-X-Hunter-Logo-PNG-Image.png';
import ServerFilesView from './ServerFilesView';
import Login from './Login';
import VersionSelector from './VersionSelector';
import ServerPropertiesEditor from './ServerPropertiesEditor';
import { apiUrl, API_ROOT } from '../config/api';

// Use API_ROOT for external status API, apiUrl() for our backend

import HeroBanner from './HeroBanner';

function LandingPage() {
  // Set document title on mount
  useEffect(() => {
    document.title = "Hunter's Guild";
    console.log("Hunter's Guild Frontend v1.3 - HERO BANNER DEBUG BUILD");
  }, []);

  // If no JWT token exists, user is not logged in.
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // Track if we are currently validating the token
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Persist SFTP credentials if needed
  const [sftpCredentials, setSftpCredentials] = useState(() => {
    const stored = localStorage.getItem('sftpCredentials');
    return stored ? JSON.parse(stored) : null;
  });

  // Other state variables
  const [serverInfo, setServerInfo] = useState(null);
  const [logLines, setLogLines] = useState(["No logs yet..."]);
  const [loading, setLoading] = useState(false);
  const [serverAction, setServerAction] = useState(() => localStorage.getItem('serverAction') || "idle");
  const [showModsModal, setShowModsModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showPropertiesModal, setShowPropertiesModal] = useState(false);

  // Version Selector State
  const [availableVersions, setAvailableVersions] = useState([]);
  const [availableForgeBuilds, setAvailableForgeBuilds] = useState([]);
  
  const [selectedServerType, setSelectedServerType] = useState('vanilla');
  const [selectedMcVersion, setSelectedMcVersion] = useState('');
  const [selectedForgeBuild, setSelectedForgeBuild] = useState('');
  const [promptLine, setPromptLine] = useState("");
  const [modsList, setModsList] = useState([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [publicIp, setPublicIp] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);

  const socketRef = useRef(null);
  const logContainerRef = useRef(null);
  const promptRef = useRef(null); // Ref for the prompt line
  const pollIntervalRef = useRef(null);

  // Track if the console focus notification has been shown
  const firstConsoleClick = useRef(true);

  const disabledStyle = { cursor: 'not-allowed', pointerEvents: 'none', opacity: 0.6 };

  const paramServerOffline = (info) => !info || !info.running;

  const particleElements = useMemo(() => {
    const particles = [];
    const count = 10;
    const centerX = 80;
    const centerY = 20;
    const maxDistance = 35;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * maxDistance;
      const top = centerY + distance * Math.sin(angle);
      const left = centerX + distance * Math.cos(angle);
      particles.push(
        <span key={i} className="particle" style={{ top: `${top}%`, left: `${left}%` }}></span>
      );
    }
    return particles;
  }, []);

  const showNotification = (message, options = {}) => {
    toast(message, {
      position: "top-right",
      autoClose: 5000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      ...options
    });
  };

  useLayoutEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines, promptLine]);

  useEffect(() => {
    // Safety check inside RAF to prevent "cannot read properties of null"
    requestAnimationFrame(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    });
  }, [logLines, promptLine]);

  // Persist state changes
  useEffect(() => {
    localStorage.setItem('serverAction', serverAction);
  }, [serverAction]);



  // Validate token on mount
  useEffect(() => {
    const token = localStorage.getItem('jwtToken');
    if (token) {
      setIsAuthChecking(true);
      axios.get(apiUrl('/validate-token'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        if (res.data.valid) {
          setIsLoggedIn(true);
        } else {
          setIsLoggedIn(false);
          localStorage.removeItem('jwtToken');
        }
      })
      .catch(() => {
        setIsLoggedIn(false);
        localStorage.removeItem('jwtToken');
      })
      .finally(() => {
        setIsAuthChecking(false);
      });
    } else {
      setIsLoggedIn(false);
      setIsAuthChecking(false);
    }
  }, []);

  // Regex to strip ANSI codes
  const stripAnsi = (str) => {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  };

  // Setup Socket.IO connection

  useEffect(() => {
    if (!isLoggedIn) return; // Only connect if logged in

    const token = localStorage.getItem('jwtToken');
    // Ensure we close old connection if any
    if (socketRef.current) {
        socketRef.current.disconnect();
    }

    socketRef.current = io(API_ROOT || window.location.origin, { query: { token } });
    socketRef.current.on("connect", () => {
      console.log("Connected to Socket.IO");
    });
    socketRef.current.on("serverStatusUpdate", (data) => {
      console.log("Received server status update event.", data);
      
      // Handle action-based status updates
      if (data && data.action) {
        switch (data.action) {
          case 'starting':
            setServerAction("starting");
            localStorage.setItem("serverAction", "starting");
            localStorage.setItem("serverActionTimestamp", Date.now().toString());
            break;
          case 'started':
            setServerAction("idle");
            localStorage.setItem("serverAction", "idle");
            localStorage.removeItem("serverActionTimestamp");
            break;
          case 'stopping':
            setServerAction("stopping");
            localStorage.setItem("serverAction", "stopping");
            localStorage.setItem("serverActionTimestamp", Date.now().toString());
            break;
          case 'stopped':
            setServerAction("idle");
            localStorage.setItem("serverAction", "idle");
            localStorage.removeItem("serverActionTimestamp");
            break;
          case 'restarting':
            setServerAction("restarting");
            localStorage.setItem("serverAction", "restarting");
            localStorage.setItem("serverActionTimestamp", Date.now().toString());
            break;
          case 'reset':
            setServerAction("idle");
            localStorage.setItem("serverAction", "idle");
            localStorage.removeItem("serverActionTimestamp");
            break;
          default:
            // Unknown action - reset to idle
            setServerAction("idle");
            localStorage.setItem("serverAction", "idle");
            localStorage.removeItem("serverActionTimestamp");
            break;
        }
      }

      fetchStatus();
    });
    socketRef.current.on("log", (data) => {
      const cleanLine = stripAnsi(data);
      if (!cleanLine.trim()) return; 

      setLogLines((prev) => {
        let newLines = [...prev];
        if (newLines.length === 1 && newLines[0] === "No logs yet...") {
          newLines = [];
        }
        // Limit log history to prevent performance issues
        if (newLines.length > 500) {
            newLines = newLines.slice(newLines.length - 500);
        }
        return [...newLines, cleanLine];
      });
    });
    socketRef.current.on("clear_logs", () => {
      setLogLines(["No logs yet..."]);
    });
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 30000);
    return () => clearInterval(intervalId);
  }, []);

  const fetchPublicIp = async () => {
    setIpLoading(true);
    try {
      const res = await axios.get('https://api.ipify.org?format=json');
      setPublicIp(res.data.ip);
    } catch (error) {
      console.error("Error fetching IP:", error);
    }
    setIpLoading(false);
  };

  useEffect(() => {
    fetchPublicIp();
  }, []);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('jwtToken');
      const res = await axios.get(apiUrl('/status'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      setServerInfo(res.data);
      
      // Smart action state recovery - if stuck in an action state but server state is stable, reset to idle
      const currentAction = localStorage.getItem('serverAction');
      if (currentAction && currentAction !== 'idle') {
        const isOnline = res.data.running === true;
        const isOffline = res.data.running === false;
        const isReady = res.data.serverReady === true;
        
        // If we're "starting" and server is online AND ready, reset to idle
        if (currentAction === 'starting' && isOnline && isReady) {
          console.log('Recovery: Server started and ready, resetting action state to idle');
          setServerAction('idle');
          localStorage.setItem('serverAction', 'idle');
          localStorage.removeItem('serverActionTimestamp');
        }
        // If we're "restarting" and server is online AND ready, reset to idle
        else if (currentAction === 'restarting' && isOnline && isReady) {
          console.log('Recovery: Server restarted and ready, resetting action state to idle');
          setServerAction('idle');
          localStorage.setItem('serverAction', 'idle');
          localStorage.removeItem('serverActionTimestamp');
        }
        // If we're "stopping" and server is offline, reset to idle
        else if (currentAction === 'stopping' && isOffline) {
          console.log('Recovery: Server is offline, resetting action state to idle');
          setServerAction('idle');
          localStorage.setItem('serverAction', 'idle');
          localStorage.removeItem('serverActionTimestamp');
        }
        
        // If action has been stuck for more than 3 minutes, force reset regardless of state
        const actionTimestamp = localStorage.getItem('serverActionTimestamp');
        if (actionTimestamp) {
          const elapsed = Date.now() - parseInt(actionTimestamp, 10);
          if (elapsed > 180000) { // 3 minutes
            console.log('Recovery: Action stuck for too long, forcing reset to idle');
            setServerAction('idle');
            localStorage.setItem('serverAction', 'idle');
            localStorage.removeItem('serverActionTimestamp');
          }
        } else if (currentAction !== 'idle') {
          // No timestamp but action is not idle - this is a stale state, reset it
          // This handles the case where page was refreshed during an action but timestamp was lost
          console.log('Recovery: No timestamp for action state, checking if stale...');
          // Give a grace period - if server state matches expected end state, reset
          if ((currentAction === 'starting' && isOnline) || 
              (currentAction === 'restarting' && isOnline) ||
              (currentAction === 'stopping' && isOffline)) {
            console.log('Recovery: Server state matches expected, resetting to idle');
            setServerAction('idle');
            localStorage.setItem('serverAction', 'idle');
          }
        }
      }
      
      return res.data;
    } catch (error) {
      console.error("Error fetching server status:", error);
      setServerInfo({ error: "Error fetching server status" });
      return { error: "Error fetching server status" };
    }
  };

  const pollUntilStatus = (expectedOnline, timeout = 120000, interval = 3000) => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      pollIntervalRef.current = setInterval(async () => {
        try {
          const data = await fetchStatus();
          if (data && data.running === expectedOnline) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            resolve(data);
          } else if (Date.now() - startTime > timeout) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            reject(new Error("Timeout waiting for server status change"));
          }
        } catch (error) {
          console.error("Polling error:", error);
        }
      }, interval);
    });
  };

  const startServer = async () => {
    setLoading(true);
    setLogLines(["No logs yet..."]);
    setServerAction("starting");
    const token = localStorage.getItem('jwtToken');
    try {
      await axios.post(
        apiUrl('/start'),
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification("Server is starting...");
      try {
        await pollUntilStatus(true, 120000, 3000);
        showNotification("Server is online.");
      } catch (pollError) {
        const finalStatus = await fetchStatus();
        if (finalStatus && finalStatus.running) {
          showNotification("Server is online (detected after timeout).");
        } else {
          throw pollError;
        }
      }
    } catch (error) {
      console.error("Error starting server:", error);
      showNotification("Error starting server", { autoClose: 5000 });
    }
    setServerAction("idle");
    setLoading(false);
  };

  const stopServer = async () => {
    setLoading(true);
    setServerAction("stopping");
    const token = localStorage.getItem('jwtToken');
    try {
      await axios.post(
        apiUrl('/stop'),
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification("Server is stopping...");
      
      // Give it a moment
      await new Promise(r => setTimeout(r, 2000));

      try {
        await pollUntilStatus(false, 60000, 2000); // 60s timeout
        showNotification("Server is offline.");
        setLogLines((prev) => [...prev, "[System] Server stopped successfully."]);
      } catch (pollError) {
        const finalStatus = await fetchStatus();
        if (finalStatus && !finalStatus.running) {
          showNotification("Server is offline (detected after timeout).");
        } else {
          showNotification("Stop command sent, but server is slow to halt. Check logs.");
        }
      }
    } catch (error) {
      console.error("Error stopping server:", error);
      showNotification("Error stopping server", { autoClose: 5000 });
    }
    setServerAction("idle");
    setLoading(false);
  };

  const restartServer = async () => {
    setLoading(true);
    setLogLines((prev) => [...prev, "--- Restarting Server ---"]);
    setServerAction("restarting");
    const token = localStorage.getItem('jwtToken');
    try {
      await axios.post(
        apiUrl('/restart'),
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification("Server is restarting...");
      
      // Give it a moment to register the restart command
      await new Promise(r => setTimeout(r, 5000));
      
      // Wait for it to go offline (optional, don't throw if it misses it)
      try {
        await pollUntilStatus(false, 30000, 2000);
      } catch (e) {
        console.log("Server didn't report offline state, proceeding to wait for online...");
      }

      // Wait for it to come back online (increased timeout to 5 mins)
      try {
        await pollUntilStatus(true, 300000, 5000);
        showNotification("Server is online.");
      } catch (pollErrorOn) {
        const finalStatusOn = await fetchStatus();
        if (finalStatusOn && finalStatusOn.running) {
          showNotification("Server is online (detected after timeout).");
        } else {
          showNotification("Server restart timed out. Check logs.");
        }
      }
    } catch (error) {
      console.error("Error restarting server:", error);
      showNotification("Error restarting server", { autoClose: 5000 });
    }
    setServerAction("idle");
    setLoading(false);
  };

  const killServer = async () => {
    if (!window.confirm("⚠️ FORCE STOP (KILL) \n\nThis will instantly terminate the server process. \nData might not save. Use only if stuck.\n\nContinue?")) return;

    setLoading(true);
    setServerAction("stopping");
    const token = localStorage.getItem('jwtToken');
    try {
      await axios.post(
        apiUrl('/kill'),
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showNotification("Server killed.");
      await pollUntilStatus(false, 10000, 1000);
    } catch (error) {
      console.error("Error killing server:", error);
      showNotification("Error killing server: " + error.message);
    }
    setServerAction("idle");
    setLoading(false);
  };

  // ===== MODS MANAGEMENT =====
  const openModsModal = async () => {
    setShowModsModal(true);
    await fetchMods();
  };

  const fetchMods = async () => {
    setModsLoading(true);
    try {
      const token = localStorage.getItem('jwtToken');
      const res = await axios.get(apiUrl('/mods'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      setModsList(res.data.mods || []);
    } catch (error) {
      console.error("Error fetching mods:", error);
      showNotification("Error fetching mods list", { autoClose: 3000 });
    }
    setModsLoading(false);
  };

  const deleteMod = async (modName) => {
    if (!window.confirm(`Delete mod "${modName}"?`)) return;
    
    try {
      const token = localStorage.getItem('jwtToken');
      await axios.delete(apiUrl(`/mods/${encodeURIComponent(modName)}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(`Deleted: ${modName}`);
      await fetchMods(); // Refresh list
    } catch (error) {
      console.error("Error deleting mod:", error);
      showNotification("Error deleting mod", { autoClose: 3000 });
    }
  };

  // ===== BACKUP =====
  const triggerBackup = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('jwtToken');
      await axios.post(apiUrl('/backup'), {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification("✅ Backup started! Check logs for progress.");
    } catch (error) {
      console.error("Error triggering backup:", error);
      showNotification("Error starting backup", { autoClose: 3000 });
    }
    setLoading(false);
  };

  // ===== MOD UPLOAD =====
  const uploadMod = async (file) => {
    if (!file) return;
    
    const formData = new FormData();
    formData.append('mod', file);
    
    try {
      const token = localStorage.getItem('jwtToken');
      await axios.post(apiUrl('/mods/upload'), formData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      showNotification(`✅ Uploaded: ${file.name}`);
      await fetchMods(); // Refresh list
    } catch (error) {
      console.error("Error uploading mod:", error);
      showNotification("Error uploading mod: " + (error.response?.data?.error || error.message), { autoClose: 5000 });
    }
  };

  // ===== VERSION MANAGEMENT =====
  
  const fetchVersions = async () => {
    try {
      const token = localStorage.getItem('jwtToken');
      const response = await axios.get(apiUrl('/versions'), {
         headers: { Authorization: `Bearer ${token}` }
      });
      setAvailableVersions(response.data.versions || []);
      // Default type logic if needed
    } catch (error) {
      console.error("Error fetching versions:", error);
    }
  };

  const fetchForgeBuilds = async (mcVersion) => {
    if (!mcVersion) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('jwtToken');
      const response = await axios.get(apiUrl(`/versions/forge/${mcVersion}`), {
         headers: { Authorization: `Bearer ${token}` }
      });
      setAvailableForgeBuilds(response.data.builds || []);
    } catch (error) {
       console.error("Error fetching forge builds:", error);
       setAvailableForgeBuilds([]);
    } finally {
      setLoading(false);
    }
  };

  const handleVersionChange = async () => {
    if (!selectedMcVersion) return;
    if (selectedServerType === 'forge' && !selectedForgeBuild) {
       showNotification("Please select a Forge build.");
       return;
    }

    const confirmMsg = `Are you sure you want to switch to ${selectedServerType.toUpperCase()} ${selectedMcVersion}? \n\nThis will RESTART the server.`;
    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('jwtToken');
      const payload = {
        version: selectedMcVersion,
        serverType: selectedServerType,
        forgeVersion: selectedServerType === 'forge' ? selectedForgeBuild : undefined
      };
      
      const response = await axios.post(apiUrl('/version/change'), payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(response.data.message);
      setShowVersionModal(false);
    } catch (error) {
      console.error("Error changing version:", error);
      showNotification("Error changing version: " + (error.response?.data?.error || error.message));
    }
    setLoading(false);
  };

  // Reset separate states when opening modal
  useEffect(() => {
    if (showVersionModal) {
      fetchVersions();
      setSelectedServerType('vanilla');
      setSelectedMcVersion('');
      setSelectedForgeBuild('');
      setAvailableForgeBuilds([]);
    }
  }, [showVersionModal]);

  // Fetch forge builds when MC version changes to a valid one, if type is Forge
  useEffect(() => {
    if (selectedServerType === 'forge' && selectedMcVersion) {
      fetchForgeBuilds(selectedMcVersion);
    }
  }, [selectedServerType, selectedMcVersion]);
  const resetServer = async () => {
    const confirmed = window.confirm(
      "⚠️ RESET SERVER\n\n" +
      "This will DELETE your world and start fresh.\n\n" +
      "Are you sure? This cannot be undone!"
    );
    
    if (!confirmed) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('jwtToken');
      const response = await axios.post(apiUrl('/server/reset'), {
        deleteWorld: true,
        deleteMods: false,
        deleteConfig: false
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showNotification(`✅ ${response.data.message}. Start the server to create a new world!`);
      await fetchStatus();
    } catch (error) {
      console.error("Error resetting server:", error);
      showNotification("Error resetting server: " + (error.response?.data?.error || error.message), { autoClose: 5000 });
    }
    setLoading(false);
  };

  // Global keydown handler: if Enter is pressed anywhere and the prompt isn't focused, focus it.
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Enter' && document.activeElement !== promptRef.current) {
        if (promptRef.current) {
          promptRef.current.focus();
        }
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  // Handler to refocus prompt when clicking the console and show notification on first click
  const handleConsoleClick = () => {
    if (firstConsoleClick.current) {
      showNotification("Press Enter to write commands!");
      firstConsoleClick.current = false;
    }
    
  };

  const handlePromptKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!promptLine.trim()) return;
      const newLine = `> ${promptLine}`;
      promptRef.current.textContent = "";

      setLogLines((prev) => {
        let newLogs = [...prev];
        if (newLogs.length === 1 && newLogs[0] === "No logs yet...") {
          newLogs = [];
        }
        return [...newLogs, newLine];
      });
      const token = localStorage.getItem('jwtToken');
      try {
        await axios.post(
          apiUrl('/command'),
          { command: promptLine },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        showNotification(`Command sent: ${promptLine}`);
      } catch (error) {
        console.error("Error sending command:", error);
        showNotification("Error sending command", { autoClose: 5000 });
      }
      setPromptLine("");
      if (promptRef.current) {
        promptRef.current.textContent = "";
        promptRef.current.focus();
      }
    }
  };

  const handlePromptInput = (e) => {
    setPromptLine(e.currentTarget.textContent);
  };

  // Logout handler: clears tokens and credentials, then sets logged-out state.
  const handleLogout = () => {
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('sftpCredentials');
    setIsLoggedIn(false);
    showNotification("Logged out successfully.");
  };

  const Spinner = () => (
    <div className="spinner">
      <div className="double-bounce1"></div>
      <div className="double-bounce2"></div>
    </div>
  );

  // Show loading spinner while checking auth
  if (isAuthChecking) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh', 
        background: '#000', 
        color: '#fff' 
      }}>
        <Spinner />
      </div>
    );
  }

  // If user is NOT logged in, show Login page.
  if (!isLoggedIn) {
    return (
      <div>
        <ToastContainer className="toast-container" theme="dark" />
        <Login onLogin={async () => {
          setIsLoggedIn(true);
        }} />
      </div>
    );
  }

  return (
    <div className="landing-container">
      <ToastContainer className="toast-container" theme="dark" />

      <header className="landing-header">
        <div className="logo-hunter">
          <img src={logo} alt="Hunter's Guild Logo" className="logo-img" />
          Hunter's Guild
        </div>
        <nav className="nav-links">
          <ul>
            <li><a href="#features">Features</a></li>
            <li><a href="#server-files">Server Files</a></li>
            <li><a href="#help">Help</a></li>
          </ul>
        </nav>
        {/* If logged in, show logout button instead of GET STARTED */}
        {isLoggedIn ? (
          <button className="get-started-btn" onClick={handleLogout}>
            LOGOUT
          </button>
        ) : (
          <a href="#get-started" className="get-started-btn">
            GET STARTED →
          </a>
        )}
      </header>

      <section className="hero-section" style={{position: 'relative', overflow: 'hidden'}}>
        {/* Interactive Background */}
        <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, opacity: 0.6}}>
            <HeroBanner />
        </div>
        
        <div className="hero-content" style={{position: 'relative', zIndex: 2}}>
          <h1>Welcome to Hunter's Guild</h1>
          <p className="hero-subtitle">
            Your exclusive control panel for our Hunter × Hunter Minecraft server.
            <br />
            Start the server and explore many features coming soon!
          </p>
          <div className="hero-buttons">
            <a href="#get-started" className="btn hero-cta">Get Started</a>
            <a href="#how-to-play" className="btn hero-secondary">How to use it?</a>
          </div>
          <div className="online-status">
            {publicIp ? (
              <div className="ip-card" onClick={() => {
                navigator.clipboard.writeText(publicIp);
                showNotification("IP Copied to Clipboard! 📋");
              }} title="Click to copy IP">
                <span className="ip-label">Server IP:</span>
                <span className="ip-address">{publicIp}</span>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchPublicIp();
                  }} 
                  disabled={ipLoading} 
                  className={`ip-refresh-btn ${ipLoading ? 'spinning' : ''}`}
                  title="Refresh Public IP"
                >
                  🔄
                </button>
              </div>
            ) : (
              <p className="private-access-text">Private Access – For Friends Only</p>
            )}
          </div>
        </div>
        <div className="hero-image" style={{position: 'relative', zIndex: 2}}>
          <img src={image} alt="Minecraft Characters" />
          <div className="particles">{particleElements}</div>
        </div>
      </section>

      {showModsModal && (
        <div className="mods-modal-overlay" onClick={() => setShowModsModal(false)}>
          <div className="mods-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setShowModsModal(false)}>×</button>
            <h3>📦 Mod Manager</h3>
            
            {/* Upload Section */}
            <div className="mod-upload-section">
              <label className="upload-btn">
                📤 Upload Mod (.jar)
                <input 
                  type="file" 
                  accept=".jar" 
                  hidden
                  onChange={(e) => {
                    if (e.target.files[0]) {
                      uploadMod(e.target.files[0]);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              <p className="upload-hint">Max 100MB per file</p>
            </div>
            
            <h4>Installed Mods ({modsList.length})</h4>
            {modsLoading ? (
              <p>Loading mods...</p>
            ) : (
              <ul className="mods-list">
                {modsList.length > 0 ? (
                  modsList.map((mod, index) => (
                    <li key={index} className="mod-item">
                      <span>📦 {mod.name}</span>
                      <span className="mod-size">({(mod.size / 1024 / 1024).toFixed(2)} MB)</span>
                      <button className="delete-mod-btn" onClick={() => deleteMod(mod.name)}>🗑️</button>
                    </li>
                  ))
                ) : (
                  <li className="no-mods">No mods installed. Upload some!</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {showVersionModal && (
        <div className="modal-overlay">
          <div className="modal-content version-modal">
            <button className="close-btn" onClick={() => setShowVersionModal(false)}>×</button>
            <h3>Server Identity</h3>
            
            <div className="version-steps">
              {/* Step 1: Server Type */}
              <div className="step-group">
                <label>1. Server Type</label>
                <div className="type-selector">
                  <div 
                    className={`type-card ${selectedServerType === 'vanilla' ? 'selected' : ''}`}
                    onClick={() => setSelectedServerType('vanilla')}
                  >
                    <span className="type-icon">🍦</span>
                    <span className="type-name">Vanilla</span>
                  </div>
                  <div 
                    className={`type-card ${selectedServerType === 'forge' ? 'selected' : ''}`}
                    onClick={() => setSelectedServerType('forge')}
                  >
                    <span className="type-icon">⚒️</span>
                    <span className="type-name">Forge</span>
                  </div>
                </div>
              </div>

              {/* Step 2: MC Version */}
              <div className="step-group">
                <label>2. Minecraft Version</label>
                <select 
                  value={selectedMcVersion} 
                  onChange={(e) => setSelectedMcVersion(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Select Version...</option>
                  {availableVersions.map(v => (
                    <option key={v.id} value={v.id}>{v.id} ({v.type})</option>
                  ))}
                </select>
              </div>

              {/* Step 3: Forge Build (Conditional) */}
              {selectedServerType === 'forge' && (
                <div className="step-group">
                  <label>3. Forge Build {selectedMcVersion ? `(for ${selectedMcVersion})` : ''}</label>
                  <select 
                    value={selectedForgeBuild} 
                    onChange={(e) => setSelectedForgeBuild(e.target.value)}
                    disabled={!selectedMcVersion || loading}
                  >
                    <option value="">Select Build...</option>
                    {availableForgeBuilds.map(b => (
                      <option key={b.id} value={b.id}>{b.type === 'recommended' ? '⭐ ' : ''}{b.id} ({b.type})</option>
                    ))}
                  </select>
                  {selectedMcVersion && availableForgeBuilds.length === 0 && !loading && (
                    <p className="hint-text warning">No Forge builds found for {selectedMcVersion}. Try another version.</p>
                  )}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button 
                className="btn primary-btn" 
                onClick={handleVersionChange}
                disabled={loading || !selectedMcVersion || (selectedServerType === 'forge' && !selectedForgeBuild)}
              >
                {loading ? 'Installing...' : 'Install & Restart'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPropertiesModal && (
        <ServerPropertiesEditor 
          onClose={() => setShowPropertiesModal(false)} 
          onTriggerRestart={restartServer}
        />
      )}

      <section className="server-control-section" id="get-started">
        <h2>Server Control Panel</h2>
        {loading && <Spinner />}
        <div className="server-status">
          <h3>Server Status</h3>
          <div className="status-details">
            {serverInfo ? (
              serverInfo.error ? (
                <p>{serverInfo.error}</p>
              ) : (
                <div className="status-badge-container">
                  <div className={`status-badge ${
                    serverAction !== 'idle' ? 'status-working' : 
                    serverInfo.running ? 'status-online' : 'status-offline'
                  }`}>
                    <span className="status-indicator">●</span>
                    <span className="status-text">
                      {serverAction === 'starting' ? 'Starting...' : 
                       serverAction === 'stopping' ? 'Stopping...' : 
                       serverAction === 'restarting' ? 'Restarting...' : 
                       serverInfo.running ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  
                  {serverInfo.running && (
                    <div className="status-meta">
                       <span>{serverInfo.config?.serverType ? serverInfo.config.serverType.toUpperCase() : 'SERVER'} {serverInfo.config?.mcVersion || 'Unknown'}</span>
                       {serverInfo.players && (
                         <>
                           <span>•</span>
                           <span>Players: {serverInfo.players.online}/{serverInfo.players.max}</span>
                         </>
                       )}
                       {serverInfo.uptime !== null && serverInfo.uptime !== undefined && (
                         <>
                           <span>•</span>
                           <span>Uptime: {Math.floor(serverInfo.uptime / 3600)}h {Math.floor((serverInfo.uptime % 3600) / 60)}m</span>
                         </>
                       )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <p>Loading status...</p>
            )}
          </div>

          <div className="server-controls">
             {/* Power Group */}
             <div className="control-group power-group">
               <h4>Power Controls</h4>
               <div className="group-buttons">
                 <button 
                   className="btn start-btn" 
                   onClick={startServer} 
                   disabled={loading || serverAction !== 'idle' || serverInfo?.running}
                 >
                   <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                     <path d="M4 2v12l10-6L4 2z"/>
                   </svg>
                   Start
                 </button>
                 <button 
                   className="btn stop-btn" 
                   onClick={stopServer} 
                   disabled={loading || serverAction !== 'idle' || !serverInfo?.running}
                 >
                   <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                     <path d="M3 3h10v10H3V3z"/>
                   </svg>
                   Stop
                 </button>
                 <button 
                   className="btn restart-btn" 
                   onClick={restartServer} 
                   disabled={loading || serverAction !== 'idle' || !serverInfo?.running}
                 >
                   <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                     <path d="M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 5.5-5.5V1L11 3.5 8 6V4.5a3.5 3.5 0 1 0 3.5 3.5h2z"/>
                   </svg>
                   Restart
                 </button>
                 <button 
                   className="btn kill-btn" 
                   onClick={killServer} 
                   disabled={loading || serverAction !== 'idle' || !serverInfo?.running}
                   title="Force Kill (Danger)"
                   style={{backgroundColor: '#8b0000', color: '#fff'}}
                 >
                   <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                     <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
                     <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                   </svg>
                   Force Stop
                 </button>
               </div>
             </div>
          </div>

          {/* Group 2: Management Controls */}
          <div className="control-group management-group">
            <h4>Management</h4>
            <div className="group-buttons">
              <button 
                className="btn mods-btn" 
                onClick={openModsModal} 
                disabled={loading || serverAction !== 'idle' || (serverInfo && serverInfo.running)}
                title={serverInfo && serverInfo.running ? "Stop server to manage mods" : "Manage server mods"}
              >
               <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                 <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11zM3 3h10v2H3V3zm0 4h10v6H3V7z"/>
                 <path d="M5 9h2v2H5V9zm4 0h2v2H9V9z"/>
               </svg>
               Mods
             </button>
             <button 
               className="btn version-btn" 
               onClick={() => setShowVersionModal(true)} 
               disabled={loading || serverAction !== 'idle' || (serverInfo && serverInfo.running)}
               title={serverInfo && serverInfo.running ? "Stop server to change version" : "Change server version"}
             >
               <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                 <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
               </svg>
               Version
             </button>
             <button 
               className="btn settings-btn" 
               onClick={() => setShowPropertiesModal(true)} 
               disabled={loading || serverAction !== 'idle'}
               title="Edit server.properties"
             >
               <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                 <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h5.086a1.5 1.5 0 0 1 1.06.44l3.915 3.914A1.5 1.5 0 0 1 14 7.414V12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zM3.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7.414a.5.5 0 0 0-.146-.353L8.94 3.146A.5.5 0 0 0 8.586 3H3.5z"/>
                 <path d="M5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z"/>
               </svg>
               Settings
             </button>
           </div>
          </div>

          {/* Group 3: Maintenance Controls */}
          <div className="control-group maintenance-group">
            <h4>Maintenance</h4>
            <div className="group-buttons">
              <button 
                className="btn backup-btn" 
                onClick={triggerBackup} 
                disabled={loading || serverAction !== 'idle' || paramServerOffline(serverInfo)}
                title={paramServerOffline(serverInfo) ? "Start server to backup" : "Backup world data"}
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                  <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h5.793a1.5 1.5 0 0 1 1.061.44l2.207 2.206a1.5 1.5 0 0 1 .439 1.061V12.5A1.5 1.5 0 0 1 11.5 14h-8A1.5 1.5 0 0 1 2 12.5v-10zm1.5-.5a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V4.707a.5.5 0 0 0-.146-.353L9.146 2.146A.5.5 0 0 0 8.793 2H3.5z"/>
                  <path d="M5 6h6v1H5V6zm0 3h6v1H5V9zm0 3h3v1H5v-1z"/>
                </svg>
                Backup
              </button>
              <button 
                className="btn reset-btn" 
                onClick={resetServer} 
                disabled={loading || serverAction !== 'idle' || (serverInfo && serverInfo.running)}
                title={serverInfo && serverInfo.running ? "Stop server to reset" : "Reset world/mods"}
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '8px', verticalAlign: 'middle', display: 'inline-block'}}>
                  <path d="M8.5 1.5A5.5 5.5 0 0 0 3.09 5H1.5a.5.5 0 0 0-.39.812l2 2.5a.5.5 0 0 0 .78 0l2-2.5A.5.5 0 0 0 5.5 5H4.09a4.5 4.5 0 1 1 .5 5.27.5.5 0 0 0-.71.71A5.5 5.5 0 1 0 8.5 1.5z"/>
                  <path d="M8 5v3.5l2.5 1.5.5-.87-2-1.19V5H8z"/>
                </svg>
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="console-log">
          <h3>Console Log</h3>
          <div className="log-display" ref={logContainerRef} onClick={handleConsoleClick}>
            {logLines.map((line, idx) => (
              <div key={idx} className="log-line">{line}</div>
            ))}
            <div 
              className="prompt-line" 
              ref={promptRef} 
              contentEditable="true" 
              dir="ltr" 
              onKeyDown={handlePromptKeyDown} 
              onInput={handlePromptInput}
              style={{ outline: 'none' }}
            />
          </div>
        </div>

        <div className="player-management">
          <h3>Player Management</h3>
          {serverInfo && serverInfo.players && serverInfo.players.sample && serverInfo.players.sample.length > 0 ? (
            <ul>
              {serverInfo.players.sample.map((p) => (
                <li key={p.id}>
                  {p.name} 
                  <button 
                    className="btn kick-btn"
                    onClick={() => {
                        if(window.confirm(`Kick ${p.name}?`)) {
                            // Call kick API
                            axios.post(apiUrl('/kick'), { playerName: p.name }, { 
                                headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } 
                            }).then(() => showNotification(`Kicked ${p.name}`))
                              .catch(err => showNotification('Failed to kick: ' + err.message));
                        }
                    }}
                  >
                    Kick
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{color: '#888', fontStyle: 'italic'}}>No players online.</p>
          )}
        </div>
      </section>

      <section className="sftp-credntials-section" id="server-files">
        {<ServerFilesView credentials={sftpCredentials} />}
      </section>

      <section className="connect-section">
        <h2>CONNECT WITH THE GUILD</h2>
        <p className="connect-subtitle">Join your fellow hunters and share your passion for gaming.</p>
        <div className="avatars-container">
          <img src={require('../assets/avatar1.png')} alt="Avatar 1" />
          <img src={require('../assets/avatar2.png')} alt="Avatar 2" />
          <img src={require('../assets/avatar3.png')} alt="Avatar 3" />
        </div>
      </section>

      <footer className="landing-footer">
        <p>© 2025 Hunter's Guild. All rights reserved. | v1.2 (Updated {new Date().toLocaleTimeString()})</p>
      </footer>
    </div>
  );
}

export default LandingPage;
