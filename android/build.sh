#!/usr/bin/env bash
# Build MindVault APK from sources.
#
# Dependencies:
#   openjdk-17-jdk  (or 11)
#   Android SDK with: platforms/android-33  and  build-tools/33.0.2
#   (Install via Android Studio SDK Manager or sdkmanager CLI)
#
# Environment variables:
#   ANDROID_SDK   — path to Android SDK root  (default: ~/Android/Sdk)
#   KEYSTORE      — path to release .jks file  (default: auto-generated debug key)
#   KEYSTORE_ALIAS — key alias  (default: androiddebug)
#   KEYSTORE_PASS  — store + key password  (default: android)
#
# Release signing example:
#   First, create a keystore once:
#     keytool -genkeypair -keystore release.jks -storepass YOUR_PASS \
#       -alias mindvault -keypass YOUR_PASS -keyalg RSA -keysize 2048 \
#       -validity 36500 -dname "CN=MindVault,O=YourName,C=RU"
#   Then build:
#     KEYSTORE=release.jks KEYSTORE_ALIAS=mindvault KEYSTORE_PASS=YOUR_PASS ./build.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_SRC="$(dirname "$ROOT")"
BUILD="$ROOT/build"

ANDROID_SDK="${ANDROID_SDK:-$HOME/Android/Sdk}"
PLATFORM="$ANDROID_SDK/platforms/android-33/android.jar"
BT="$ANDROID_SDK/build-tools/33.0.2"

KEYSTORE="${KEYSTORE:-}"
KEYSTORE_ALIAS="${KEYSTORE_ALIAS:-androiddebug}"
KEYSTORE_PASS="${KEYSTORE_PASS:-android}"

rm -rf "$BUILD" && mkdir -p "$BUILD/obj" "$BUILD/assets"

# Copy PWA assets into the APK asset bundle
cp "$ASSETS_SRC"/{index.html,manifest.json,sw.js,icon-192.png,icon-512.png} "$BUILD/assets/"

echo "[1/6] Generate R.java"
"$BT/aapt" package -f -m \
  -M "$ROOT/AndroidManifest.xml" \
  -S "$ROOT/res" \
  -I "$PLATFORM" \
  -J "$ROOT/src"

echo "[2/6] Compile Java -> .class"
javac -d "$BUILD/obj" \
  -bootclasspath "$PLATFORM" \
  -classpath "$PLATFORM" \
  -source 8 -target 8 \
  "$ROOT"/src/com/mindvault/app/*.java

echo "[3/6] Convert to DEX (d8)"
"$BT/d8" \
  --classpath "$PLATFORM" \
  --output "$BUILD" \
  "$BUILD/obj/com/mindvault/app/"*.class

echo "[4/6] Package APK"
"$BT/aapt" package -f \
  -M "$ROOT/AndroidManifest.xml" \
  -S "$ROOT/res" \
  -A "$BUILD/assets" \
  -I "$PLATFORM" \
  -F "$BUILD/app.unsigned.apk"
( cd "$BUILD" && "$BT/aapt" add app.unsigned.apk classes.dex >/dev/null )

echo "[5/6] Zipalign"
"$BT/zipalign" -f 4 "$BUILD/app.unsigned.apk" "$BUILD/app.aligned.apk"

echo "[6/6] Sign"
if [ -z "$KEYSTORE" ]; then
  KEYSTORE="$BUILD/debug.keystore"
  if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair -keystore "$KEYSTORE" -storepass android \
      -alias androiddebug -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=MindVault Debug,O=MindVault,C=RU"
  fi
  KEYSTORE_ALIAS="androiddebug"
  KEYSTORE_PASS="android"
  echo "  (DEBUG key — не подходит для публикации в магазин)"
fi

"$BT/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:$KEYSTORE_PASS" \
  --key-pass "pass:$KEYSTORE_PASS" \
  --ks-key-alias "$KEYSTORE_ALIAS" \
  --out "$ROOT/MindVault.apk" \
  "$BUILD/app.aligned.apk"

echo "Done: $ROOT/MindVault.apk"
ls -la "$ROOT/MindVault.apk"
