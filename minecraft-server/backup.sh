#!/bin/bash
# Backup script for Minecraft world

BACKUP_DIR="/backups"
WORLD_DIR="/server/world"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="world_backup_${TIMESTAMP}.tar.gz"

echo "Creating backup: ${BACKUP_NAME}"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Create compressed backup
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}" -C /server world

echo "Backup completed: ${BACKUP_DIR}/${BACKUP_NAME}"

# Optional: Keep only last 7 backups
cd "${BACKUP_DIR}"
ls -t world_backup_*.tar.gz | tail -n +8 | xargs -r rm

echo "Backup rotation completed"
