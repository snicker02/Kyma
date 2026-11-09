// Minimal video muxers for WebCodecs output. No dependencies.
//
//   muxWebM  — EBML header + one Segment: SeekHead, Info, Tracks, Clusters of
//              SimpleBlocks (a new Cluster at every keyframe), Cues. VP8 / VP9.
//   muxMP4   — ftyp + moov (written first, "faststart") + mdat. One H.264 track,
//              constant frame rate, no B-frames (WebCodecs does not emit them),
//              so no ctts / edit list is needed.
//
// Both take the same input: { width, height, fps, frames: [{ data: Uint8Array,
// key: bool }] } with frames in presentation order. MP4 also needs `avcC`, the
// AVCDecoderConfigurationRecord the encoder hands back as decoderConfig.description.

const enc = new TextEncoder();

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── EBML ────────────────────────────────────────────────────────────────────
function idBytes(id) {
  const n = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (id >>> (8 * (n - 1 - i))) & 0xff;
  return b;
}
// Element sizes are always written as 8-byte vints: simple, and lets SeekHead /
// Cues offsets be computed before the bytes exist.
function size8(n) {
  const b = new Uint8Array(8);
  b[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
  return b;
}
function uintBytes(v, fixed = 0) {
  let n = fixed;
  if (!n) { n = 1; while (n < 8 && v >= 2 ** (8 * n)) n++; }
  const b = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
  return b;
}
const ebml = (id, ...payload) => { const p = concat(payload); return concat([idBytes(id), size8(p.length), p]); };
const eUint = (id, v, fixed) => ebml(id, uintBytes(v, fixed));
const eStr = (id, s) => ebml(id, enc.encode(s));
const eF64 = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return ebml(id, b); };

export function muxWebM({ width, height, fps, frames, codec = 'V_VP9' }) {
  const frameMs = 1000 / fps;
  const header = ebml(0x1a45dfa3,
    eUint(0x4286, 1), eUint(0x42f7, 1), eUint(0x42f2, 4), eUint(0x42f3, 8),
    eStr(0x4282, 'webm'), eUint(0x4287, 4), eUint(0x4285, 2));

  const info = ebml(0x1549a966,
    eUint(0x2ad7b1, 1_000_000), // TimecodeScale: 1 ms
    eStr(0x4d80, 'Kyma'), eStr(0x5741, 'Kyma'),
    eF64(0x4489, frames.length * frameMs));
  const tracks = ebml(0x1654ae6b, ebml(0xae,
    eUint(0xd7, 1), eUint(0x73c5, 1), eUint(0x83, 1), eUint(0x9c, 0),
    eStr(0x86, codec),
    eUint(0x23e383, Math.round(1e9 / fps)), // DefaultDuration (ns)
    ebml(0xe0, eUint(0xb0, width), eUint(0xba, height))));

  // Clusters: start a new one at each keyframe (SimpleBlock timecodes are int16
  // relative to the cluster, so a cluster must stay under ~32 s).
  const clusters = [];
  let cur = null;
  frames.forEach((f, i) => {
    const t = Math.round(i * frameMs);
    if (!cur || f.key || t - cur.t > 30000) { cur = { t, blocks: [] }; clusters.push(cur); }
    const head = new Uint8Array(4);
    head[0] = 0x81; // track 1 as a vint
    new DataView(head.buffer).setInt16(1, t - cur.t);
    head[3] = f.key ? 0x80 : 0x00;
    cur.blocks.push(ebml(0xa3, head, f.data));
  });
  const clusterBytes = clusters.map(c => ebml(0x1f43b675, eUint(0xe7, c.t), ...c.blocks));

  // SeekHead has a fixed size (8-byte positions), so offsets can be laid out first.
  const seekHead = (infoPos, tracksPos, cuesPos) => ebml(0x114d9b74,
    ebml(0x4dbb, ebml(0x53ab, idBytes(0x1549a966)), eUint(0x53ac, infoPos, 8)),
    ebml(0x4dbb, ebml(0x53ab, idBytes(0x1654ae6b)), eUint(0x53ac, tracksPos, 8)),
    ebml(0x4dbb, ebml(0x53ab, idBytes(0x1c53bb6b)), eUint(0x53ac, cuesPos, 8)));
  const shLen = seekHead(0, 0, 0).length;
  const infoPos = shLen, tracksPos = infoPos + info.length;
  let pos = tracksPos + tracks.length;
  const cuePoints = clusterBytes.map((cb, i) => {
    const p = ebml(0xbb, eUint(0xb3, clusters[i].t), ebml(0xb7, eUint(0xf7, 1), eUint(0xf1, pos, 8)));
    pos += cb.length;
    return p;
  });
  const cues = ebml(0x1c53bb6b, ...cuePoints);
  const body = concat([seekHead(infoPos, tracksPos, pos), info, tracks, ...clusterBytes, cues]);
  return new Blob([header, idBytes(0x18538067), size8(body.length), body], { type: 'video/webm' });
}

