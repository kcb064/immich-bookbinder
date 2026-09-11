import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Encrypts/decrypts short strings (API keys) for storage; format `base64(iv).base64(tag).base64(ciphertext)`. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secretKey: string) {
    if (secretKey.length < 32) throw new Error('SecretBox requires a secret of at least 32 characters');
    // HKDF separates the at-rest key from the raw SECRET_KEY (which also signs cookies).
    this.key = Buffer.from(hkdfSync('sha256', secretKey, 'immich-bookbinder', 'settings-at-rest-v1', KEY_BYTES));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3) throw new Error('Malformed encrypted payload');
    const [ivB64, tagB64, ctB64] = parts as [string, string, string];
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
