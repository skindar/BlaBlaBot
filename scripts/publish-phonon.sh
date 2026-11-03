#!/usr/bin/env bash
# Publish the Phonon 40M German model files as GitHub Release assets.
# The model is NOT stored in git (see .gitignore): the app downloads it into
# the browser on first use of Phonon speech and caches it in the Cache API.
#
# Usage:
#   ./scripts/publish-phonon.sh owner/repo [tag]
# Example:
#   ./scripts/publish-phonon.sh skindar/german-tutor-web phonon-40m-de-v1
#
# After publishing, paste this base URL into the app settings
# ("Phonon model URL") — the script prints it at the end.
# Weights are licensed CC BY-NC 4.0 (huggingface.co/gradium/phonon-40m-de):
# redistribution must credit the source.

set -euo pipefail

REPO=${1:?usage: ./publish-phonon.sh owner/repo [tag]}
TAG=${2:-phonon-40m-de-v1}
DIR="$(cd "$(dirname "$0")/.." && pwd)/public/models/phonon-40m-de"

if [ ! -f "$DIR/model.q8.gguf" ]; then
  echo "Model files not found in $DIR" >&2
  echo "Download them from https://huggingface.co/gradium/phonon-40m-de (a HF account" >&2
  echo "with accepted terms is required): config.json, tokenizer.json, model.q8.gguf," >&2
  echo "plus German voices from gradium/phonon-voices." >&2
  exit 1
fi

command -v gh >/dev/null || { echo "GitHub CLI required: brew install gh && gh auth login" >&2; exit 1; }

echo "→ uploading release assets to $REPO:$TAG"
gh release create "$TAG" --repo "$REPO" --title "$TAG" \
  --notes "Phonon 40M German TTS — weights CC BY-NC 4.0, source: huggingface.co/gradium/phonon-40m-de, voices: gradium/phonon-voices" \
  "$DIR/config.json" \
  "$DIR/tokenizer.json" \
  "$DIR/model.q8.gguf" \
  "$DIR"/voice-*.safetensors

BASE="https://github.com/$REPO/releases/download/$TAG/"
echo
echo "Done. Set this as the model URL in the app settings:"
echo "  $BASE"
