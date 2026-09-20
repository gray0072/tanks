// SPEC §9.2 — the room code *is* the host's PeerJS peer-id (namespaced), so
// joining is a direct connect with no lookup service required.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_LEN = 6;
const PEER_PREFIX = "tanks-";

export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LEN) return false;
  for (const c of code) if (!ALPHABET.includes(c)) return false;
  return true;
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);
}

export function peerIdForRoom(code: string): string {
  return PEER_PREFIX + code;
}

export function roomCodeFromPeerId(peerId: string): string | null {
  if (!peerId.startsWith(PEER_PREFIX)) return null;
  const code = peerId.slice(PEER_PREFIX.length).toUpperCase();
  return isValidRoomCode(code) ? code : null;
}
