import React, { useState, useEffect } from "react";
import axios from "axios";
import { apiUrl } from "../config/api";
import "../styles/ModpackManager.css";

function ModpackManager() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem("jwtToken");
      const res = await axios.get(apiUrl("/modpack/status"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatus(res.data);
    } catch (err) {
      setError("Failed to load modpack status");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const token = localStorage.getItem("jwtToken");
      const res = await axios.post(
        apiUrl("/modpack/generate"),
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      
      alert(`✅ Modpack Generated Successfully!\n\n📦 ${res.data.modCount} mods packaged\n🎮 Minecraft ${res.data.mcVersion}\n🔧 Forge ${res.data.forgeVersion}\n\nShare the pack URL with your players so they can auto-sync mods!`);
      fetchStatus();
    } catch (err) {
      const userMessage = err.response?.data?.userMessage || err.response?.data?.error || "Failed to generate modpack";
      setError(userMessage);
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (loading) {
    return <div className="modpack-manager loading">Loading...</div>;
  }

  const canGenerate = status?.canGenerate;
  const isForge = status?.isForge;

  return (
    <div className="modpack-manager">
      <h2>🎮 Modpack Distribution</h2>
      <p className="description">
        Generate a modpack so your players can automatically download and sync all server mods
      </p>

      {error && <div className="error-message">❌ {error}</div>}

      {!isForge && (
        <div className="warning-message">
          ⚠️ This feature is only available for Forge servers. Your server is currently running <strong>{status?.serverType || 'Vanilla'}</strong>.
        </div>
      )}

      {isForge && status?.modCount === 0 && (
        <div className="warning-message">
          ⚠️ No mods found in your server. Please add at least one mod (.jar file) to the mods folder before generating a modpack.
        </div>
      )}

      <div className="status-card">
        <h3>Current Status</h3>
        <div className="status-grid">
          <div className="status-item">
            <span className="label">Server Type:</span>
            <span className="value">{status?.serverType || 'Unknown'}</span>
          </div>
          <div className="status-item">
            <span className="label">Mods Found:</span>
            <span className="value">{status?.modCount || 0}</span>
          </div>
          <div className="status-item">
            <span className="label">Last Updated:</span>
            <span className="value">{formatDate(status?.lastGenerated)}</span>
          </div>
          <div className="status-item">
            <span className="label">Pack Status:</span>
            <span className={`value ${status?.exists ? 'success' : 'warning'}`}>
              {status?.exists ? '✅ Ready for Players' : '⚠️ Not Generated'}
            </span>
          </div>
        </div>

        {status?.exists && status?.packUrl && (
          <div className="pack-url">
            <span className="label">📋 Share this URL with players:</span>
            <input 
              type="text" 
              value={status.packUrl} 
              readOnly 
              onClick={(e) => e.target.select()}
              title="Click to select all"
            />
            <small>Players can import this in Prism Launcher → Add Instance → Import from zip</small>
          </div>
        )}
      </div>

      <div className="actions">
        <button
          className="btn generate-btn"
          onClick={handleGenerate}
          disabled={generating || !canGenerate}
          title={!canGenerate ? "Requires Forge server with at least 1 mod" : "Generate modpack for players"}
        >
          {generating ? "🔄 Generating..." : "🔄 Generate Modpack"}
        </button>
        {!canGenerate && isForge && status?.modCount === 0 && (
          <p className="hint">Add mods to your server first, then click generate</p>
        )}
        {!isForge && (
          <p className="hint">Switch to a Forge server to use this feature</p>
        )}
      </div>

      <div className="help-section">
        <h3>📚 How Players Use This</h3>
        <ol>
          <li>You click "Generate Modpack" after adding/updating mods on your server</li>
          <li>Copy the pack URL and share it with your players (Discord, etc.)</li>
          <li>Players open Prism Launcher → Add Instance → Import from zip</li>
          <li>They paste your URL and Prism automatically downloads all mods</li>
          <li>When you update mods, regenerate and players can update their instance</li>
        </ol>
        <p className="note">💡 <strong>Tip:</strong> Regenerate after every mod change to keep players in sync!</p>
      </div>
    </div>
  );
}

export default ModpackManager;
