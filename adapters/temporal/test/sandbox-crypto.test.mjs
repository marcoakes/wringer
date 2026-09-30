// The sandbox SHA-256 must equal node:crypto on every input shape the kernel hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash as nodeHash, randomBytes } from 'node:crypto';
import { createHash } from '../src/sandbox-crypto.js';

const expected = value => nodeHash('sha256').update(value).digest('hex');
test('equals node:crypto on boundary lengths, bytes and text', () => {
    for (let length = 0; length <= 200; length++) {
        const bytes = randomBytes(length);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), expected(bytes), `bytes of length ${length}`);
    }
    for (const text of ['', 'abc', 'é☃𝄞', 'lone \ud800 surrogate', 'x'.repeat(1_000_003), JSON.stringify({ a: [1, 2, { b: 'c' }] })])
        assert.equal(createHash('sha256').update(text).digest('hex'), expected(text));
    assert.equal(createHash('sha256').update('ab').update('c').digest('hex'), expected('abc'));
    assert.equal(createHash('sha256').update('abc').digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('refuses anything but sha256 to hex', () => {
    assert.throws(() => createHash('sha1'), /sha256 only/);
    assert.throws(() => createHash('sha256').update('a').digest('base64'), /hex only/);
    assert.throws(() => createHash('sha256').update(42), /text or bytes/);
});
