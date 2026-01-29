#!/bin/bash
# Cleanup old non-Docker files
# Run this AFTER verifying Docker setup works

echo "=========================================="
echo "  Cleanup Old Files Script"
echo "=========================================="
echo ""

# Files to remove
OLD_FILES=(
    "forge-1.21.8-58.1.0-installer.jar"
    "forge-1.21.8-58.1.0-installer.jar.log"
    "forge-1.21.8-58.1.0-shim.jar"
    "server.jar"
    "run.bat"
    "run.sh"
    "start-mc.sh"
    "user_jvm_args.txt"
    "README.txt"
    "backup_minecraft.sh"
    "backup.log"
)

# Directories to remove
OLD_DIRS=(
    "libraries"
    "minecraft-api"
    "crash-reports"
    "logs"
    "patchouli_books"
    "lost+found"
    "defaultconfigs"
)

echo "Files to delete:"
for f in "${OLD_FILES[@]}"; do
    if [ -f "$f" ]; then
        echo "  - $f"
    fi
done

echo ""
echo "Directories to delete:"
for d in "${OLD_DIRS[@]}"; do
    if [ -d "$d" ]; then
        echo "  - $d/"
    fi
done

echo ""
read -p "Delete these files? (y/N): " confirm

if [ "$confirm" == "y" ] || [ "$confirm" == "Y" ]; then
    for f in "${OLD_FILES[@]}"; do
        if [ -f "$f" ]; then
            rm -f "$f"
            echo "Deleted: $f"
        fi
    done
    
    for d in "${OLD_DIRS[@]}"; do
        if [ -d "$d" ]; then
            rm -rf "$d"
            echo "Deleted: $d/"
        fi
    done
    
    echo ""
    echo "✅ Cleanup complete!"
else
    echo "Cleanup cancelled."
fi
