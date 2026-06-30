// QuizVerse pack store — Nakama storage wrapper for question packs.
//
// Packs live in the `quizverse_packs` collection (system-owned). The
// QuizVerseGame.SEED_PACK is the always-available fallback so smoke
// tests run green without any prior pack upload.

namespace QuizVersePackStore {
  export var COLLECTION = "quizverse_packs";

  // Lightweight cache so the generator does not re-read storage on every
  // turn. Cleared by writePack(). Keyed by pack_id; values are deep copies
  // of the stored pack.
  var cache: { [pack_id: string]: QuizVerseGame.IPack } = {};

  export function readPack(nk: nkruntime.Nakama, packId: string): QuizVerseGame.IPack {
    if (!packId) packId = QuizVerseGame.DefaultInit.pack_id;
    if (cache[packId]) return cache[packId];

    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{ collection: COLLECTION, key: packId, userId: Constants.SYSTEM_USER_ID }]);
    } catch (_e) {
      rows = [];
    }
    if (rows && rows.length > 0 && rows[0].value) {
      var pack = rows[0].value as QuizVerseGame.IPack;
      if (pack && pack.questions && pack.questions.length > 0) {
        cache[packId] = pack;
        return pack;
      }
    }
    if (packId === QuizVerseGame.DefaultInit.pack_id) {
      cache[packId] = QuizVerseGame.SEED_PACK;
      return QuizVerseGame.SEED_PACK;
    }
    // Caller asked for a non-default pack that does not exist; surface a
    // clear error so the create_match RPC can return INVALID_ARGUMENT
    // rather than silently falling back (which masks content bugs).
    throw new Error("quizverse pack not found: " + packId);
  }

  // Admin-only — invalidate cache after a fresh CMS push.
  export function writePack(nk: nkruntime.Nakama, pack: QuizVerseGame.IPack): void {
    if (!pack || !pack.pack_id || !pack.questions || pack.questions.length === 0) {
      throw new Error("invalid pack");
    }
    nk.storageWrite([
      {
        collection: COLLECTION,
        key:        pack.pack_id,
        userId:     Constants.SYSTEM_USER_ID,
        value:      pack as any,
        permissionRead:  2, // public read
        permissionWrite: 0  // admin only
      }
    ]);
    delete cache[pack.pack_id];
  }
}
