// Reserved opcode registry — validates that no two templates / services
// claim overlapping ranges, and provides a quick lookup for diagnostics.
//
// Used at module init time by `MpKernelMatch.register*` to catch
// developer mistakes early rather than at runtime when the conflict
// causes silent message-drop.

namespace MpKernelCodeRegistry {
  export interface IRangeOwner {
    name: string;
    from: number;
    to: number;
    template_id?: string; // For templates only.
  }

  var owners: IRangeOwner[] = [];

  export function register(owner: IRangeOwner): void {
    for (var i = 0; i < owners.length; i++) {
      var o = owners[i];
      if (o.name === owner.name) {
        // Idempotent re-registration (e.g. test reload): replace.
        owners[i] = owner;
        return;
      }
      if (rangesOverlap(o, owner)) {
        throw new Error(
          "[MpKernelCodeRegistry] range overlap: '" + owner.name +
          "' (0x" + owner.from.toString(16) + "-0x" + owner.to.toString(16) +
          ") overlaps '" + o.name +
          "' (0x" + o.from.toString(16) + "-0x" + o.to.toString(16) + ")"
        );
      }
    }
    owners.push(owner);
  }

  function rangesOverlap(a: IRangeOwner, b: IRangeOwner): boolean {
    return a.from <= b.to && b.from <= a.to;
  }

  // Find the registered range that owns this opcode, if any. Used in
  // unknown-opcode diagnostics and admin tooling.
  export function findOwner(op: number): IRangeOwner | null {
    for (var i = 0; i < owners.length; i++) {
      var o = owners[i];
      if (op >= o.from && op <= o.to) return o;
    }
    return null;
  }

  export function listAll(): IRangeOwner[] {
    return owners.slice();
  }

  // Bootstraps the well-known kernel + service ranges so registering
  // a template into a conflicting range fails fast.
  export function bootstrapKernelRanges(): void {
    if (owners.length > 0) return;
    // Mirrors the canonical proto reservations in
    // schemas/multiplayer/opcodes.proto. Template ranges register
    // themselves on registerTemplate; ranges below are pre-claimed so
    // any accidental overlap fails fast at module init.
    register({ name: "kernel-control",          from: 0x0000, to: 0x0FFF });
    register({ name: "social-conversational",   from: 0x1000, to: 0x1FFF });
    register({ name: "agents",                  from: 0x2000, to: 0x2FFF });
    register({ name: "moderation",              from: 0x3000, to: 0x3FFF });
    register({ name: "game-defined",            from: 0xC000, to: 0xCFFF });
    register({ name: "xr-pose-fast-path",       from: 0xF000, to: 0xFFFF });
  }
}
