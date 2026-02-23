import { randomBytes, createCipheriv } from 'crypto';

export interface EncryptionResult {
	nonce: string;      // Base64
	tag: string;        // Base64
	ciphertext: string; // Base64
}

/**
 * AES-256-GCM encryptor.
 * - key must be 32 bytes (256 bit)
 * - uses random 12-byte nonce
 */
export class PayloadEncryptor {
	constructor(private key: Buffer) {
		if (key.length !== 32) {
			throw new Error('Encryption key must be 32 bytes for AES-256-GCM');
		}
	}

	encrypt(payload: unknown): EncryptionResult {
		const nonce = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, nonce);

		const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		const tag = cipher.getAuthTag();

		return {
			nonce: nonce.toString('base64'),
			tag: tag.toString('base64'),
			ciphertext: ciphertext.toString('base64'),
		};
	}
}
