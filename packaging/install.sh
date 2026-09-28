#!/bin/sh
# Download a selected release and invoke its exact archive verifier. No sudo,
# shell profile changes, mutable latest lookup, or direct tar extraction.
set -eu
version='' destination='' source='' prefix='' app_dir='' expected=''
apply=false
usage() {
  cat <<'HELP'
Usage: sh install.sh --release VERSION --download-to NEW_DIRECTORY
       [--from LOCAL_ARTIFACT_DIRECTORY] [--prefix ABS_PATH] [--app-dir ABS_PATH]
       [--apply --expected PREVIEW_IDENTITY]
Default: verify selected download bytes and show the install preview.
Reuse a complete download directory to apply that exact preview. Partial or
changed downloads refuse; choose a fresh directory after inspecting them.
A checksum beside an artifact is integrity evidence, not an independent signer.
HELP
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0;;
    --apply) apply=true; shift;;
    --release|--download-to|--from|--prefix|--app-dir|--expected)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      case "$1" in
        --release) version=$2;; --download-to) destination=$2;; --from) source=$2;;
        --prefix) prefix=$2;; --app-dir) app_dir=$2;; --expected) expected=$2;;
      esac; shift 2;;
    *) usage >&2; exit 2;;
  esac
done
[ -n "$version" ] && [ -n "$destination" ] || { usage >&2; exit 2; }
case "$version" in *[!a-zA-Z0-9.-]*|.*|*..*|*-|*.) echo 'Invalid release version' >&2; exit 2;; esac
printf '%s\n' "$version" | LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$' || { echo 'Select an exact release version' >&2; exit 2; }
case "$destination" in /*) ;; *) echo 'Use an absolute download directory' >&2; exit 2;; esac
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64;; Linux-x86_64) platform=linux-x64;;
  *) echo 'This distribution has no measured target for this platform' >&2; exit 2;;
esac
binary="wring-$version-$platform"
archive="wringer-$version-$platform.tar.gz"
base="https://github.com/marcoakes/wringer/releases/download/v$version"
parent=$(dirname "$destination")
[ "$(cd -P "$parent" && pwd -P)" = "$parent" ] || { echo 'Use a canonical download parent without symlink aliases' >&2; exit 2; }
links() { if [ "$platform" = darwin-arm64 ]; then stat -f '%l' "$1"; else stat -c '%h' "$1"; fi; }
size() { if [ "$platform" = darwin-arm64 ]; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi; }
if [ ! -e "$destination" ]; then
  umask 077
  mkdir "$destination"
  printf '%s %s\n' "$version" "$platform" > "$destination/WRINGER-DOWNLOAD"
  for name in "$binary" "$binary.sha256" "$archive" "$archive.sha256"; do
    if [ -n "$source" ]; then
      [ -f "$source/$name" ] && [ ! -L "$source/$name" ] || { echo 'Missing regular local release asset' >&2; exit 2; }
      [ "$(size "$source/$name")" -le 268435456 ] || { echo 'Local release asset exceeds download limit' >&2; exit 2; }
      cp "$source/$name" "$destination/$name"
    else
      curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
        --tlsv1.2 --connect-timeout 15 --max-time 300 --max-filesize 268435456 \
        "$base/$name" --output "$destination/$name"
    fi
  done
fi
[ -d "$destination" ] && [ ! -L "$destination" ] || { echo 'Download destination must be a real directory' >&2; exit 2; }
[ -f "$destination/WRINGER-DOWNLOAD" ] && [ ! -L "$destination/WRINGER-DOWNLOAD" ] && [ "$(links "$destination/WRINGER-DOWNLOAD")" -eq 1 ] && [ "$(size "$destination/WRINGER-DOWNLOAD")" -le 256 ] && [ "$(cat "$destination/WRINGER-DOWNLOAD")" = "$version $platform" ] || { echo 'This directory is not the selected owned download' >&2; exit 2; }
# Exact checksum file syntax; never treat an untrusted filename as a checksum command.
checksum() {
  artifact=$1
  [ -f "$destination/$artifact" ] && [ ! -L "$destination/$artifact" ] &&
  [ -f "$destination/$artifact.sha256" ] && [ ! -L "$destination/$artifact.sha256" ] || {
    echo 'Download is incomplete or contains a link' >&2; exit 2;
  }
  [ "$(links "$destination/$artifact")" -eq 1 ] && [ "$(links "$destination/$artifact.sha256")" -eq 1 ] && [ "$(size "$destination/$artifact")" -le 268435456 ] || { echo 'Release asset ownership or size differs' >&2; exit 2; }
  [ "$(wc -c < "$destination/$artifact.sha256" | tr -d ' ')" -le 256 ] || { echo 'Oversized checksum' >&2; exit 2; }
  line=$(cat "$destination/$artifact.sha256")
  wanted=${line%%  *}
  [ "${#wanted}" -eq 64 ] && [ "$line" = "$wanted  $artifact" ] || { echo 'Invalid checksum declaration' >&2; exit 2; }
  case "$wanted" in *[!a-f0-9]*) echo 'Invalid SHA-256' >&2; exit 2;; esac
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$destination/$artifact"); actual=${actual%% *}
  else
    actual=$(shasum -a 256 "$destination/$artifact"); actual=${actual%% *}
  fi
  [ "$actual" = "$wanted" ] || { echo 'Release asset checksum mismatch; nothing executed' >&2; exit 2; }
  printf '%s' "$wanted"
}
checksum "$binary" >/dev/null
archive_hash=$(checksum "$archive")
chmod 700 "$destination/$binary"
set -- install --archive "$destination/$archive" --sha256 "$archive_hash" --release "$version"
[ -z "$prefix" ] || set -- "$@" --prefix "$prefix"
[ -z "$app_dir" ] || set -- "$@" --app-dir "$app_dir"
if [ "$apply" = true ]; then
  [ -n "$expected" ] || { echo '--apply requires the reviewed --expected identity' >&2; exit 2; }
  set -- "$@" --apply --expected "$expected"
else
  [ -z "$expected" ] || { echo '--expected is only used with --apply' >&2; exit 2; }
  set -- "$@" --dry-run --json
fi
exec "$destination/$binary" "$@"
