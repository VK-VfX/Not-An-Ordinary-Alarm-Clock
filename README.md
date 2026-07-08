# Not An Ordinary Alarm Clock

An Android alarm clock built for people who sleep through normal alarms. It won't
quietly give up: it rings at max volume on the dedicated alarm stream, escalates
over time, vibrates, shows a full-screen alert over the lock screen, and requires
solving a few math problems before it will let you dismiss it.

## Features

- **Loud, escalating, harsh siren** — synthesized at runtime with `AudioTrack` (no
  bundled audio file): a swept fundamental layered with an overtone and soft-clipped
  for a piercing, buzzy tone, played on `STREAM_ALARM` at max device volume with
  transient audio focus so it overrides whatever else is playing. Volume starts loud
  and ramps to full within seconds.
- **Hard vibration** — tight, max-amplitude pulses rather than a gentle buzz.
- **No snooze** — the alarm keeps ringing until a math question is solved (this is
  a global Settings toggle if you need to turn it off for accessibility reasons).
- **Full-screen lock-screen alert** — uses a full-screen notification intent so the
  ringing screen appears even when the phone is locked, bypassing Do Not Disturb.
- **Survives reboots** — alarms are persisted in a Room database and rescheduled
  on `BOOT_COMPLETED`.
- **Repeating alarms** — per-day-of-week repeat, or one-time (with a live date preview).
- **Home screen widget** — live clock + next alarm, refreshed whenever alarms change.
- **Settings screen** — math-challenge toggle, app version, and a link to GitHub Releases.
- **Foreground service** — keeps the alarm ringing reliably even if the app is
  swiped away, using a partial wake lock.

## Project layout

Standard single-module Android Studio project (Kotlin, View system + ViewBinding,
Room, Gradle Kotlin DSL):

```
app/src/main/java/com/notanordinaryalarmclock/
  MainActivity.kt            alarm list (swipe to delete, next-alarm card)
  AddEditAlarmActivity.kt    create/edit alarm, big scrolling time picker
  AlarmRingActivity.kt       full-screen ringing + math challenge (no snooze)
  AlarmService.kt            foreground service: sound + vibration + notification
  AlarmReceiver.kt           AlarmManager callback -> starts the service
  BootReceiver.kt            reschedules alarms after reboot
  AlarmScheduler.kt          AlarmManager scheduling logic
  AlarmApp.kt                notification channel setup
  SettingsActivity.kt        math-challenge toggle, about/version, check for updates
  widget/AlarmWidgetProvider.kt  home screen widget
  data/                      Room entity/DAO/database
  util/AlarmSoundPlayer.kt   siren synthesizer
  util/MathChallenge.kt      arithmetic problem generator
  util/AppSettings.kt        SharedPreferences-backed app settings
```

## Building an APK

This repo ships a GitHub Actions workflow (`.github/workflows/android-build.yml`)
that builds a debug APK on every push and uploads it as a workflow artifact —
download it from the Actions run summary and install directly.

To build locally with Android Studio or the CLI:

```
./gradlew assembleDebug
# APK at app/build/outputs/apk/debug/app-debug.apk
```

Requires a JDK 17 and the Android SDK (compileSdk 34); Android Studio will
prompt to install anything missing.

## Releases

Pushing a tag matching `v*` (e.g. `v2.0.0`) triggers the same workflow to also publish
a [GitHub Release](https://github.com/VK-VfX/Not-An-Ordinary-Alarm-Clock/releases) with
the APK attached, alongside auto-generated release notes.

## Installing the APK

The debug APK is unsigned by a release key, so on-device you'll need to allow
"install from unknown sources" for whichever app you use to open the APK file,
then tap it to install.

## Permissions

| Permission | Why |
|---|---|
| `SCHEDULE_EXACT_ALARM` | Required on Android 12+ to fire alarms at the exact requested time. |
| `USE_FULL_SCREEN_INTENT` | Shows the ringing screen over the lock screen. |
| `POST_NOTIFICATIONS` | Required on Android 13+ to show the alarm notification. |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Keeps the alarm's audio/vibration running reliably. |
| `RECEIVE_BOOT_COMPLETED` | Reschedules alarms after the device restarts. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Prompts to exempt the app from battery optimization so alarms aren't delayed. |

On first launch the app requests these where a runtime prompt is needed.
