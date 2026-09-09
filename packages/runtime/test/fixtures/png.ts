import { deflateSync } from "node:zlib";
/** Tiny pixel for binary/parser unit tests, not a screenshot or UI evidence. */
export function unitPng(red = 20): string {
    const chunk = (name: string, data: Buffer) => {
        const type = Buffer.from(name), body = Buffer.concat([type, data]); let crc = 0xffffffff;
        for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
        const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
        return Buffer.concat([size, body, checksum]);
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,red,30,40]))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
