// SPEC §9.2 — the room code *is* the host's PeerJS peer-id (namespaced), so
// joining is a direct connect with no lookup service required.
//
// Two alphabets on purpose. A code the game *generates* avoids the characters
// people confuse when reading one out (`0/O`, `1/I/L`), because that code is
// going to be dictated over a voice call. A code the host *chooses* — the
// point of which is that it reads like a word (`SERGEY`) and survives a
// refresh, so friends can keep one invite link — is accepted with the whole
// alphabet: the ambiguity is then the author's own call, and refusing their
// name because it contains an `I` would be pedantry.

const GENERATED_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const ACCEPTED = /^[A-Z0-9]+$/;
const GENERATED_LEN = 6;
export const CODE_MIN_LEN = 3;
export const CODE_MAX_LEN = 12;
const PEER_PREFIX = "tanks-";

export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < GENERATED_LEN; i++) {
    out += GENERATED_ALPHABET[Math.floor(Math.random() * GENERATED_ALPHABET.length)];
  }
  return out;
}

/** Whether a code can be hosted or joined. Any 3–12 characters of `A-Z0-9`,
 *  which is every code the game generates plus anything a host may have
 *  picked for themselves. */
export function isValidRoomCode(code: string): boolean {
  return code.length >= CODE_MIN_LEN && code.length <= CODE_MAX_LEN && ACCEPTED.test(code);
}

/** Upper case, punctuation and spaces dropped, nothing truncated. Lets
 *  `sergey`, `Sergey` and `k7qm-2x` all arrive as the code they obviously
 *  mean, while leaving an over-long one *visibly* over-long. */
export function cleanRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** What a code *typed into a field* becomes — cleaned and capped, since the
 *  field can't accept more than a code may hold anyway.
 *
 *  Deliberately not used on an invite link: silently cutting a link's code
 *  down to the limit would send the guest to a different room than the link
 *  named. A link that doesn't hold a valid code is not a link to anywhere
 *  (see `deepLinkRoute`). */
export function normalizeRoomCode(input: string): string {
  return cleanRoomCode(input).slice(0, CODE_MAX_LEN);
}

export function peerIdForRoom(code: string): string {
  return PEER_PREFIX + code;
}

export function roomCodeFromPeerId(peerId: string): string | null {
  if (!peerId.startsWith(PEER_PREFIX)) return null;
  const code = peerId.slice(PEER_PREFIX.length).toUpperCase();
  return isValidRoomCode(code) ? code : null;
}
