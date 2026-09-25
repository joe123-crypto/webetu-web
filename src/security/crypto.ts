import crypto from "node:crypto";
import { config, requireConfig } from "@/src/config";
import { httpError } from "@/src/lib/utils";

export function deriveEncryptionKey() {
  requireConfig(["tokenEncryptionSecret"]);
  return crypto.createHash("sha256").update(config.tokenEncryptionSecret).digest();
}

export function encryptJson(value: any) {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify(value);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}

export function decryptJson(record: any) {
  if (!record || !record.iv || !record.ciphertext || !record.authTag) return null;
  const key = deriveEncryptionKey();
  const iv = Buffer.from(record.iv, "base64url");
  const ciphertext = Buffer.from(record.ciphertext, "base64url");
  const authTag = Buffer.from(record.authTag, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    const jsonStr = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("Failed to decrypt tokens:", err);
    return null;
  }
}

export function centralEncryptionKey() {
  requireConfig(["centralDataEncryptionSecret"]);
  return crypto.createHash("sha256").update(config.centralDataEncryptionSecret).digest();
}

export function encryptCentralSecret(value: any, aad = "") {
  const key = centralEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const payload = JSON.stringify(value);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    keyVersion: config.centralDataKeyVersion,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: authTag.toString("base64url"),
    aad: aad ? Buffer.from(aad, "utf8").toString("base64url") : undefined,
  };
}

export function decryptCentralSecret(record: any, aad = "") {
  if (!record || !record.iv || !record.ciphertext || !record.authTag) return null;
  const key = centralEncryptionKey();
  const iv = Buffer.from(record.iv, "base64url");
  const ciphertext = Buffer.from(record.ciphertext, "base64url");
  const authTag = Buffer.from(record.authTag, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const effectiveAad = aad || (record.aad ? Buffer.from(record.aad, "base64url").toString("utf8") : "");
  if (effectiveAad) decipher.setAAD(Buffer.from(effectiveAad, "utf8"));
  try {
    const jsonStr = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("Failed to decrypt central secret:", err);
    return null;
  }
}

export function signState(payload: any) {
  requireConfig(["oauthStateSecret"]);
  const secret = config.oauthStateSecret;
  const text = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(text).digest("base64url");
  return `${Buffer.from(text, "utf8").toString("base64url")}.${signature}`;
}

export function verifyState(state: string) {
  requireConfig(["oauthStateSecret"]);
  const secret = config.oauthStateSecret;
  const [b64Payload, signature] = String(state || "").split(".");
  if (!b64Payload || !signature) throw httpError(400, "Invalid state parameter.");
  const text = Buffer.from(b64Payload, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(text).digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw httpError(400, "State signature mismatch.");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw httpError(400, "Invalid state payload.");
  }
}
