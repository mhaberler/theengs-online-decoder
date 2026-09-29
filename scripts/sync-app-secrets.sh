#!/usr/bin/env bash
# Push the app-signing secrets from local files/env into a GitHub repo's
# Actions secrets (personal accounts have no account-wide secrets, so each
# consuming repo gets its own copy). Values are read from the environment and
# piped to `gh secret set`; nothing is echoed.
#
# Usage:
#   scripts/sync-app-secrets.sh --env-file .env     # vars as in .env.example
# or
#   ASC_KEY_PATH=~/.secrets.d/AuthKey_XXXX.p8 ASC_KEY_ID=XXXX ASC_ISSUER_ID=… \
#   ANDROID_KEYSTORE_PATH=~/.secrets.d/mah-upload-key.keystore \
#   ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=… \
#   scripts/sync-app-secrets.sh [--repo owner/name] [--ios-only|--android-only]
#                               [--env-file FILE]...
#
# --env-file reads KEY=value files literally (e.g. this repo's .env, see
# .env.example); their values win over the shell environment. fastlane-style names are accepted as fallbacks:
# FASTLANE_KEY_PATH/FASTLANE_KEY_ID/FASTLANE_ISSUER_ID for the ASC_* vars and
# ANDROID_KEYSTORE_ALIAS_PASSWORD for ANDROID_KEY_PASSWORD.
# Without --repo, the current directory's GitHub repo is used.
set -euo pipefail

# KEY=value lines, read literally (no shell expansion, so passwords may hold
# $ or spaces; one pair of surrounding quotes is stripped). An explicit env
# file wins over variables already exported in the shell.
load_env() {
  [[ -r "$1" ]] || { echo "cannot read env file: $1" >&2; exit 2; }
  local key value
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    key="${key//[[:space:]]/}"
    [[ -z "$key" || "$key" == \#* ]] && continue
    [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]] && value="${BASH_REMATCH[1]}"
    export "$key=$value"
  done < "$1"
}

repo=() ios=1 android=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo=(--repo "$2"); shift 2 ;;
    --ios-only) android=0; shift ;;
    --android-only) ios=0; shift ;;
    --env-file) load_env "${2/#\~/$HOME}"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

: "${ASC_KEY_PATH:=${FASTLANE_KEY_PATH:-}}"
: "${ASC_KEY_ID:=${FASTLANE_KEY_ID:-}}"
: "${ASC_ISSUER_ID:=${FASTLANE_ISSUER_ID:-}}"
: "${ANDROID_KEY_PASSWORD:=${ANDROID_KEYSTORE_ALIAS_PASSWORD:-}}"

need() {
  for v in "$@"; do
    [[ -n "${!v:-}" ]] || { echo "missing env var: $v" >&2; exit 2; }
  done
}

need_file() {
  [[ -r "${1/#\~/$HOME}" && -s "${1/#\~/$HOME}" ]] || { echo "not a readable file: $1" >&2; exit 2; }
}

# An empty --body makes gh prompt interactively; refuse instead.
set_secret() {
  [[ -n "$2" ]] || { echo "empty value for $1" >&2; exit 2; }
  gh secret set "$1" "${repo[@]}" --body "$2" >/dev/null && echo "set $1"
}

if (( ios )); then
  need ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID
  need_file "$ASC_KEY_PATH"
  grep -q -- '-----BEGIN PRIVATE KEY-----' "${ASC_KEY_PATH/#\~/$HOME}" \
    || { echo "ASC_KEY_PATH is not an App Store Connect .p8 key: $ASC_KEY_PATH" >&2; exit 2; }
  set_secret ASC_KEY_P8 "$(base64 < "${ASC_KEY_PATH/#\~/$HOME}" | tr -d '\n')"
  set_secret ASC_KEY_ID "$ASC_KEY_ID"
  set_secret ASC_ISSUER_ID "$ASC_ISSUER_ID"
fi

if (( android )); then
  need ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
  need_file "$ANDROID_KEYSTORE_PATH"
  set_secret ANDROID_KEYSTORE "$(base64 < "${ANDROID_KEYSTORE_PATH/#\~/$HOME}" | tr -d '\n')"
  set_secret ANDROID_KEYSTORE_PASSWORD "$ANDROID_KEYSTORE_PASSWORD"
  set_secret ANDROID_KEY_ALIAS "$ANDROID_KEY_ALIAS"
  set_secret ANDROID_KEY_PASSWORD "$ANDROID_KEY_PASSWORD"
fi
