import { describe, expect, it } from 'vitest';
import { SecretBox } from './crypto.js';
import { TEST_SECRET } from './test/helpers.js';

describe('SecretBox', () => {
  it('round-trips plaintext and produces iv.tag.ciphertext', () => {
    const box = new SecretBox(TEST_SECRET);
    const payload = box.encrypt('immich-api-key-Ωé🙂');
    expect(payload.split('.')).toHaveLength(3);
    expect(payload).not.toContain('immich-api-key');
    expect(box.decrypt(payload)).toBe('immich-api-key-Ωé🙂');
  });

  it('uses a fresh IV per encryption', () => {
    const box = new SecretBox(TEST_SECRET);
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('rejects tampering and wrong keys', () => {
    const box = new SecretBox(TEST_SECRET);
    const other = new SecretBox(`${TEST_SECRET}-different`);
    const payload = box.encrypt('secret');
    expect(() => other.decrypt(payload)).toThrow();
    const [iv, tag, ct] = payload.split('.') as [string, string, string];
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => box.decrypt(`${iv}.${tag}.${flipped.toString('base64')}`)).toThrow();
    expect(() => box.decrypt('garbage')).toThrow(/Malformed/);
  });

  it('requires a long enough secret', () => {
    expect(() => new SecretBox('short')).toThrow();
  });
});
