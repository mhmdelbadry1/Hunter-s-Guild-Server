import React, { useState, useEffect } from "react";
import axios from "axios";
import { apiUrl } from "../config/api";
import Toast from "./Toast";
import "../styles/ModpackManager.css";

function ModpackManager({ onClose }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem("jwtToken");
      const res = await axios.get(apiUrl("/modpack/status"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log("Modpack status:", res.data);
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
    setSuccessMessage(null);
    
    const startTime = Date.now();
    const MIN_LOADING_TIME = 2000; // 2 seconds minimum for better UX
    
    try {
      const token = localStorage.getItem("jwtToken");
      const res = await axios.post(
        apiUrl("/modpack/generate"),
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      
      // Calculate remaining time to reach minimum loading duration
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsedTime);
      
      // Wait for remaining time before showing success
      await new Promise(resolve => setTimeout(resolve, remainingTime));
      
      setSuccessMessage({
        modCount: res.data.modCount,
        mcVersion: res.data.mcVersion,
        forgeVersion: res.data.forgeVersion,
        packUrl: res.data.packUrl
      });
      
      // Refresh status after showing success
      setTimeout(() => {
        fetchStatus();
      }, 500);
    } catch (err) {
      // Still wait minimum time even on error for consistent UX
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsedTime);
      await new Promise(resolve => setTimeout(resolve, remainingTime));
      
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

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  if (loading) {
    return <div className="modpack-manager loading">Loading...</div>;
  }

  const canGenerate = status?.canGenerate;
  const isForge = status?.isForge;
  
  // Check if modpack is valid (exists AND has mods currently)
  const hasModsNow = status?.modCount > 0;
  const packExists = status?.exists;
  const isPackValid = packExists && hasModsNow;
  const isPackOutdated = packExists && !hasModsNow;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modpack-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-section">
            <h2>🎮 Modpack Distribution</h2>
            <p className="modal-subtitle">
              Sync mods with your players automatically
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading...</p>
            </div>
          ) : (
            <>
              {/* Success Message */}
              {successMessage && (
                <div className="success-banner">
                  <div className="success-icon">✅</div>
                  <div className="success-content">
                    <h3>Modpack Generated Successfully!</h3>
                    <div className="success-details">
                      <span>📦 {successMessage.modCount} mods</span>
                      <span>•</span>
                      <span>🎮 Minecraft {successMessage.mcVersion}</span>
                      <span>•</span>
                      <span>🔧 Forge {successMessage.forgeVersion}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="error-banner">
                  <div className="error-icon">❌</div>
                  <div className="error-content">
                    <p>{error}</p>
                  </div>
                </div>
              )}

              {/* Warning Messages */}
              {!isForge && (
                <div className="warning-banner">
                  <div className="warning-icon">⚠️</div>
                  <div className="warning-content">
                    <strong>Forge Server Required</strong>
                    <p>This feature is only available for Forge servers. Your server is currently running <strong>{status?.serverType || 'Vanilla'}</strong>.</p>
                  </div>
                </div>
              )}

              {isForge && status?.modCount === 0 && !isPackOutdated && (
                <div className="warning-banner">
                  <div className="warning-icon">⚠️</div>
                  <div className="warning-content">
                    <strong>No Mods Found</strong>
                    <p>Please add at least one mod (.jar file) to the mods folder before generating a modpack.</p>
                  </div>
                </div>
              )}

              {/* Pack Outdated Warning */}
              {isPackOutdated && (
                <div className="error-banner">
                  <div className="error-icon">🚫</div>
                  <div className="error-content">
                    <strong>Modpack is Invalid</strong>
                    <p>The mods folder is now empty. The previously generated modpack is no longer valid. Add mods and regenerate.</p>
                  </div>
                </div>
              )}

              {/* Status Cards */}
              <div className="status-cards">
                <div className="status-card-item">
                  <div className="status-icon">🖥️</div>
                  <div className="status-info">
                    <span className="status-label">Server Type</span>
                    <span className="status-value">{status?.serverType || 'Unknown'}</span>
                  </div>
                </div>

                <div className="status-card-item">
                  <div className="status-icon">📦</div>
                  <div className="status-info">
                    <span className="status-label">Mods Found</span>
                    <span className="status-value">{status?.modCount || 0}</span>
                  </div>
                </div>

                <div className="status-card-item">
                  <div className="status-icon">🕒</div>
                  <div className="status-info">
                    <span className="status-label">Last Updated</span>
                    <span className="status-value">{formatDate(status?.lastGenerated)}</span>
                  </div>
                </div>

                <div className="status-card-item">
                  <div className={`status-icon ${isPackValid ? 'status-ready' : 'status-pending'}`}>
                    {isPackValid ? '✅' : isPackOutdated ? '🚫' : '⏳'}
                  </div>
                  <div className="status-info">
                    <span className="status-label">Pack Status</span>
                    <span className={`status-value ${isPackValid ? 'text-success' : isPackOutdated ? 'text-error' : 'text-warning'}`}>
                      {isPackValid ? 'Ready for Players' : isPackOutdated ? 'Invalid (No Mods)' : 'Not Generated'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pack Download Section - Only show if pack is VALID */}
              {isPackValid && (
                <div className="pack-url-section">
                  <h3>📦 Download Modpack</h3>
                  <p className="pack-url-hint">Download the .mrpack file to import in Prism Launcher. Mods download from Modrinth CDN (fast!) when available.</p>
                  <div className="download-button-group">
                    <a 
                      href="/modpack/download"
                      download
                      className="download-btn-primary"
                    >
                      <span className="download-icon">⬇️</span>
                      Download .mrpack
                    </a>
                    <p className="download-help-text">
                      In Prism Launcher: <strong>Add Instance → Import → Select the downloaded .mrpack file</strong>
                    </p>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div className="modal-actions">
                <button
                  className={`generate-btn ${!canGenerate || generating ? 'disabled' : ''}`}
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                >
                  {generating ? (
                    <>
                      <span className="btn-spinner"></span>
                      Generating...
                    </>
                  ) : (
                    <>
                      <span className="btn-icon">🔄</span>
                      Generate Modpack
                    </>
                  )}
                </button>
                
                {!canGenerate && isForge && status?.modCount === 0 && (
                  <p className="action-hint">Add mods to your server first</p>
                )}
                {!isForge && (
                  <p className="action-hint">Switch to a Forge server to use this feature</p>
                )}
              </div>

              {/* Help Section */}
              <div className="help-section">
                <h3>📚 How Players Use This</h3>
                <ol className="help-steps">
                  <li>
                    <span className="step-number">1</span>
                    <span>Click "Generate Modpack" after adding/updating server mods</span>
                  </li>
                  <li>
                    <span className="step-number">2</span>
                    <span>Copy and share the pack URL with your players</span>
                  </li>
                  <li>
                    <span className="step-number">3</span>
                    <span>Players open Prism Launcher → Add Instance → Import from zip</span>
                  </li>
                  <li>
                    <span className="step-number">4</span>
                    <span>They paste your URL and Prism downloads all mods automatically</span>
                  </li>
                  <li>
                    <span className="step-number">5</span>
                    <span>Regenerate after every mod change to keep everyone in sync</span>
                  </li>
                </ol>
                <div className="help-tip">
                  <span className="tip-icon">💡</span>
                  <span><strong>Tip:</strong> Always regenerate after adding or removing mods!</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default ModpackManager;
