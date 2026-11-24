package com.footprintjournal.app;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 轨迹点的暂存文件（决策 0022 第 2 条）：后台服务每记一个点就追加一行 JSON，
 * 网页打开时一次取走并清空。网页没开、甚至被系统关掉时，点也不会丢。
 * 读写都在同一把锁里，取的时候不会和正在写的撞上。
 */
final class TrackFile {
    private static final Object LOCK = new Object();
    private static final String NAME = "track-pending.jsonl";

    private TrackFile() {}

    private static File file(Context ctx) {
        return new File(ctx.getFilesDir(), NAME);
    }

    static void append(Context ctx, String line) {
        synchronized (LOCK) {
            try (FileOutputStream out = new FileOutputStream(file(ctx), true)) {
                out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
                // 写不进去（存储满了）就丢这一个点，不影响继续记
            }
        }
    }

    static int count(Context ctx) {
        return read(ctx, false).size();
    }

    /** 取出全部暂存的点；take 为 true 时取完清空 */
    static List<String> read(Context ctx, boolean take) {
        synchronized (LOCK) {
            List<String> lines = new ArrayList<>();
            File f = file(ctx);
            if (!f.exists()) return lines;
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (!line.isEmpty()) lines.add(line);
                }
            } catch (Exception ignored) {
                return lines;
            }
            if (take) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
            return lines;
        }
    }
}
