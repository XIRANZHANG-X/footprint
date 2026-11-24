package com.footprintjournal.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

/**
 * 记录路线的前台服务（决策 0022 第 1 条）。用系统自带的定位接口（LocationManager），
 * 没有谷歌服务的手机也能用。通知栏常驻一条提示，这是安卓对后台定位的要求，也让用户知道它在记。
 * 服务是 App 在前台时开的，之后锁屏、切到别的 App 照样能记，不需要"始终允许定位"。
 */
public class TrackerService extends Service implements LocationListener {
    static final String PREFS = "tracker";
    static final String EXTRA_PRECISE = "precise";
    private static final String CHANNEL = "tracking";
    private static final int NOTIFICATION_ID = 1101;
    // 精度差于 200 米的点不要：室内用基站定位时常偏出去很远
    private static final float MAX_ACCURACY_M = 200f;

    private LocationManager manager;
    // 服务在这个进程里活着没有（决策 0030）：进程被杀后重新起来时是 false，体检靠它发现"被系统停了"
    static volatile boolean alive = false;
    private long lastBeat = 0;
    private boolean precise = false;

    @Override
    public void onCreate() {
        super.onCreate();
        alive = true;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        precise = intent != null && intent.getBooleanExtra(EXTRA_PRECISE, false);
        startInForeground(precise);
        startUpdates(precise);
        prefs(this).edit()
                .putBoolean("running", true)
                .putBoolean("stopRequested", false)
                .putBoolean("precise", precise)
                .putLong("startedAt", System.currentTimeMillis())
                .apply();
        // 记录体检：开始时记一条，之后每 15 分钟一条心跳
        TrackHealth.event(this, "start", precise);
        lastBeat = System.currentTimeMillis();
        TrackHealth.scheduleNext(this);
        // 被系统杀掉后不要自己重启：重启时 App 不在前台，拿不到定位权限
        return START_NOT_STICKY;
    }

    private void startInForeground(boolean precise) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL, "记录路线", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher_monochrome)
                .setContentTitle("足迹手账正在记录路线")
                .setContentText(precise ? "精确模式（GPS），比较耗电" : "省电模式")
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    @SuppressLint("MissingPermission") // 插件在开服务前已经检查过定位权限
    private void startUpdates(boolean precise) {
        if (manager == null) manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        manager.removeUpdates(this);
        // 省电：最少隔 3 分钟或走了 100 米；精确：最少隔 30 秒或 20 米
        long minTime = precise ? 30_000L : 180_000L;
        float minDistance = precise ? 20f : 100f;
        try {
            if (precise && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, minTime, minDistance, this, Looper.getMainLooper());
            }
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, minTime, minDistance, this, Looper.getMainLooper());
            }
            // 别的 App（比如导航）拿到的定位顺带收下，不额外耗电
            manager.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, minTime, minDistance, this, Looper.getMainLooper());
        } catch (Exception ignored) {
            // 某个定位来源不可用就跳过，其他来源照样记
        }
    }

    @Override
    public void onLocationChanged(Location l) {
        if (l.hasAccuracy() && l.getAccuracy() > MAX_ACCURACY_M) return;
        String line = String.format(java.util.Locale.ROOT,
                "{\"t\":%d,\"lat\":%.6f,\"lng\":%.6f,\"acc\":%.0f,\"p\":\"%s\"}",
                l.getTime(), l.getLatitude(), l.getLongitude(),
                l.hasAccuracy() ? l.getAccuracy() : -1f,
                l.getProvider() == null ? "" : l.getProvider());
        TrackFile.append(this, line);
        // 动起来时点很多，心跳顺带补上（闹钟被系统推迟时也不至于看起来像断档）
        long now = System.currentTimeMillis();
        if (now - lastBeat >= TrackHealth.INTERVAL_MS) {
            TrackHealth.event(this, "hb", precise);
            lastBeat = now;
        }
    }

    // 旧版安卓要求实现这几个方法
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    public void onDestroy() {
        if (manager != null) manager.removeUpdates(this);
        alive = false;
        TrackHealth.cancel(this);
        // 用户点了停止是 stop；没点却被销毁（系统回收）是 lost
        SharedPreferences p = prefs(this);
        TrackHealth.event(this, p.getBoolean("stopRequested", false) ? "stop" : "lost", precise);
        p.edit().putBoolean("running", false).apply();
        super.onDestroy();
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
