package com.footprintjournal.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * 把分享图存进系统相册的"足迹手账"相簿（决策 0009）。
 * 用安卓 10 起的媒体库接口写入，不需要申请存储权限；更早的系统直接报不支持，由前端继续走分享。
 */
@CapacitorPlugin(name = "GallerySaver")
public class GallerySaverPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name", "footprint.jpg");
        if (data == null) {
            call.reject("缺少图片数据");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("系统版本低于安卓 10，暂不支持直接存相册", "unsupported");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/足迹手账");
        // 写完之前先标记为"待定"，避免相册里出现半张图
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            call.reject("相册拒绝写入");
            return;
        }
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IllegalStateException("无法打开相册文件");
            out.write(Base64.decode(data, Base64.DEFAULT));
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            call.reject("保存到相册失败：" + e.getMessage());
            return;
        }
        values.clear();
        values.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(uri, values, null, null);

        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        call.resolve(ret);
    }
}
