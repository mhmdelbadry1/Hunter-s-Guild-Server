#!/bin/bash
# Minecraft Server Backup Script for Docker
# Creates timestamped backups and optionally syncs to cloud

set -e

BACKUP_DIR="/backups"
WORLD_DIR="/server/world"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="${BACKUP_DIR}/world_${TIMESTAMP}.tar.gz"

echo "[Backup] Starting backup at $(date)"

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

# Create backup
echo "[Backup] Compressing world..."
tar -czf "$BACKUP_FILE" -C /server world

echo "[Backup] Created: $BACKUP_FILE"

# Keep only most recent backups
KEEP=${BACKUP_KEEP_LOCAL:-4}
echo "[Backup] Cleaning old backups (keeping $KEEP most recent)..."
ls -t ${BACKUP_DIR}/world_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm

# Sync to Google Drive if configured
if [ -n "${GDRIVE_REMOTE}" ] && command -v rclone &> /dev/null; then
    echo "[Backup] Syncing to Google Drive..."
    rclone sync "$BACKUP_DIR" "${GDRIVE_REMOTE}:${GDRIVE_FOLDER:-minecraft-backups}" \
        --transfers 1 \
        --checkers 1 \
        -v
    echo "[Backup] Cloud sync complete."
fi

echo "[Backup] Backup completed at $(date)"
