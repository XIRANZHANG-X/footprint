package com.footprintjournal.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 从相册"分享"进 App（决策 0023）：别的 App 发来的照片先记下来，网页来取时复制到缓存目录，
 * 网页再读成文件，走和"选照片"一样的新建流程。照片的拍摄时间、位置原样保留（只复制字节，不重新编码）。
 */
@CapacitorPlugin(
        name = "ShareIn",
        permissions = {
                // 安卓 10 起，从相册分享来的照片默认去掉了位置信息；有这个权限才拿得到原图里的位置
                @Permission(strings = {"android.permission.ACCESS_MEDIA_LOCATION"}, alias = "mediaLocation"),
        })
public class ShareInPlugin extends Plugin {
    private static final List<Uri> pending = new ArrayList<>();
    private static ShareInPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** MainActivity 收到分享时调用：记下照片地址，并告诉网页"有照片来了" */
    static void receive(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return;
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        synchronized (pending) {
            pending.clear();
            pending.addAll(uris);
        }
        if (instance != null) instance.notifyListeners("shared", new JSObject(), true);
    }

    /** 取走分享来的照片：复制到缓存目录，返回文件地址、文件名、类型 */
    @PluginMethod
    public void take(PluginCall call) {
        synchronized (pending) {
            if (pending.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("files", new JSArray());
                call.resolve(ret);
                return;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState("mediaLocation") == PermissionState.PROMPT) {
            requestPermissionForAlias("mediaLocation", call, "afterPermission");
            return;
        }
        copyOut(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        // 不给权限也照样导入，只是照片里没有位置（有轨迹的话按时间补，决策 0022）
        copyOut(call);
    }

    private void copyOut(PluginCall call) {
        List<Uri> uris;
        synchronized (pending) {
            uris = new ArrayList<>(pending);
            pending.clear();
        }
        boolean original = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState("mediaLocation") == PermissionState.GRANTED;
        ContentResolver resolver = getContext().getContentResolver();
        File dir = new File(getContext().getCacheDir(), "shared");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        JSArray files = new JSArray();
        int i = 0;
        for (Uri uri : uris) {
            String name = displayName(resolver, uri, "photo-" + i + ".jpg");
            File out = new File(dir, System.currentTimeMillis() + "-" + i + "-" + name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            Uri source = uri;
            if (original) {
                try {
                    source = MediaStore.setRequireOriginal(uri);
                } catch (Exception ignored) {
                    source = uri;
                }
            }
            if (copy(resolver, source, out) || (source != uri && copy(resolver, uri, out))) {
                JSObject f = new JSObject();
                f.put("path", Uri.fromFile(out).toString());
                f.put("name", name);
                String type = resolver.getType(uri);
                f.put("type", type == null ? "image/jpeg" : type);
                files.put(f);
            }
            i++;
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    private static boolean copy(ContentResolver resolver, Uri uri, File out) {
        try (InputStream in = resolver.openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) return false;
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri, String fallback) {
        try (Cursor c = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Exception ignored) {
            // 查不到名字就用默认的
        }
        return fallback;
    }
}
