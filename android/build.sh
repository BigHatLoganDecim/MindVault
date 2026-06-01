#!/usr/bin/env bash
# Build MindVault APK from sources.
# Requires: openjdk-11-jdk-headless, android-sdk + android-sdk-build-tools + android-sdk-platform-23, apksigner, zipalign, aapt, dx.jar (from Maven Central).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_SRC="$(dirname "$ROOT")"
BUILD="$ROOT/build"
AJAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
DXJAR="${DX_JAR:-/opt/dex/dx.jar}"
JC="${JAVAC:-/usr/lib/jvm/java-11-openjdk-amd64/bin/javac}"

rm -rf "$BUILD" && mkdir -p "$BUILD/obj" "$BUILD/assets"

# Copy PWA assets into the APK assets dir
cp "$ASSETS_SRC"/{index.html,manifest.json,sw.js,icon-192.png,icon-512.png} "$BUILD/assets/"

echo "[1/6] Generate R.java"
aapt package -f -m -M "$ROOT/AndroidManifest.xml" -S "$ROOT/res" -I "$AJAR" -J "$ROOT/src"

echo "[2/6] Compile Java -> .class (target 1.6 for dx 1.7 compat)"
"$JC" -d "$BUILD/obj" -bootclasspath "$AJAR" -classpath "$AJAR" -source 1.6 -target 1.6 \
  "$ROOT"/src/com/mindvault/app/*.java

echo "[3/6] Dex"
java -cp "$DXJAR" com.android.dx.command.Main --dex --output="$BUILD/classes.dex" "$BUILD/obj"

echo "[4/6] Package APK"
aapt package -f -M "$ROOT/AndroidManifest.xml" -S "$ROOT/res" -A "$BUILD/assets" \
  -I "$AJAR" -F "$BUILD/app.unsigned.apk"
( cd "$BUILD" && aapt add app.unsigned.apk classes.dex >/dev/null )

echo "[5/6] Zipalign"
zipalign -f 4 "$BUILD/app.unsigned.apk" "$BUILD/app.aligned.apk"

echo "[6/6] Sign"
if [ ! -f "$BUILD/debug.keystore" ]; then
  keytool -genkeypair -keystore "$BUILD/debug.keystore" -storepass android \
    -alias androiddebug -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=MindVault Debug,O=MindVault,C=RU"
fi
apksigner sign --ks "$BUILD/debug.keystore" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebug --out "$ROOT/MindVault.apk" "$BUILD/app.aligned.apk"

echo "Done: $ROOT/MindVault.apk"
ls -la "$ROOT/MindVault.apk"