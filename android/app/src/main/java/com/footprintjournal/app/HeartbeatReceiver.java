package com.footprintjournal.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * 记录体检的闹钟（决策 0030）。服务还活着：记一条心跳，约好下一次。
 * 服务已经不在了，但用户没点过停止：说明被系统杀了，记一条 lost、发通知，不再约下一次。
 * （进程被杀后闹钟照样会响，系统会为这个接收器重新启动进程，所以这时 TrackerService.alive 是 false。）
 */
public class HeartbeatReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        SharedPreferences p = TrackerService.prefs(ctx);
        if (!p.getBoolean("running", false)) return;
        boolean precise = p.getBoolean("precise", false);
        if (TrackerService.alive) {
            TrackHealth.event(ctx, "hb", precise);
            TrackHealth.scheduleNext(ctx);
        } else {
            TrackHealth.event(ctx, "lost", precise);
            p.edit().putBoolean("running", false).apply();
            TrackHealth.notifyLost(ctx);
        }
    }
}
