// Canonical error builders. Every template emits errors via these helpers
// so the wire shape stays uniform and the conformance suite (Pillar 8 +
// 10) has one schema to verify against.

namespace MpKernelError {
  export function build(
    code: number,
    detail?: string,
    retryAfterMs?: number,
    minRequiredVersion?: string
  ): MpKernel.IError {
    var e: MpKernel.IError = { code: code };
    if (detail) e.detail = detail;
    if (retryAfterMs && retryAfterMs > 0) e.retry_after_ms = retryAfterMs;
    if (minRequiredVersion) e.min_required_version = minRequiredVersion;
    return e;
  }

  export function send(
    dispatcher: nkruntime.MatchDispatcher,
    target: nkruntime.Presence | null,
    matchId: string,
    senderUserId: string,
    seqProvider: { next: () => number },
    matchTimeMs: number,
    err: MpKernel.IError
  ): void {
    var env: MpKernel.IEnvelope<MpKernel.IError> = {
      h: {
        wire_version: 1,
        op: MpKernel.KernelOp.ERROR,
        seq: seqProvider.next(),
        match_time_ms: matchTimeMs,
        sender_user_id: senderUserId,
        match_id: matchId,
        client_opcode_uuid: ""
      },
      p: err
    };
    var bytes = JSON.stringify(env);
    if (target) {
      dispatcher.broadcastMessage(MpKernel.KernelOp.ERROR, bytes, [target]);
    } else {
      dispatcher.broadcastMessage(MpKernel.KernelOp.ERROR, bytes);
    }
  }

  // Convenience for common errors with detail interpolation.
  export function badPayload(detail: string): MpKernel.IError {
    return build(MpKernel.ErrorCode.BAD_PAYLOAD, detail);
  }
  export function unknownOpcode(op: number): MpKernel.IError {
    return build(MpKernel.ErrorCode.UNKNOWN_OPCODE, "op=0x" + op.toString(16));
  }
  export function rateLimited(retryAfterMs: number): MpKernel.IError {
    return build(MpKernel.ErrorCode.RATE_LIMITED, "rate-limited", retryAfterMs);
  }
  export function notAuthorized(detail: string): MpKernel.IError {
    return build(MpKernel.ErrorCode.NOT_AUTHORIZED, detail);
  }
  export function matchEnded(reason: string): MpKernel.IError {
    return build(MpKernel.ErrorCode.MATCH_ENDED, reason);
  }
  export function clockSkewExtreme(skewMs: number): MpKernel.IError {
    return build(MpKernel.ErrorCode.CLOCK_SKEW_EXTREME, "skew_ms=" + skewMs);
  }
  export function schemaTooOld(minRequired: string): MpKernel.IError {
    return build(MpKernel.ErrorCode.SCHEMA_TOO_OLD, undefined, undefined, minRequired);
  }
  export function flapping(banSeconds: number): MpKernel.IError {
    return build(MpKernel.ErrorCode.FLAPPING, "soft-banned", banSeconds * 1000);
  }
  export function persistenceDegraded(detail: string): MpKernel.IError {
    return build(MpKernel.ErrorCode.PERSISTENCE_DEGRADED, detail);
  }
}
