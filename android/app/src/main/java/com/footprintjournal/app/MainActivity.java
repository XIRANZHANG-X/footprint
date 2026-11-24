package com.footprintjournal.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自己写的插件要在 super.onCreate 之前注册
        registerPlugin(GallerySaverPlugin.class);
        registerPlugin(BackupSaverPlugin.class);
        registerPlugin(TrackerPlugin.class);
        registerPlugin(ShareInPlugin.class);
        super.onCreate(savedInstanceState);
        // App 没开着时从相册分享进来：启动的那个 Intent 就带着照片（决策 0023）
        ShareInPlugin.receive(getIntent());
    }

    // App 已经开着时从相册分享进来（launchMode 是 singleTask，走这里）
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareInPlugin.receive(intent);
    }
}
