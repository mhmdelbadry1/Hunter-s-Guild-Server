#!/bin/bash

# Check if docker is installed
if ! [ -x "$(command -v docker)" ]; then
  echo 'Error: docker is not installed.' >&2
  echo 'Please install docker first:'
  echo 'curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh'
  exit 1
fi

echo "Starting Hunter's Guild Minecraft Platform..."
docker-compose up -d

echo "----------------------------------------------------"
echo "Platform is starting in the background!"
echo "Access the panel at: http://localhost"
echo "----------------------------------------------------"
