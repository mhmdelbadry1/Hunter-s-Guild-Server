import React, { useEffect, useState } from "react";
import axios from "axios";
import { CopyToClipboard } from "react-copy-to-clipboard";
import blockImg from "../assets/minecraft-blocks.png"; // Image for the random block background
import { apiUrl } from "../config/api";

// SVG Icons
const DeleteIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ verticalAlign: "middle" }}
  >
    <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
  </svg>
);

const WarningIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 16 16"
    fill="#ef4444"
    style={{ display: "block", margin: "0 auto 16px" }}
  >
    <path d="M7.56 1h.88l6.54 12.26-.44.74H1.44l-.42-.74L7.56 1zm.44 1.7L2.38 13H13.6L8 2.7zM8.5 11.5v-1h-1v1h1zm-.06-2l.2-4h-1.3l.2 4h.9z" />
  </svg>
);

const FolderIcon = ({ open }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ marginRight: "6px", verticalAlign: "middle" }}
  >
    {open ? (
      <path d="M.5 3l.5.5.5-.5L1 2.5l-.5-.5-.5.5.5.5zm1 .5L1 3v10l.5.5h13l.5-.5v-8l-.5-.5h-7l-1-1h-5zm.5 1h4.293L7.5 5.707l.707.293H14v7.5H2V4.5z" />
    ) : (
      <path d="M1.5 1h4l1 1h7l.5.5v10l-.5.5h-13l-.5-.5v-11l.5-.5zM2 2v10h12V3H7.5l-1-1H2z" />
    )}
  </svg>
);

const FileIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ marginRight: "6px", verticalAlign: "middle" }}
  >
    <path d="M13.5 1h-10l-.5.5v13l.5.5h10l.5-.5v-13l-.5-.5zM13 14H4V2h9v12zM6 4h5v1H6V4zm0 2h5v1H6V6zm0 2h5v1H6V8zm0 2h3v1H6v-1z" />
  </svg>
);

// ----------------------------------
// Delete Confirmation Modal
// ----------------------------------
function DeleteConfirmModal({ isOpen, filePath, fileName, isDirectory, onConfirm, onCancel }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const token = localStorage.getItem("jwtToken");
      await axios.post(
        apiUrl("/files/delete"),
        { path: filePath, password },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPassword("");
      onConfirm();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="delete-modal-overlay" onClick={onCancel}>
      <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
        <button className="delete-modal-close" onClick={onCancel}>
          <DeleteIcon />
        </button>
        
        <WarningIcon />
        
        <h2>Confirm Delete</h2>
        <p className="delete-modal-file">
          {isDirectory ? "📁" : "📄"} <strong>{fileName}</strong>
        </p>
        <p className="delete-modal-warning">
          {isDirectory 
            ? "This will permanently delete this folder and ALL its contents."
            : "This will permanently delete this file."}
        </p>
        
        <form onSubmit={handleSubmit}>
          <label className="delete-modal-label">Enter password to confirm:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="delete-modal-input"
            placeholder="Password"
            autoFocus
          />
          
          {error && <p className="delete-modal-error">{error}</p>}
          
          <div className="delete-modal-buttons">
            <button 
              type="button" 
              onClick={onCancel} 
              className="delete-modal-cancel"
              disabled={loading}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="delete-modal-confirm"
              disabled={loading || !password}
            >
              {loading ? "Deleting..." : "Delete"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------
// Helper Component for Rendering Files & Directories
// ----------------------------------
function FileNode({ node, parentPath = "", onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const toggleExpanded = () => setExpanded(!expanded);
  
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    setShowDeleteModal(false);
    if (onDelete) onDelete();
  };

  if (node.type === "directory") {
    return (
      <li>
        <div className="file-node-row">
          <span
            onClick={toggleExpanded}
            className="directory-name"
            style={{ cursor: "pointer", userSelect: "none", flex: 1 }}
          >
            <FolderIcon open={expanded} /> {node.name}
          </span>
          <button 
            className="delete-btn" 
            onClick={handleDeleteClick}
            title={`Delete ${node.name}`}
          >
            <DeleteIcon />
          </button>
        </div>
        {expanded && node.children && (
          <ul className="directory-children">
            {node.children.map((child, idx) => (
              <FileNode key={idx} node={child} parentPath={fullPath} onDelete={onDelete} />
            ))}
          </ul>
        )}
        <DeleteConfirmModal
          isOpen={showDeleteModal}
          filePath={fullPath}
          fileName={node.name}
          isDirectory={true}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteModal(false)}
        />
      </li>
    );
  } else {
    return (
      <li>
        <div className="file-node-row">
          <span className="file-name" style={{ flex: 1 }}>
            <FileIcon /> {node.name}
          </span>
          <button 
            className="delete-btn" 
            onClick={handleDeleteClick}
            title={`Delete ${node.name}`}
          >
            <DeleteIcon />
          </button>
        </div>
        <DeleteConfirmModal
          isOpen={showDeleteModal}
          filePath={fullPath}
          fileName={node.name}
          isDirectory={false}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteModal(false)}
        />
      </li>
    );
  }
}

const CopyIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ marginRight: "4px", verticalAlign: "middle" }}
  >
    <path d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z" />
    <path d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ marginRight: "4px", verticalAlign: "middle" }}
  >
    <path d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z" />
  </svg>
);

