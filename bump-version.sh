#!/usr/bin/env bash
# Usage: ./bump-version.sh 1.1.0 "What's new"
# Updates every place the version lives so installed copies pick up the update over the air.
set -euo pipefail
v="${1:?version required}"; notes="${2:-Update}"
sed -i "s/^const VERSION = '.*';/const VERSION = '$v';/" sw.js
sed -i "s/^const APP_VERSION = '.*';/const APP_VERSION = '$v';/" app.js
printf '{ "version": "%s", "notes": "%s" }\n' "$v" "$notes" > version.json
echo "Bumped to $v"
# keep the Android wrapper's version in step (versionName = version, versionCode + 1)
G=android/app/build.gradle.kts
CODE=$(grep -oP 'versionCode = \K[0-9]+' "$G")
sed -i "s/versionCode = [0-9]*/versionCode = $((CODE + 1))/; s/versionName = \".*\"/versionName = \"$v\"/" "$G"
