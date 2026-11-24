package com.footprintjournal.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 自动备份（决策 0019 第 1 条）：把 App 缓存目录里已经写好的备份文件，复制到手机的"下载/足迹手账"文件夹，
 * 再删掉自己以前存的、多出来的自动备份，只留最近几份。
 * 用安卓 10 起的媒体库接口，不需要存储权限；只能看到和删除本 App 自己存的文件，
 * 卸载重装后以前的备份不会被删（新装的 App 看不到它们），这正好也是备份该有的样子。
 */
@CapacitorPlugin(name = "BackupSaver")
public class BackupSaverPlugin extends Plugin {

    private static final String FOLDER = Environment.DIRECTORY_DOWNLOADS + "/足迹手账/";

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String source = call.getString("uri");
        String name = call.getString("name");
        String prefix = call.getString("prefix");
        int keep = call.getInt("keep", 2);
        if (source == null || name == null || prefix == null || prefix.isEmpty()) {
            call.reject("缺少参数");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("系统版本低于安卓 10，不支持自动备份到下载文件夹", "unsupported");
            return;
        }

        File file;
        try {
            // 只允许复制 App 自己缓存目录里的文件
            file = new File(Uri.parse(source).getPath()).getCanonicalFile();
            String cache = getContext().getCacheDir().getCanonicalPath() + File.separator;
            if (!file.getPath().startsWith(cache) || !file.isFile()) {
                call.reject("备份文件不在缓存目录里");
                return;
            }
        } catch (Exception e) {
            call.reject("找不到备份文件：" + e.getMessage());
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
        values.put(MediaStore.Downloads.RELATIVE_PATH, FOLDER);
        // 写完之前标记为"待定"，避免文件管理器里出现半个文件
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = resolver.insert(collection, values);
        if (uri == null) {
            call.reject("下载文件夹拒绝写入");
            return;
        }
        try (InputStream in = new FileInputStream(file);
             OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IllegalStateException("无法打开目标文件");
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            call.reject("写入下载文件夹失败：" + e.getMessage());
            return;
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        //noinspection ResultOfMethodCallIgnored
        file.delete();

        int deleted = pruneOld(resolver, collection, prefix, keep);
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("deleted", deleted);
        call.resolve(ret);
    }

    // 只删本 App 存的、名字以 prefix 开头的自动备份，按时间从新到旧留 keep 份
    private int pruneOld(ContentResolver resolver, Uri collection, String prefix, int keep) {
        List<Uri> found = new ArrayList<>();
        String[] projection = {MediaStore.Downloads._ID};
        String selection = MediaStore.Downloads.RELATIVE_PATH + "=? AND "
                + MediaStore.Downloads.DISPLAY_NAME + " LIKE ?";
        String[] args = {FOLDER, prefix + "%"};
        try (Cursor c = resolver.query(collection, projection, selection, args,
                MediaStore.Downloads.DATE_ADDED + " DESC, " + MediaStore.Downloads._ID + " DESC")) {
            if (c == null) return 0;
            while (c.moveToNext()) found.add(ContentUris.withAppendedId(collection, c.getLong(0)));
        } catch (Exception e) {
            return 0;
        }
        int deleted = 0;
        for (int i = keep; i < found.size(); i++) {
            try {
                deleted += resolver.delete(found.get(i), null, null);
            } catch (Exception ignored) {
                // 删不掉的旧备份留着，不影响这次备份
            }
        }
        return deleted;
    }
}
