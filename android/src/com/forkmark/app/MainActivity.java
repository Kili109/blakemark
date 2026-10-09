package com.forkmark.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_HOST = "forkmark.local";
    private WebView webView;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("blakemark", MODE_PRIVATE);

        webView = new WebView(this);
        applyChrome(prefs.getString("theme", "dark"));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        webView.addJavascriptInterface(new ChromeBridge(), "BlakemarkNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutside(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && request.getUrl() != null && !APP_HOST.equals(request.getUrl().getHost())) {
                    return null;
                }
                return route(request);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(view.getContext());
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        Uri target = request.getUrl();
                        if ("here".equals(prefs.getString("links", "browser"))) {
                            if (target != null) webView.loadUrl(target.toString());
                        } else {
                            openOutside(target);
                        }
                        popupView.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        setContentView(webView);
        webView.loadUrl("https://" + APP_HOST + "/index.html");
    }

    private boolean openOutside(Uri uri) {
        if (uri == null || APP_HOST.equals(uri.getHost())) return false;
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return false;
        String mode = prefs.getString("links", "browser");
        if ("here".equals(mode)) return false;
        if ("app".equals(mode) && openExchangeApp(uri)) return true;
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (!"app".equals(mode)) {
            String browser = browserPackage();
            if (browser != null) intent.setPackage(browser);
        }
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            if (intent.getPackage() == null) return false;
            intent.setPackage(null);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException again) {
                return false;
            }
        }
        return true;
    }

    private boolean openExchangeApp(Uri uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
        String pkg = null;
        if (host.equals("nonkyc.io") || host.endsWith(".nonkyc.io")) pkg = "com.nonkyc.app";
        if (pkg == null) return false;
        Intent launch = getPackageManager().getLaunchIntentForPackage(pkg);
        if (launch == null) return false;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(launch);
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }

    private String browserPackage() {
        PackageManager manager = getPackageManager();
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"));
        probe.addCategory(Intent.CATEGORY_BROWSABLE);
        ResolveInfo chosen = manager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY);
        if (chosen != null && chosen.activityInfo != null) {
            String pkg = chosen.activityInfo.packageName;
            if (pkg != null && !pkg.equals(getPackageName()) && !"android".equals(pkg)) return pkg;
        }
        for (ResolveInfo info : manager.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY)) {
            if (info.activityInfo == null) continue;
            String pkg = info.activityInfo.packageName;
            if (pkg != null && !pkg.equals(getPackageName())) return pkg;
        }
        return null;
    }

    private void applyChrome(String theme) {
        boolean light = "light".equals(theme);
        int ink = Color.parseColor(light ? "#f4efe6" : "#14120e");
        Window window = getWindow();
        window.setStatusBarColor(ink);
        window.setNavigationBarColor(ink);
        if (webView != null) webView.setBackgroundColor(ink);
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) {
            if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    private final class ChromeBridge {
        @JavascriptInterface
        public void setChrome(String theme, String links) {
            String safeTheme = "light".equals(theme) ? "light" : "dark";
            String safeLinks = "app".equals(links) ? "app" : "here".equals(links) ? "here" : "browser";
            prefs.edit().putString("theme", safeTheme).putString("links", safeLinks).apply();
            runOnUiThread(() -> applyChrome(safeTheme));
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    private WebResourceResponse route(WebResourceRequest request) {
        android.net.Uri uri = request.getUrl();
        if (uri == null) return text(400, "Bad Request", "text/plain", "Bad request");
        if (APP_HOST.equals(uri.getHost())) return asset(uri.getPath());
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
        return proxy(request);
    }

    private WebResourceResponse asset(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.contains("..")) return text(400, "Bad Request", "text/plain", "Bad request");
        String rel = path.startsWith("/") ? path.substring(1) : path;
        try {
            InputStream in = getAssets().open(rel);
            return new WebResourceResponse(mime(rel), "utf-8", 200, "OK", headers(false), in);
        } catch (IOException first) {
            boolean route = !rel.contains(".");
            if (route) {
                try {
                    InputStream in = getAssets().open("index.html");
                    return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers(false), in);
                } catch (IOException ignored) {
                    return text(404, "Not Found", "text/plain", "Missing app files");
                }
            }
            return text(404, "Not Found", "text/plain", "Not found");
        }
    }

    private WebResourceResponse proxy(WebResourceRequest request) {
        String method = request.getMethod() == null ? "GET" : request.getMethod().toUpperCase(Locale.US);
        if ("OPTIONS".equals(method)) return text(204, "No Content", "text/plain", "");
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return text(405, "Method Not Allowed", "text/plain", "Method not allowed");
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json,text/css,text/plain,*/*");
            conn.setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
            );
            int code = conn.getResponseCode();
            if (code < 100) code = 502;
            String reason = code >= 400 ? "Error" : "OK";
            String contentType = conn.getContentType();
            String mime = "application/octet-stream";
            String charset = null;
            if (contentType != null && !contentType.isEmpty()) {
                String[] parts = contentType.split(";");
                if (!parts[0].trim().isEmpty()) mime = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String part = parts[i].trim();
                    if (part.toLowerCase(Locale.US).startsWith("charset=")) {
                        charset = part.substring(8).replace("\"", "");
                    }
                }
            }
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
            return new WebResourceResponse(mime, charset, code, reason, headers(true), stream);
        } catch (Exception error) {
            if (conn != null) conn.disconnect();
            return text(502, "Bad Gateway", "application/json", "{\"error\":\"network\"}");
        }
    }

    private static Map<String, String> headers(boolean crossOrigin) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        if (crossOrigin) {
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            headers.put("Access-Control-Allow-Headers", "*");
        }
        return headers;
    }

    private static WebResourceResponse text(int code, String reason, String mime, String body) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse(mime, "utf-8", code, reason, headers(true), new ByteArrayInputStream(bytes));
    }

    private static String mime(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
}
