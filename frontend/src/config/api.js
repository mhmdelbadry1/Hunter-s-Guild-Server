// API Configuration
// Uses runtime config if available (Docker), falls back to env vars (dev), then relative URLs

const getApiUrl = () => {
  // Check for runtime config (injected by docker-entrypoint.sh)
  if (typeof window !== 'undefined' && window.RUNTIME_CONFIG?.API_URL) {
    return window.RUNTIME_CONFIG.API_URL;
  }
  
  // Check for env var (development mode)
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  
  // Legacy support for old env var names
  if (process.env.REACT_APP_VM_API_URL) {
    return process.env.REACT_APP_VM_API_URL;
  }
  
  // Default: relative URL (works with reverse proxy)
  return '/api';
};

export const API_BASE_URL = getApiUrl();

// Remove /api suffix if present (some endpoints need it, some don't)
export const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '');

// Helper to build API URLs
export const apiUrl = (path) => {
  const base = API_BASE_URL.endsWith('/api') ? API_BASE_URL : `${API_BASE_URL}/api`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

export default API_BASE_URL;
