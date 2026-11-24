package com.footprintjournal.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自己写的插件要在 super.onCreate 之前注册
        registerPlugin(GallerySaverPlugin.class);
        registerPlugin(BackupSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
