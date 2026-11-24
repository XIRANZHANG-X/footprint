package com.footprintjournal.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 本机语音识别（决策 0027）：sherpa-onnx + SenseVoice-Small（int8），模型打包在 App 的 assets/sensevoice 里。
 * 不联网、不花钱；网页版和没有模型的构建照旧用云端识别。
 * 模型第一次用时加载（几秒），之后一直留在内存里；识别在单独的线程里做，不卡界面。
 */
@CapacitorPlugin(name = "LocalAsr")
public class LocalAsrPlugin extends Plugin {
    private static final String MODEL = "sensevoice/model.int8.onnx";
    private static final String TOKENS = "sensevoice/tokens.txt";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private OfflineRecognizer recognizer;

    private boolean modelPresent() {
        try {
            String[] files = getContext().getAssets().list("sensevoice");
            if (files == null) return false;
            boolean model = false, tokens = false;
            for (String f : files) {
                if (f.equals("model.int8.onnx")) model = true;
                if (f.equals("tokens.txt")) tokens = true;
            }
            return model && tokens;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", modelPresent());
        ret.put("loaded", recognizer != null);
        call.resolve(ret);
    }

    private OfflineRecognizer recognizer() {
        if (recognizer != null) return recognizer;
        FeatureConfig feat = new FeatureConfig();
        feat.setSampleRate(16000);
        feat.setFeatureDim(80);
        OfflineSenseVoiceModelConfig sv = new OfflineSenseVoiceModelConfig();
        sv.setModel(MODEL);
        sv.setLanguage("auto");
        sv.setUseInverseTextNormalization(true); // 数字写成阿拉伯数字，加标点
        OfflineModelConfig model = new OfflineModelConfig();
        model.setSenseVoice(sv);
        model.setTokens(TOKENS);
        model.setNumThreads(2);
        model.setProvider("cpu");
        model.setDebug(false);
        OfflineRecognizerConfig config = new OfflineRecognizerConfig();
        config.setFeatConfig(feat);
        config.setModelConfig(model);
        config.setDecodingMethod("greedy_search");
        recognizer = new OfflineRecognizer(getContext().getAssets(), config);
        return recognizer;
    }

    /** 识别一段 WAV（base64，16 位 PCM），返回文字和用时 */
    @PluginMethod
    public void transcribe(PluginCall call) {
        String wav = call.getString("wav");
        if (wav == null || wav.isEmpty()) {
            call.reject("没有录音");
            return;
        }
        if (!modelPresent()) {
            call.reject("这个安装包里没有本机语音模型", "unavailable");
            return;
        }
        worker.execute(() -> {
            long t0 = System.currentTimeMillis();
            try {
                byte[] bytes = Base64.decode(wav, Base64.DEFAULT);
                Pcm pcm = readWav(bytes);
                OfflineRecognizer r = recognizer();
                long t1 = System.currentTimeMillis();
                OfflineStream stream = r.createStream();
                stream.acceptWaveform(pcm.samples, pcm.sampleRate);
                r.decode(stream);
                String text = r.getResult(stream).getText();
                stream.release();
                JSObject ret = new JSObject();
                ret.put("text", text == null ? "" : text.trim());
                ret.put("loadMs", t1 - t0);
                ret.put("ms", System.currentTimeMillis() - t1);
                ret.put("seconds", pcm.samples.length / (double) pcm.sampleRate);
                call.resolve(ret);
            } catch (Throwable e) {
                call.reject("本机识别失败：" + e.getMessage());
            }
        });
    }

    private static final class Pcm {
        final float[] samples;
        final int sampleRate;

        Pcm(float[] samples, int sampleRate) {
            this.samples = samples;
            this.sampleRate = sampleRate;
        }
    }

    // 读最简单的 WAV：RIFF 头里找 fmt 和 data 两块，16 位 PCM，多声道取平均
    private static Pcm readWav(byte[] b) {
        ByteBuffer buf = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
        if (b.length < 44 || buf.getInt(0) != 0x46464952) throw new IllegalArgumentException("不是 WAV");
        int pos = 12, channels = 1, rate = 16000, bits = 16;
        while (pos + 8 <= b.length) {
            int id = buf.getInt(pos), size = buf.getInt(pos + 4);
            if (id == 0x20746d66) { // "fmt "
                channels = buf.getShort(pos + 10);
                rate = buf.getInt(pos + 12);
                bits = buf.getShort(pos + 22);
            } else if (id == 0x61746164) { // "data"
                if (bits != 16) throw new IllegalArgumentException("只支持 16 位 PCM");
                int n = Math.min(size, b.length - pos - 8) / 2 / channels;
                float[] out = new float[n];
                int p = pos + 8;
                for (int i = 0; i < n; i++) {
                    float s = 0;
                    for (int c = 0; c < channels; c++) {
                        s += buf.getShort(p) / 32768f;
                        p += 2;
                    }
                    out[i] = s / channels;
                }
                return new Pcm(out, rate);
            }
            pos += 8 + size + (size & 1);
        }
        throw new IllegalArgumentException("WAV 里没有声音数据");
    }
}
