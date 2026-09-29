# Building and signing Sensor-BLE

How to build the Sensor-BLE mobile app ([app/](app/)) locally, and how to produce
signed release builds — IPA for iOS (TestFlight / App Store), APK and AAB for
Android — with the GitHub Actions workflow
[.github/workflows/app-release.yml](.github/workflows/app-release.yml).

No fastlane, no certificate repository: iOS uses Xcode's automatic
**cloud-managed signing** driven by an App Store Connect API key; Android uses
plain Gradle with an upload keystore.

- [Overview](#overview)
- [Identifiers used by this app](#identifiers-used-by-this-app)
- [Local development builds](#local-development-builds)
- [One-time setup: Apple / iOS](#one-time-setup-apple--ios)
- [One-time setup: Android](#one-time-setup-android)
- [One-time setup: GitHub secrets](#one-time-setup-github-secrets)
- [Building releases in CI](#building-releases-in-ci)
- [Versioning](#versioning)
- [Installing and distributing the builds](#installing-and-distributing-the-builds)
- [Rotating and revoking credentials](#rotating-and-revoking-credentials)
- [Troubleshooting](#troubleshooting)
- [Reference: files and secrets](#reference-files-and-secrets)

## Overview

```
 your Mac                         GitHub                          Apple / Google
 ────────                         ──────                          ──────────────
 .env (gitignored)                Actions secrets
   ASC_KEY_* ─┐                     ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID
   ANDROID_* ─┴─ sync-app-secrets ─► ANDROID_KEYSTORE, …PASSWORD, …ALIAS
                  (gh secret set)            │
                                             ▼
                                  app-release.yml
                                   ├─ android (ubuntu): gradle assembleRelease
                                   │    bundleRelease, signed with the keystore ──► APK, AAB
                                   └─ ios (macos): xcodebuild archive (unsigned)
                                        → -exportArchive -allowProvisioningUpdates
                                          + API key ──── cloud signing ──────────► IPA
                                          (tags: second export uploads) ─────────► TestFlight
```

| Trigger | What you get |
|---|---|
| **Run workflow** (manual dispatch) | IPA + APK + AAB as workflow artifacts. No upload. |
| push tag `app-v<version>` | IPA uploaded to TestFlight; IPA + APK + AAB attached to a GitHub Release for the tag. |

App tags use the `app-v` prefix so they don't collide with the web/library
release tags (`v*`), which deploy GitHub Pages.

## Identifiers used by this app

| What | Value | Where it's set |
|---|---|---|
| Bundle ID / application ID | `com.haberler.sensorble` | [app/capacitor.config.json](app/capacitor.config.json), Xcode project, `app/android/app/build.gradle` |
| App name | `Sensor-BLE` | `capacitor.config.json` |
| Apple Developer Team ID | `HLX9TTSLFS` | `DEVELOPMENT_TEAM` in `app/ios/App/App.xcodeproj/project.pbxproj`, `teamID` in [app/ci/ExportOptions-*.plist](app/ci/) |

The Team ID is not secret. To look yours up: <https://developer.apple.com/account>
→ **Membership details** → Team ID. If you fork this for another team, change it
in both places above.

## Local development builds

Prerequisites: [bun](https://bun.sh), Xcode (iOS), Android Studio or the
Android SDK + JDK 21 (Android). iOS builds need a real device — Bluetooth is not
available in the simulator.

```sh
bun install                 # repo root: sensor-ble and jsonata live here
cd app && bun install
bun run sync                # vite build + cap sync (copies web assets into ios/ and android/)
bun run run-android         # build, install and launch on the configured Android device
bun run run-ios             # same for the configured iPhone
bun run debug-android       # / debug-ios: live reload from the vite dev server
bun run open-ios            # open in Xcode      bun run open-android: Android Studio
```

The `run-*` scripts pass `--target` device IDs from [app/package.json](app/package.json).
List yours with `bunx cap run android --list` / `bunx cap run ios --list` and
edit the scripts.

Local iOS builds use **automatic signing with your Xcode account** (Xcode →
Settings → Accounts) and a development certificate — no API key needed. If
`cap run ios` fails with *"Signing for App requires a development team"*,
the `DEVELOPMENT_TEAM` in the Xcode project is missing or not a team your
Xcode account belongs to.

Local Android release builds are unsigned unless the `ANDROID_KEYSTORE_*`
variables are set (see [Android](#one-time-setup-android)); debug builds are
always signed with the SDK's debug key.

## One-time setup: Apple / iOS

You need a paid Apple Developer Program membership. Steps 1–2 are done once per
app, step 3 once per team (the key can be shared by all your apps and repos).

### 1. Register the App ID (bundle ID)

Optional — automatic signing registers it on the first CI export — but the App
Store Connect app record (step 2) needs it in its dropdown, so doing it by hand
first is simplest.

1. <https://developer.apple.com/account/resources/identifiers/list> →
   **Identifiers** → **+**.
2. **App IDs** → Continue → type **App** → Continue.
3. Description: `Sensor-BLE`. Bundle ID: **Explicit**, `com.haberler.sensorble`.
4. **Capabilities: leave all unchecked.** The app needs none:
   - Bluetooth LE scanning needs only the `NSBluetoothAlwaysUsageDescription`
     string in `Info.plist` (already present); there is no Bluetooth capability.
   - Preferences is plain UserDefaults; decoder downloads are plain HTTPS.
   - Background scanning (not used) would be the `bluetooth-central`
     background mode — an `Info.plist` setting, not an App ID capability.
5. Continue → Register.

### 2. Create the App Store Connect app record

Required for TestFlight uploads. The API cannot create apps, so this is manual.

1. <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**.
2. Platform **iOS**, Name `Sensor-BLE` (must be unique on the App Store — pick
   another if taken; it's only the store name), primary language, Bundle ID
   `com.haberler.sensorble` (from step 1), SKU e.g. `sensorble`, User Access
   **Full Access**.
3. Create.

Export compliance: `Info.plist` sets `ITSAppUsesNonExemptEncryption = false`
(the app only uses HTTPS), so TestFlight builds don't stop at the encryption
questionnaire.

### 3. Create an App Store Connect API key (Admin)

This key lets CI sign and upload without an Apple ID password or 2FA.

1. You must be the **Account Holder** or an **Admin**. In App Store Connect →
   **Users and Access** → **Integrations** → **App Store Connect API** →
   **Team Keys**. (The first time, request access / accept the terms.)
2. **Generate API Key** (**+**). Name: e.g. `ci`. Access: **Admin**.
   - **It must be Admin.** Only Admin keys may use cloud-managed distribution
     certificates. An App Manager key fails export with
     *"Cloud signing permission error"*. A key's role can't be changed later —
     generate a new one.
3. **Download API Key** → `AuthKey_<KEYID>.p8`. **Apple lets you download it
   only once.** Store it outside any repo, e.g. `~/.secrets.d/AuthKey_<KEYID>.p8`,
   `chmod 600`.
4. Note the two IDs on the page:
   - **Key ID** — 10 characters, in the key's row (also in the file name).
   - **Issuer ID** — a UUID shown above the keys table (same for all keys of the team).

What you end up with, for `.env`:

```sh
ASC_KEY_PATH=~/.secrets.d/AuthKey_ABCDE12345.p8
ASC_KEY_ID=ABCDE12345
ASC_ISSUER_ID=69a6de7e-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

(The fastlane names `FASTLANE_KEY_PATH`, `FASTLANE_KEY_ID`,
`FASTLANE_ISSUER_ID` are accepted as fallbacks, so an existing fastlane setup
works as is.)

### How cloud signing works here

- CI builds the archive **unsigned** (`CODE_SIGNING_ALLOWED=NO`). Signing at
  archive time would make Xcode create a new *development* certificate on
  every fresh runner.
- `xcodebuild -exportArchive -allowProvisioningUpdates` with the API key then
  signs for **App Store Connect distribution**: Xcode registers the bundle ID
  if needed, creates/downloads the App Store provisioning profile, and signs
  with Apple's **cloud-managed distribution certificate** — its private key
  never leaves Apple, so there is nothing to store, export or renew.
- Export options: [app/ci/ExportOptions-export.plist](app/ci/ExportOptions-export.plist)
  (write an `.ipa`) and [app/ci/ExportOptions-upload.plist](app/ci/ExportOptions-upload.plist)
  (upload to App Store Connect). Both: `method = app-store-connect`,
  `signingStyle = automatic`, `teamID`.

## One-time setup: Android

### 1. Upload keystore

You need one keystore holding a key that signs the release builds. If you
already have an upload keystore (e.g. from another app — one upload key can be
used for several apps), reuse it. Otherwise create one:

```sh
mkdir -p ~/.secrets.d && chmod 700 ~/.secrets.d
keytool -genkeypair -v \
  -keystore ~/.secrets.d/upload-key.keystore \
  -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Your Name, O=Your Org, C=AT"
# prompts for the keystore password (and the key password — use the same one)
chmod 600 ~/.secrets.d/upload-key.keystore
```

Check it (lists the alias and the certificate fingerprints):

```sh
keytool -list -v -keystore ~/.secrets.d/upload-key.keystore
```

**Back up the keystore and its passwords.** For sideloaded APKs, losing it
means users must uninstall before they can install an update signed with a new
key. With Google Play App Signing the upload key can be reset via Play Console
support, but it's a slow process.

What you end up with, for `.env`:

```sh
ANDROID_KEYSTORE_PATH=~/.secrets.d/upload-key.keystore
ANDROID_KEYSTORE_PASSWORD=…
ANDROID_KEY_ALIAS=upload
ANDROID_KEY_PASSWORD=…          # same as the store password if you used one
```

(`ANDROID_KEYSTORE_ALIAS_PASSWORD` is accepted as a fallback for
`ANDROID_KEY_PASSWORD`.)

### 2. How the Gradle signing works

[app/android/app/build.gradle](app/android/app/build.gradle) defines
`signingConfigs.release` from the environment:

- `ANDROID_KEYSTORE_PATH` (or `-PreleaseKeystore=…`) → `storeFile`
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

When no keystore is set, the release build type simply isn't signed, so local
`assembleRelease` still works. A signed local release build:

```sh
cd app && bun run build && bunx cap sync android
cd android
ANDROID_KEYSTORE_PATH=~/.secrets.d/upload-key.keystore \
ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=upload ANDROID_KEY_PASSWORD=… \
  ./gradlew assembleRelease bundleRelease -PversionCode=1 -PversionName=0.1.0
# → app/build/outputs/apk/release/app-release.apk
#   app/build/outputs/bundle/release/app-release.aab
```

Verify the signature: `$ANDROID_HOME/build-tools/<ver>/apksigner verify --print-certs app-release.apk`.

### 3. Google Play (optional)

The workflow builds the AAB but doesn't upload it. To publish on Play:
create the app in [Play Console](https://play.google.com/console) (package
`com.haberler.sensorble`), enrol in **Play App Signing** (default for new
apps — Google holds the app signing key, your keystore is the *upload* key),
and upload the AAB from a release to a testing track.

## One-time setup: GitHub secrets

Personal GitHub accounts have no account-wide secrets, so each repo gets its
own copy. [scripts/sync-app-secrets.sh](scripts/sync-app-secrets.sh) pushes
them with `gh secret set` — values are piped, never printed.

1. Install and log in to the [GitHub CLI](https://cli.github.com): `gh auth login`
   (needs the `repo` scope).
2. Copy [.env.example](.env.example) to `.env` (gitignored) if you haven't, and
   fill in the **app signing** block with the values from the Apple and Android
   steps.
3. Push:

   ```sh
   scripts/sync-app-secrets.sh --env-file .env                  # both platforms, this repo
   scripts/sync-app-secrets.sh --env-file .env --ios-only       # or --android-only
   scripts/sync-app-secrets.sh --env-file .env --repo owner/other-repo
   ```

   It prints `set NAME` for each secret. It refuses to run if a variable is
   missing, a file is unreadable or empty, or `ASC_KEY_PATH` isn't a `.p8`
   private key.
4. Check: `gh secret list` should show the seven secrets below.

| Secret | Content |
|---|---|
| `ASC_KEY_P8` | base64 of the `.p8` file |
| `ASC_KEY_ID` | Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ANDROID_KEYSTORE` | base64 of the keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

`.env` is read literally (no shell expansion), so passwords may contain `$`
or spaces; one pair of surrounding quotes is stripped. Values in the env file
win over variables already exported in your shell.

## Building releases in CI

### Test build (no upload)

```sh
gh workflow run app-release.yml        # or GitHub → Actions → app-release → Run workflow
gh run watch                           # follow it
gh run download <run-id>               # fetch the artifacts: ios/*.ipa, android/*.apk, *.aab
```

The workflow must exist on the default branch for manual runs.

### Release

```sh
# optional: bump app/package.json "version" to match
git tag app-v0.1.0
git push origin app-v0.1.0
```

This builds everything, uploads the IPA to TestFlight, and creates the GitHub
Release `app-v0.1.0` with `sensor-ble-0.1.0.ipa`, `.apk` and `.aab`.

### What the jobs do

| Job | Runner | Steps |
|---|---|---|
| `version` | ubuntu | version name from the tag (`app-v0.1.0` → `0.1.0`) or `app/package.json`; build number = `github.run_number` |
| `android` | ubuntu, JDK 21 | bun installs → `vite build` → `cap sync android` → decode keystore → `gradlew assembleRelease bundleRelease -PversionCode -PversionName` |
| `ios` | macos-15, newest Xcode | bun installs → `vite build` → `cap sync ios` → decode + validate API key → unsigned `xcodebuild archive` → `-exportArchive` (IPA) → on tags a second `-exportArchive` with `destination = upload` |
| `release` | ubuntu (tags only) | download artifacts → `gh release create` |

## Versioning

Nothing is committed back; versions are injected at build time.

| | iOS | Android | Source |
|---|---|---|---|
| user-visible version | `MARKETING_VERSION` (CFBundleShortVersionString) | `versionName` | tag `app-vX.Y.Z` → `X.Y.Z`; manual runs: `app/package.json` `version` |
| build number | `CURRENT_PROJECT_VERSION` (CFBundleVersion) | `versionCode` | `github.run_number` (monotonic per workflow) |

App Store Connect rejects a re-used build number for the same version, and
Play rejects a non-increasing `versionCode` — `run_number` satisfies both.

## Installing and distributing the builds

- **iOS / TestFlight:** after a tag build, the build appears in App Store
  Connect → your app → **TestFlight** after processing (typically 5–30 min).
  Internal testers (members of your team) can install it right away via the
  TestFlight app; external testers need a group and a one-time beta review.
- **iOS IPA artifact:** it's signed for App Store distribution, so it can't be
  sideloaded onto a device — use TestFlight (or Transporter to upload it
  manually).
- **Android APK:** sideload with `adb install sensor-ble-X.Y.Z.apk` or by
  opening the file on the phone (allow "install unknown apps"). An installed
  debug build (from `cap run`) has a different signature — uninstall it first.
- **Android AAB:** for Google Play only (see above); it can't be installed
  directly.

## Rotating and revoking credentials

- **API key compromised or no longer needed:** App Store Connect → Integrations
  → Team Keys → **Revoke**. Generate a new one, update `.env`, re-run
  `scripts/sync-app-secrets.sh --env-file .env --ios-only`.
- **Distribution certificate:** cloud-managed by Apple, nothing to rotate or
  back up.
- **Provisioning profiles:** created and refreshed automatically by the export.
- **Android upload key:** can't be rotated for sideloaded APKs without users
  reinstalling. With Play App Signing, request an upload key reset in Play
  Console.
- **Remove all CI secrets:** `gh secret delete <NAME>` for each of the seven.

## Troubleshooting

Errors seen while setting this up, and their causes:

| Symptom | Cause / fix |
|---|---|
| Android: `Unable to access jarfile …/gradle/wrapper/gradle-wrapper.jar` | The wrapper jar wasn't committed (a global `*.jar` gitignore). The repo `.gitignore` now re-includes it. |
| iOS: `The flag -authenticationKeyID is required when specifying -authenticationKeyPath` | `ASC_*` secrets not set. The workflow now fails earlier with *"ASC_\* secrets missing"*. |
| iOS: `Invalid authentication key credential specified (…keyPathInvalid…)` | The `.p8` secret didn't decode to a key (e.g. placeholder values). The workflow validates it and writes it as `AuthKey_<KEY_ID>.p8`; the sync script refuses non-`.p8` files. |
| iOS: `Cloud signing permission error`, `No signing certificate "iOS Distribution" found`, `No profiles for 'com.haberler.sensorble' were found` | The API key isn't **Admin**. Generate an Admin key, update `.env`, re-sync `--ios-only`. |
| iOS upload: app not found / bundle ID unknown | The App Store Connect app record (Apple step 2) doesn't exist yet. |
| iOS upload: build number already used | Re-running a tag build reuses no numbers (`run_number` increments), but a manually re-uploaded IPA would — push a new tag instead. |
| `sync-app-secrets.sh` appears to hang | Old versions passed an empty value to `gh secret set`, which then waits for input. Current version refuses empty values. |
| Local `cap run ios`: *Signing requires a development team* | `DEVELOPMENT_TEAM` missing in the Xcode project, or your Xcode account isn't on that team. |
| Local `cap add`: *Could not find installation of TypeScript* | `capacitor.config.ts` needs TypeScript; this app uses `capacitor.config.json`. |

Useful checks:

```sh
gh secret list                                   # which secrets are set (not their values)
gh run view <run-id> --log-failed                # failing step output
unzip -p sensor-ble-X.Y.Z.ipa 'Payload/App.app/Info.plist' | plutil -p - | grep -E 'Version|Identifier'
apksigner verify --print-certs sensor-ble-X.Y.Z.apk
```

## Reference: files and secrets

| File | Role |
|---|---|
| [.github/workflows/app-release.yml](.github/workflows/app-release.yml) | the CI workflow |
| [app/ci/ExportOptions-export.plist](app/ci/ExportOptions-export.plist) | iOS export to `.ipa` |
| [app/ci/ExportOptions-upload.plist](app/ci/ExportOptions-upload.plist) | iOS export with upload to App Store Connect |
| [app/android/app/build.gradle](app/android/app/build.gradle) | Android `signingConfigs.release`, `-PversionCode/-PversionName` |
| `app/ios/App/App/Info.plist` | `NSBluetoothAlwaysUsageDescription`, `ITSAppUsesNonExemptEncryption` |
| `app/ios/App/App.xcodeproj/project.pbxproj` | `DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE = Automatic` |
| [scripts/sync-app-secrets.sh](scripts/sync-app-secrets.sh) | push signing secrets from `.env` to GitHub |
| [.env.example](.env.example) | template for `.env` (deploy + app signing) |
