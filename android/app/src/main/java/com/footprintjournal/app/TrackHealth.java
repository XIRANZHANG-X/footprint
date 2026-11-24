package com.footprintjournal.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.PowerManager;
import android.os.Build;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;

import java.util.Locale;

/**
 * 记录体检（决策 0030）：记录路线时每 15 分钟留一条"心跳"（时间、电量、是否在充电、定位来源能不能用），
 * 和轨迹点写在同一个暂存文件里，回到 App 时一起取走，在网页里算出耗电、断档。
 * 心跳由系统闹钟触发（低电耗模式下也会响），所以服务被系统杀掉后，下一次闹钟能发现"该在记却没在记"。
 */
final class TrackHealth {
    static final long INTERVAL_MS = 15 * 60_000L;
    private static final int REQUEST = 4401;
    private static final int LOST_NOTIFICATION_ID = 1102;

    private TrackHealth() {}

    static int battery(Context ctx) {
        BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
        return bm == null ? -1 : bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
    }

    static boolean charging(Context ctx) {
        BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
        return bm != null && Build.VERSION.SDK_INT >= 23 && bm.isCharging();
    }

    /** 这台手机有没有网络定位、现在开没开（没有谷歌服务的手机，网络定位由厂商提供，可能没有） */
    static String providers(Context ctx) {
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return "";
        StringBuilder sb = new StringBuilder();
        for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
            String state = !lm.getAllProviders().contains(p) ? "none" : (lm.isProviderEnabled(p) ? "on" : "off");
            if (sb.length() > 0) sb.append(',');
            sb.append(p).append(':').append(state);
        }
        return sb.toString();
    }

    /** 屏幕亮着没有：电量是整机的，只有锁屏期间的耗电才大致反映后台记录的消耗 */
    static boolean screenOn(Context ctx) {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isInteractive();
    }

    /** 一条事件：start / hb（心跳）/ stop（用户停的）/ lost（被系统停的） */
    static void event(Context ctx, String ev, boolean precise) {
        String line = String.format(Locale.ROOT,
                "{\"ev\":\"%s\",\"t\":%d,\"bat\":%d,\"chg\":%b,\"scr\":%b,\"precise\":%b,\"prov\":\"%s\"}",
                ev, System.currentTimeMillis(), battery(ctx), charging(ctx), screenOn(ctx), precise, providers(ctx));
        TrackFile.append(ctx, line);
    }

    private static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, HeartbeatReceiver.class);
        return PendingIntent.getBroadcast(ctx, REQUEST, i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** 15 分钟后再响一次。不用精确闹钟（要额外权限），系统会适当推迟，体检按 45 分钟算断档 */
    static void scheduleNext(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = SystemClock.elapsedRealtime() + INTERVAL_MS;
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, alarmIntent(ctx));
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(ctx));
    }

    /** 发现被系统停了：通知栏提示一次，点开回到 App */
    static void notifyLost(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(
                    "tracking-lost", "路线记录中断", NotificationManager.IMPORTANCE_DEFAULT));
        }
        PendingIntent pi = PendingIntent.getActivity(ctx, 0,
                new Intent(ctx, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(ctx, "tracking-lost")
                .setSmallIcon(R.mipmap.ic_launcher_monochrome)
                .setContentTitle("路线记录被系统停了")
                .setContentText("点开足迹手账重新开始，并按提示允许它在后台运行")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        try {
            nm.notify(LOST_NOTIFICATION_ID, n);
        } catch (SecurityException ignored) {
            // 没给通知权限：体检页里照样能看到
        }
    }
}
