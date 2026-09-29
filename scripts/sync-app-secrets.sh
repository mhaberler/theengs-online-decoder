#!/usr/bin/env bash
# Push the app-signing secrets from local files/env into a GitHub repo's
# Actions secrets (personal accounts have no account-wide secrets, so each
# consuming repo gets its own copy). Values are read from the environment and
# piped to `gh secret set`; nothing is echoed.
#
# Usage:
#   ASC_KEY_PATH=~/.secrets.d/AuthKey_XXXX.p8 ASC_KEY_ID=XXXX ASC_ISSUER_ID=… \
#   ANDROID_KEYSTORE_PATH=~/.secrets.d/mah-upload-key.keystore \
#   ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=… \
#   scripts/sync-app-secrets.sh [--repo owner/name] [--ios-only|--android-only]
#
# Without --repo, the current directory's GitHub repo is used.
set -euo pipefail

repo=() ios=1 android=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo=(--repo "$2"); shift 2 ;;
    --ios-only) android=0; shift ;;
    --android-only) ios=0; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

need() {
  for v in "$@"; do
    [[ -n "${!v:-}" ]] || { echo "missing env var: $v" >&2; exit 2; }
  done
}

set_secret() { gh secret set "$1" "${repo[@]}" --body "$2" >/dev/null && echo "set $1"; }

if (( ios )); then
  need ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID
  set_secret ASC_KEY_P8 "$(base64 < "${ASC_KEY_PATH/#\~/$HOME}" | tr -d '\n')"
  set_secret ASC_KEY_ID "$ASC_KEY_ID"
  set_secret ASC_ISSUER_ID "$ASC_ISSUER_ID"
fi

if (( android )); then
  need ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
  set_secret ANDROID_KEYSTORE "$(base64 < "${ANDROID_KEYSTORE_PATH/#\~/$HOME}" | tr -d '\n')"
  set_secret ANDROID_KEYSTORE_PASSWORD "$ANDROID_KEYSTORE_PASSWORD"
  set_secret ANDROID_KEY_ALIAS "$ANDROID_KEY_ALIAS"
  set_secret ANDROID_KEY_PASSWORD "$ANDROID_KEY_PASSWORD"
fi
