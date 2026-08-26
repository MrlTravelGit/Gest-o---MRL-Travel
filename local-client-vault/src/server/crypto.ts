import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Envelope { v: 1; n: string; t: string; c: string }
export function encryptBytes(value: Buffer, key: Buffer): Envelope { const nonce=randomBytes(12); const cipher=createCipheriv("aes-256-gcm",key,nonce); const ciphertext=Buffer.concat([cipher.update(value),cipher.final()]); return {v:1,n:nonce.toString("base64"),t:cipher.getAuthTag().toString("base64"),c:ciphertext.toString("base64")}; }
export function decryptBytes(value: Envelope, key: Buffer) { if(value.v!==1) throw new Error("Versao criptografica nao suportada."); const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(value.n,"base64")); decipher.setAuthTag(Buffer.from(value.t,"base64")); return Buffer.concat([decipher.update(Buffer.from(value.c,"base64")),decipher.final()]); }
export const encryptText = (value: string | null | undefined,key:Buffer) => value == null || value==="" ? null : JSON.stringify(encryptBytes(Buffer.from(value,"utf8"),key));
export const decryptText = (value: string | null | undefined,key:Buffer) => value ? decryptBytes(JSON.parse(value) as Envelope,key).toString("utf8") : null;
export const sha256 = (value: Buffer|string) => createHash("sha256").update(value).digest("hex");
export function encryptFilePayload(value: Buffer,masterKey:Buffer){const fileKey=randomBytes(32);return {payload:encryptBytes(value,fileKey),wrappedKey:encryptBytes(fileKey,masterKey)};}
export function decryptFilePayload(payload:Envelope,wrappedKey:Envelope,masterKey:Buffer){const fileKey=decryptBytes(wrappedKey,masterKey);return decryptBytes(payload,fileKey);}
