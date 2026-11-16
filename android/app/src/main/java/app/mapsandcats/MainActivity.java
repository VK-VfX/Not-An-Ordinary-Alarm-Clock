package app.mapsandcats;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.media.AudioAttributes;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.util.Locale;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/** Thin shell: serves the bundled Maps and Cats web app and forwards the location permission. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int REQ_LOC = 7;
    private WebView web;
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingCb;

    // --- native text-to-speech (WebView has no reliable speechSynthesis) ---
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private Locale defaultLocale = Locale.getDefault();
    private final ArrayDeque<String[]> ttsQueue = new ArrayDeque<>(); // {text, languageTag or ""}
    private int ttsId = 0;

    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            ttsReady = true;
            try { if (tts.getVoice() != null) defaultLocale = tts.getVoice().getLocale(); } catch (Exception ignored) {}
            tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)   // ducks music like a real nav app
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { runOnUiThread(() -> speakNext()); }
                @Override public void onError(String id) { runOnUiThread(() -> speakNext()); }
            });
        });
    }
    /** Segments are spoken one after another so each can switch language (a Chinese place name gets a Chinese voice). */
    private void speakNext() {
        if (!ttsReady) return;
        String[] s = ttsQueue.poll();
        if (s == null) return;
        Locale want = s[1].isEmpty() ? defaultLocale : Locale.forLanguageTag(s[1]);
        int avail = tts.isLanguageAvailable(want);
        tts.setLanguage(avail >= TextToSpeech.LANG_AVAILABLE ? want : defaultLocale);
        tts.speak(s[0], TextToSpeech.QUEUE_FLUSH, null, "mc" + (ttsId++));
    }
    /** Exposed to the page as window.AndroidApps: opens a sibling app (Purrcast, Zamoled), or its page when it isn't installed. */
    private class AppsBridge {
        @JavascriptInterface public boolean installed(String pkg) {
            return getPackageManager().getLaunchIntentForPackage(pkg) != null;
        }
        @JavascriptInterface public void open(String pkg, String url) {
            runOnUiThread(() -> {
                try {
                    Intent li = getPackageManager().getLaunchIntentForPackage(pkg);
                    if (li != null) { startActivity(li); return; }
                    if (url != null && (url.startsWith("https://github.com/VK-VfX/") || url.startsWith("https://t.me/"))) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {}
            });
        }
    }
    /** Exposed to the page as window.AndroidTTS */
    private class TtsBridge {
        @JavascriptInterface public boolean ready() { return ttsReady; }
        @JavascriptInterface public void stop() { runOnUiThread(() -> { ttsQueue.clear(); if (ttsReady) tts.stop(); }); }
        @JavascriptInterface public void speak(String json) {
            runOnUiThread(() -> {
                if (!ttsReady) return;
                try {
                    JSONArray a = new JSONArray(json);
                    ttsQueue.clear(); tts.stop();
                    for (int i = 0; i < a.length(); i++) {
                        JSONObject o = a.getJSONObject(i);
                        ttsQueue.add(new String[]{o.getString("text"), o.optString("lang", "")});
                    }
                    speakNext();
                } catch (Exception ignored) {}
            });
        }
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); // external links leave the app
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                } else {
                    pendingOrigin = origin; pendingCb = cb;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
                }
            }
        });
        initTts();
        web.addJavascriptInterface(new TtsBridge(), "AndroidTTS");
        web.addJavascriptInterface(new AppsBridge(), "AndroidApps");
        web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_LOC && pendingCb != null) {
            boolean ok = false;
            for (int r : res) if (r == PackageManager.PERMISSION_GRANTED) ok = true;
            pendingCb.invoke(pendingOrigin, ok, false);
            pendingCb = null;
        }
    }

    @Override protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        // Let the web app close its own drawer/route first.
        web.evaluateJavascript("window.__macBack ? window.__macBack() : false", v -> {
            if (!"true".equals(v)) finish();
        });
    }
}
