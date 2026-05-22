#!/bin/bash
set -e  # Exit on unhandled errors

if [ -z "$VIRTUAL_ENV_PROMPT" ] && [ -f ~/esphome-env/bin/activate ]; then
  source ~/esphome-env/bin/activate
fi

CONFIGS=(
  # "window-motor-test-1"
  "window-motor-bed1-left"
  "window-motor-bed1-right"
  "window-motor-lr-right"
  "window-motor-lr-left"
)

# Determine which configs to process
if [[ "$#" -eq 0 ]]; then
  SELECTED_CONFIGS=("${CONFIGS[0]}")
elif [[ "$1" == "all" ]]; then
  SELECTED_CONFIGS=("${CONFIGS[@]}")
else
  SELECTED_CONFIGS=("$@")
fi

# Compile and upload each config
for config_full in "${SELECTED_CONFIGS[@]}"; do
  config="${config_full%.yaml}" # Remove the .yaml extension if present
  echo "🔧 Compiling: $config.yaml"
  if ! esphome compile "$config.yaml"; then
    echo "❌ Compile failed for $config.yaml"
    exit 1
  fi

  echo "📤 Uploading: $config.yaml to ${config}.local."
  if ! esphome upload "$config.yaml" --device "${config}.local."; then
    echo "❌ Upload failed for $config.yaml"
    exit 1
  fi

  echo "✅ Success: $config"
done
