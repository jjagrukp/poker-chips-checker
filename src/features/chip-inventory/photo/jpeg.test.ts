import { stripJpegMetadata } from './jpeg';

const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
];

describe('stripJpegMetadata', () => {
  it('drops EXIF/XMP (APP1), IPTC (APP13) and comments, keeping everything else', () => {
    const jfif = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
    const icc = segment(0xe2, [1, 2, 3]);
    const quant = segment(0xdb, [9, 9]);
    const scan = [0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9];
    const input = new Uint8Array([
      0xff,
      0xd8,
      ...jfif,
      ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53]),
      ...icc,
      ...segment(0xed, [1]),
      ...segment(0xfe, [0x68, 0x69]),
      ...quant,
      ...scan,
    ]);
    expect([...(stripJpegMetadata(input) ?? [])]).toEqual([
      0xff,
      0xd8,
      ...jfif,
      ...icc,
      ...quant,
      ...scan,
    ]);
  });

  it('rejects data that is not a well-formed JPEG', () => {
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull();
  });
});