// ----------------------------------
// Modern Copy Button using react-copy-to-clipboard
// ----------------------------------
function ModernCopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <CopyToClipboard text={text} onCopy={onCopy}>
      <button className="copy-button">
        {copied ? (
          <>
            <CheckIcon /> Copied
          </>
        ) : (
          <>
            <CopyIcon /> Copy
          </>
        )}
      </button>
    </CopyToClipboard>
  );
}

const DocumentIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ marginRight: "6px", verticalAlign: "middle" }}
  >
    <path d="M9 1H4L3 2v12l1 1h8l1-1V5L9 1zM8.5 5.5L12 9H9l-.5-.5V5.5zM4 13V2h4v3.5l.5.5H12v7H4z" />
  </svg>
);

const DownloadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ marginRight: "6px", verticalAlign: "middle" }}
  >
    <path d="M13 9v4H3V9H2v4.5l.5.5h11l.5-.5V9h-1z" />
    <path d="M7 10.5l3.5-3.5H9V1H7v6H5.5L9 10.5z" />
  </svg>
);

// ----------------------------------
// SFTPCredentials Component with Modal Copy (password hidden until modal open)
// ----------------------------------
function SFTPCredentials({ credentials }) {
  const [showModal, setShowModal] = useState(false);
  const [blocks, setBlocks] = useState([]);

  // Generate decorative blocks once on mount
  useEffect(() => {
    const generatedBlocks = Array.from({ length: 40 }).map(() => ({
      top: Math.random() * 100,
      left: Math.random() * 100,
      rotation: Math.random() * 360,
      size: 15 + Math.random() * 30,
    }));
    setBlocks(generatedBlocks);
  }, []);

  if (!credentials) return null;

  return (
    <div className="sftp-credentials-container">
      <div className="block-background">
        {blocks.map((block, idx) => (
          <img
            key={idx}
            src={blockImg}
            alt=""
            className="block-image"
            style={{
              top: `${block.top}%`,
              left: `${block.left}%`,
              width: `${block.size}px`,
              height: `${block.size}px`,
              transform: `rotate(${block.rotation}deg)`,
              opacity: 0.6,
            }}
          />
        ))}
      </div>

      <div className="sftp-credentials-content">
        <h3>SFTP Credentials</h3>
        <p>
          <strong>Host:</strong> {credentials.host}
        </p>
        <p>
          <strong>User:</strong> {credentials.username}
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="view-credentials-btn"
        >
          <DocumentIcon /> View Credentials
        </button>
      </div>

      {showModal && (
        <div className="sftp-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sftp-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-modal-btn"
              onClick={() => setShowModal(false)}
            >
              ×
            </button>
            <h2>Full SFTP Credentials</h2>
            <p>
              <strong>Host:</strong> {credentials.host}{" "}
              <ModernCopyButton text={credentials.host} />
            </p>
            <p>
              <strong>User:</strong> {credentials.username}{" "}
              <ModernCopyButton text={credentials.username} />
            </p>
            <p>
              <strong>Password:</strong> {credentials.password}{" "}
              <ModernCopyButton text={credentials.password} />
            </p>
            <button
              onClick={() => {
                const blob = new Blob([credentials.privateKey], {
                  type: "text/plain",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "sftp_private_key";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="download-key-btn"
            >
              <DownloadIcon /> Download Private Key
            </button>
            <div className="tutorial">
              <h3>How to Use FileZilla</h3>
              <ol>
                <li>Open FileZilla and go to Site Manager.</li>
                <li>
                  Create a new site with Protocol: <strong>SFTP</strong>, Host:{" "}
                  <strong>{credentials.host}</strong>, Port: 22.
                </li>
                <li>
                  Enter Username: <strong>{credentials.username}</strong>.
                </li>
                <li>
                  Select the downloaded private key file for authentication.
                </li>
                <li>Connect and manage your files.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------
// Main ServerFilesView Component
// ----------------------------------
function ServerFilesView({ credentials }) {
  const [dirTree, setDirTree] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDirectory();
  }, []);

  const fetchDirectory = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("jwtToken");
      const res = await axios.get(apiUrl("/dir"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const sortedTree = sortDirectoryTree(res.data.directory || []);
      setDirTree(sortedTree);
    } catch (error) {
      console.error("Error fetching directory:", error);
      // Suppress alert for 401 as the main app will handle logout
      if (error.response && error.response.status === 401) {
        return;
      }
      alert("Failed to fetch directory");
    } finally {
      setLoading(false);
    }
  };

  const sortDirectoryTree = (tree) => {
    tree.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    tree.forEach((node) => {
      if (node.type === "directory" && node.children) {
        sortDirectoryTree(node.children);
      }
    });
    return tree;
  };

  return (
    <div className="server-files-view">
      <h2>Server Files</h2>
      <SFTPCredentials credentials={credentials} />
      {loading ? (
        <p>Loading directory...</p>
      ) : (
        <ul>
          {dirTree.map((node, idx) => (
            <FileNode key={idx} node={node} onDelete={fetchDirectory} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default ServerFilesView;
