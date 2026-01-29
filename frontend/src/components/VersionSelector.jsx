import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { apiUrl } from '../config/api';
import '../styles/VersionSelector.css';

function VersionSelector({ onClose }) {
  const [versions, setVersions] = useState([]);
  const [serverTypes, setServerTypes] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedType, setSelectedType] = useState('forge');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchVersions();
  }, []);

  const fetchVersions = async () => {
    try {
      const token = localStorage.getItem('jwtToken');
      const response = await axios.get(apiUrl('/versions'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      setVersions(response.data.versions || []);
      setServerTypes(response.data.serverTypes || ['vanilla', 'forge']);
      if (response.data.versions?.length > 0) {
        setSelectedVersion(response.data.versions[0].id);
      }
    } catch (err) {
      setError('Failed to load versions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!selectedVersion) return;
    
    if (!window.confirm(`Switch to ${selectedType.toUpperCase()} ${selectedVersion}?\n\nThis will stop the current server, download the new version, and restart.`)) {
      return;
    }
    
    setApplying(true);
    try {
      const token = localStorage.getItem('jwtToken');
      const response = await axios.post(apiUrl('/version/change'), {
        version: selectedVersion,
        serverType: selectedType
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Close modal and show success
      onClose();
      
      // The API returns a message about what's happening
      window.alert(`✅ ${response.data.message}\n\nThe server is being recreated with the new version. Check the console logs for progress.`);
    } catch (err) {
      setError('Failed to apply version change: ' + (err.response?.data?.error || err.message));
      console.error(err);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="version-modal-overlay" onClick={onClose}>
      <div className="version-modal" onClick={e => e.stopPropagation()}>
        <button className="close-modal" onClick={onClose}>×</button>
        <h3>🎮 Server Version</h3>
        
        {loading ? (
          <div className="loading">Loading versions...</div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : (
          <>
            <div className="form-group">
              <label>Server Type</label>
              <div className="type-buttons">
                {serverTypes.map(type => (
                  <button
                    key={type}
                    className={`type-btn ${selectedType === type ? 'active' : ''}`}
                    onClick={() => setSelectedType(type)}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Minecraft Version</label>
              <select
                value={selectedVersion}
                onChange={e => setSelectedVersion(e.target.value)}
                className="version-select"
              >
                {versions.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn cancel-btn" onClick={onClose}>
                Cancel
              </button>
              <button 
                className="btn apply-btn" 
                onClick={handleApply}
                disabled={applying}
              >
                {applying ? 'Applying...' : 'Apply & Restart'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default VersionSelector;
