/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : tests/webauthn.ts
 * Module           : tests
 * Repository       : https://git.spboucher.ai/sp-music
 * Project Website  : https://music.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";

/**
 * A software WebAuthn authenticator for the tests: real P-256 keys, real signatures, "none" attestation — the
 * server verifies its responses exactly as it verifies a phone's. It can also misbehave on request (wrong origin,
 * corrupted signature) to prove those are rejected.
 */
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

// Minimal CBOR encoder (ints, byte strings, text strings, maps) — enough for an attestation object and a COSE key.
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
type Cbor = number | string | Buffer | Map<Cbor, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...Array.from(v).flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export interface Tamper { origin?: string; badSignature?: boolean; noUserVerification?: boolean; rpId?: string }

export class SoftAuthenticator {
  private creds = new Map<string, { key: KeyObject; counter: number; userHandle: string }>();
  constructor(private origin: string, private rpId: string) {}

  create(options: { challenge: string; user: { id: string } }, t: Tamper = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const credId = randomBytes(16);
    const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
    const authData = Buffer.concat([sha256(t.rpId ?? this.rpId), Buffer.from([t.noUserVerification ? 0x41 : 0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: t.origin ?? this.origin, crossOrigin: false }));
    const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    this.creds.set(b64u(credId), { key: privateKey, counter: 0, userHandle: options.user.id });
    return { id: b64u(credId), rawId: b64u(credId), type: "public-key", authenticatorAttachment: "platform", clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] } };
  }

  get(options: { challenge: string }, credentialId?: string, t: Tamper = {}) {
    const id = credentialId ?? Array.from(this.creds.keys()).pop()!;
    const c = this.creds.get(id)!;
    c.counter++;
    const counter = Buffer.alloc(4); counter.writeUInt32BE(c.counter);
    const authData = Buffer.concat([sha256(t.rpId ?? this.rpId), Buffer.from([t.noUserVerification ? 0x01 : 0x05]), counter]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: t.origin ?? this.origin, crossOrigin: false }));
    const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(clientDataJSON)])).sign(c.key);
    if (t.badSignature) signature[signature.length - 1] ^= 0xff;
    return { id, rawId: id, type: "public-key", authenticatorAttachment: "platform", clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: c.userHandle } };
  }
  get ids() { return Array.from(this.creds.keys()); }
}
