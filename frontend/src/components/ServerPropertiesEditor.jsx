import React, { useState, useEffect } from "react";
import axios from "axios";
import { apiUrl } from "../config/api";
import "../styles/VersionSelector.css"; // Reuse modal styles from VersionSelector

function ServerPropertiesEditor({ onClose, onTriggerRestart }) {
  const [properties, setProperties] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchProperties();
  }, []);

  const fetchProperties = async () => {
    try {
      const token = localStorage.getItem("jwtToken");
      const res = await axios.get(apiUrl("/server-properties"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProperties(res.data.properties || {});
    } catch (err) {
      setError("Failed to load server properties");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("jwtToken");
      await axios.put(
        apiUrl("/server-properties"),
        {
          properties,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      // Prompt for restart
      if (
        window.confirm(
          "✅ Settings saved! Do you want to restart the server now to apply changes?",
        )
      ) {
        if (onTriggerRestart) {
          onTriggerRestart();
        }
        onClose();
      } else {
        onClose();
      }
    } catch (err) {
      setError("Failed to save settings");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => {
    setProperties((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Helper to render input field
  const renderField = (key, label, type = "text", options = null) => {
    const value = properties[key] || "";

    return (
      <div className="form-group" key={key}>
        <label>
          {label} <span className="prop-key">({key})</span>
        </label>
        {options ? (
          <select
            value={value}
            onChange={(e) => handleChange(key, e.target.value)}
            className="version-select"
          >
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : type === "boolean" ? (
          <select
            value={value}
            onChange={(e) => handleChange(key, e.target.value)}
            className="version-select"
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => handleChange(key, e.target.value)}
            className="prop-input"
            placeholder={label}
          />
        )}
      </div>
    );
  };

  if (loading) return null;

  return (
    <div className="version-modal-overlay" onClick={onClose}>
      <div
        className="version-modal properties-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close-modal" onClick={onClose}>
          ×
        </button>
        <h3>⚙️ Server Settings</h3>

        {error && <div className="error">{error}</div>}

        <div className="properties-form">
          {/* General Settings */}
          <h4 className="section-title">General</h4>
          {renderField("motd", "Message of the Day (Server Name)")}
          {renderField("max-players", "Max Players", "number")}
          {renderField("level-seed", "World Seed")}

          {/* Gameplay */}
          <h4 className="section-title">Gameplay</h4>
          {renderField("gamemode", "Default Gamemode", "select", [
            "survival",
            "creative",
            "adventure",
            "spectator",
          ])}
          {renderField("difficulty", "Difficulty", "select", [
            "peaceful",
            "easy",
            "normal",
            "hard",
          ])}
          {renderField("pvp", "PvP", "boolean")}
          {renderField("allow-flight", "Allow Flight", "boolean")}
          {renderField("hardcore", "Hardcore Mode", "boolean")}

          {/* Advanced / Others */}
          <h4 className="section-title">Advanced</h4>
          {renderField(
            "online-mode",
            "Online Mode (Cracked/Premium)",
            "boolean",
          )}
          {renderField(
            "enforce-secure-profile",
            "Enforce Secure Profile (Require Signed Account)",
            "boolean",
          )}
          {renderField(
            "enable-command-block",
            "Enable Command Blocks",
            "boolean",
          )}
          {renderField("view-distance", "View Distance", "number")}
        </div>

        <div className="modal-actions">
          <button className="btn cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn apply-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "💾 Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ServerPropertiesEditor;