// ── MP4 (ISO BMFF) ──────────────────────────────────────────────────────────
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; }
function u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; }
const zeros = n => new Uint8Array(n);
const fourcc = s => enc.encode(s);
const box = (type, ...payload) => { const p = concat(payload); return concat([u32(p.length + 8), fourcc(type), p]); };
const fullBox = (type, version, flags, ...payload) =>
  box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...payload);
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

export function muxMP4({ width, height, fps, frames, avcC }) {
  if (!avcC || !avcC.length) throw new Error('H.264 encoder returned no decoder configuration');
  const n = frames.length;
  const timescale = Math.round(fps * 1000), delta = 1000;
  const mediaDur = n * delta;
  const movieDur = Math.round((n / fps) * 1000);
  const total = frames.reduce((s, f) => s + f.data.length, 0);
  const large = total + 16 > 0xffffffff;

  const ftyp = box('ftyp', fourcc('isom'), u32(0x200), fourcc('isom'), fourcc('iso2'), fourcc('avc1'), fourcc('mp41'));
  const keys = [];
  frames.forEach((f, i) => { if (f.key) keys.push(i + 1); });

  const moov = chunkOffset => {
    const avc1 = box('avc1',
      zeros(6), u16(1), // reserved, data_reference_index
      zeros(16), u16(width), u16(height),
      u32(0x00480000), u32(0x00480000), u32(0), u16(1),
      zeros(32), u16(0x0018), u16(0xffff),
      box('avcC', avcC),
      box('pasp', u32(1), u32(1)));
    const stbl = box('stbl',
      fullBox('stsd', 0, 0, u32(1), avc1),
      fullBox('stts', 0, 0, u32(1), u32(n), u32(delta)),
      fullBox('stss', 0, 0, u32(keys.length), ...keys.map(u32)),
      fullBox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      fullBox('stsz', 0, 0, u32(0), u32(n), ...frames.map(f => u32(f.data.length))),
      large
        ? fullBox('co64', 0, 0, u32(1), u32(Math.floor(chunkOffset / 2 ** 32)), u32(chunkOffset >>> 0))
        : fullBox('stco', 0, 0, u32(1), u32(chunkOffset)));
    const minf = box('minf',
      fullBox('vmhd', 0, 1, zeros(8)),
      box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
      stbl);
    const mdia = box('mdia',
      fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDur), u16(0x55c4), u16(0)),
      fullBox('hdlr', 0, 0, u32(0), fourcc('vide'), zeros(12), enc.encode('Kyma video\0')),
      minf);
    const tkhd = fullBox('tkhd', 0, 3,
      u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8),
      u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width * 65536), u32(height * 65536));
    const mvhd = fullBox('mvhd', 0, 0,
      u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10),
      MATRIX, zeros(24), u32(2));
    return box('moov', mvhd, box('trak', tkhd, mdia));
  };

  const mdatHead = large
    ? concat([u32(1), fourcc('mdat'), u32(Math.floor((total + 16) / 2 ** 32)), u32((total + 16) >>> 0)])
    : concat([u32(total + 8), fourcc('mdat')]);
  const moovLen = moov(0).length; // offset value does not change the size
  const offset = ftyp.length + moovLen + mdatHead.length;
  return new Blob([ftyp, moov(offset), mdatHead, ...frames.map(f => f.data)], { type: 'video/mp4' });
}
