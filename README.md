# Not An Ordinary Alarm Clock

An Android alarm clock built for people who sleep through normal alarms. It won't
quietly give up: it rings at max volume on the dedicated alarm stream, escalates
over time, vibrates, shows a full-screen alert over the lock screen, and requires
solving a few math problems before it will let you dismiss it.

## Features

- **Loud, escalating siren** — synthesized at runtime with `AudioTrack` (no bundled
  audio file), sweeping 600Hz-1400Hz on `STREAM_ALARM` at max device volume.
  Volume ramps up over the first ~30s so it starts audible and gets worse.
- **Math-challenge dismiss** — must correctly solve 3 random arithmetic problems
  in a row to stop the alarm (can be disabled per-alarm for a plain dismiss button).
- **Full-screen lock-screen alert** — uses a full-screen notification intent so the
  ringing screen appears even when the phone is locked, bypassing Do Not Disturb.
- **Survives reboots** — alarms are persisted in a Room database and rescheduled
  on `BOOT_COMPLETED`.
- **Repeating alarms** — per-day-of-week repeat, or one-time.
- **Limited snooze** — optional, capped at 2 uses of 5 minutes, per alarm.
- **Foreground service** — keeps the alarm ringing reliably even if the app is
  swiped away, using a partial wake lock.

## Project layout

Standard single-module Android Studio project (Kotlin, View system + ViewBinding,
Room, Gradle Kotlin DSL):

```
app/src/main/java/com/notanordinaryalarmclock/
  MainActivity.kt            alarm list
  AddEditAlarmActivity.kt    create/edit alarm
  AlarmRingActivity.kt       full-screen ringing + math challenge
  AlarmService.kt            foreground service: sound + vibration + notification
  AlarmReceiver.kt           AlarmManager callback -> starts the service
  BootReceiver.kt            reschedules alarms after reboot
  AlarmScheduler.kt          AlarmManager scheduling logic
  AlarmApp.kt                notification channel setup
  data/                      Room entity/DAO/database
  util/AlarmSoundPlayer.kt   siren synthesizer
  util/MathChallenge.kt      arithmetic problem generator
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
