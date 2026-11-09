// Frame-exact video encoding with WebCodecs (VideoEncoder) + the muxers in mux.js.
// Each frame is rendered offline (tiled, multi-sample) and handed to the encoder
// with an exact timestamp, so the video plays at the right speed no matter how
// long a frame took to render.

import { muxWebM, muxMP4 } from './mux.js';

export const QUALITY_BPP = [0.05, 0.1, 0.2, 0.4]; // bits per pixel per frame: Draft, Good, High, Maximum

export function videoBitrate(W, H, fps, quality) {
  const bpp = QUALITY_BPP[quality] ?? QUALITY_BPP[2];
  return Math.round(Math.min(250e6, Math.max(1e6, W * H * fps * bpp)));
}

export const canEncodeVideo = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

// H.264 levels high → low (8K needs 6.x, 4K needs 5.1+); VP9 profile 0 levels; VP8 last.
const AVC = ['avc1.640034', 'avc1.640033', 'avc1.64003C', 'avc1.640028', 'avc1.4D0034', 'avc1.42E034', 'avc1.42001F'];
const VPX = [['vp09.00.51.08', 'V_VP9'], ['vp09.00.61.08', 'V_VP9'], ['vp09.00.41.08', 'V_VP9'], ['vp8', 'V_VP8']];

// format: 0 = MP4 (H.264), 1 = WebM (VP9). Falls back to the other container if
// the browser can't encode the requested one at this size.
export async function pickEncoder(format, W, H, fps, bitrate) {
  const base = { width: W, height: H, framerate: fps, bitrate, bitrateMode: 'variable', latencyMode: 'quality' };
  const tryList = async (list, make) => {
    for (const item of list) {
      const cfg = make(item);
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg: r.config || cfg, item }; }
      catch { /* malformed for this browser: try next */ }
    }
    return null;
  };
  const mp4 = () => tryList(AVC, c => ({ ...base, codec: c, avc: { format: 'avc' } }));
  const webm = () => tryList(VPX, ([c]) => ({ ...base, codec: c }));
  const order = format === 1 ? [['webm', webm], ['mp4', mp4]] : [['mp4', mp4], ['webm', webm]];
  for (const [kind, fn] of order) {
    const r = await fn();
    if (r) return { kind, config: r.cfg, track: kind === 'webm' ? r.item[1] : 'avc' };
  }
  return null;
}

// Wraps a VideoEncoder: add(canvas) per frame, finish() → Blob.
export class VideoWriter {
  constructor({ kind, config, track }, fps) {
    this.kind = kind; this.track = track; this.fps = fps;
    this.width = config.width; this.height = config.height;
    this.frames = []; this.avcC = null; this.error = null; this.count = 0;
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.frames.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
        const d = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (d && !this.avcC) this.avcC = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0));
      },
      error: e => { this.error = e; },
    });
    this.encoder.configure(config);
  }

  async add(source) {
    if (this.error) throw this.error;
    const us = 1e6 / this.fps;
    const frame = new VideoFrame(source, { timestamp: Math.round(this.count * us), duration: Math.round(us) });
    // Keyframe every 2 s keeps seeking snappy in editors.
    this.encoder.encode(frame, { keyFrame: this.count % Math.max(1, Math.round(this.fps * 2)) === 0 });
    frame.close();
    this.count++;
    while (this.encoder.encodeQueueSize > 2 && !this.error) await new Promise(r => setTimeout(r, 4));
    if (this.error) throw this.error;
  }

  async finish() {
    await this.encoder.flush();
    if (this.error) throw this.error;
    this.encoder.close();
    const frames = this.frames.sort((a, b) => a.ts - b.ts);
    const args = { width: this.width, height: this.height, fps: this.fps, frames };
    return this.kind === 'mp4' ? muxMP4({ ...args, avcC: this.avcC }) : muxWebM({ ...args, codec: this.track });
  }

  abort() { try { this.encoder.close(); } catch { /* already closed */ } }
}
