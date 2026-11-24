package com.footprintjournal.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.List;

/**
 * 给网页用的"记录路线"开关（决策 0022）：开始、停止、查状态、取走暂存的点、打开系统的电池优化设置。
 */
@CapacitorPlugin(
        name = "Tracker",
        permissions = {
                @Permission(strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, alias = "location"),
                @Permission(strings = {"android.permission.POST_NOTIFICATIONS"}, alias = "notifications"),
        })
public class TrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocation");
            return;
        }
        afterLocation(call);
    }

    @PermissionCallback
    private void afterLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("没有定位权限，没法记录路线", "denied");
            return;
        }
        // 安卓 13 起通知要单独授权；不给也能记，只是看不到通知栏的提示
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        launch(call);
    }

    private void launch(PluginCall call) {
        Intent i = new Intent(getContext(), TrackerService.class);
        i.putExtra(TrackerService.EXTRA_PRECISE, call.getBoolean("precise", false));
        try {
            ContextCompat.startForegroundService(getContext(), i);
        } catch (Exception e) {
            call.reject("开始记录失败：" + e.getMessage());
            return;
        }
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TrackerService.class));
        TrackerService.prefs(getContext()).edit().putBoolean("running", false).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        SharedPreferences p = TrackerService.prefs(getContext());
        JSObject ret = new JSObject();
        ret.put("running", p.getBoolean("running", false));
        ret.put("precise", p.getBoolean("precise", false));
        ret.put("startedAt", p.getLong("startedAt", 0));
        ret.put("pending", TrackFile.count(getContext()));
        return ret;
    }

    /** 取走暂存的点（取完清空），由网页存进数据库 */
    @PluginMethod
    public void drain(PluginCall call) {
        List<String> lines = TrackFile.read(getContext(), true);
        JSArray points = new JSArray();
        for (String line : lines) {
            try {
                points.put(new JSONObject(line));
            } catch (Exception ignored) {
                // 写到一半的行（比如断电）跳过
            }
        }
        JSObject ret = new JSObject();
        ret.put("points", points);
        call.resolve(ret);
    }

    /** 国产手机会在锁屏后杀后台：打开系统的电池优化设置，让用户把 App 设为不限制 */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("打不开系统设置：" + e.getMessage());
        }
    }
}
