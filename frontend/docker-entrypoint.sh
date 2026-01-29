#!/bin/sh
# Docker entrypoint for frontend
# Injects runtime environment variables into the app

# Create runtime config file
cat > /usr/share/nginx/html/config.js << EOF
window.RUNTIME_CONFIG = {
  API_URL: "${REACT_APP_API_URL:-/api}"
};
EOF

# Start nginx
exec "$@"
