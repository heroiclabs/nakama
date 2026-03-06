namespace Storage {

  export function readJson<T>(nk: nkruntime.Nakama, collection: string, key: string, userId: string): T | null {
    var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
      return records[0].value as T;
    }
    return null;
  }

  export function writeJson(nk: nkruntime.Nakama, collection: string, key: string, userId: string, value: any, permissionRead?: nkruntime.ReadPermissionValues, permissionWrite?: nkruntime.WritePermissionValues): void {
    nk.storageWrite([{
      collection: collection,
      key: key,
      userId: userId,
      value: value,
      permissionRead: permissionRead !== undefined ? permissionRead : 1 as nkruntime.ReadPermissionValues,
      permissionWrite: permissionWrite !== undefined ? permissionWrite : 1 as nkruntime.WritePermissionValues
    }]);
  }

  export function writeSystemJson(nk: nkruntime.Nakama, collection: string, key: string, value: any): void {
    nk.storageWrite([{
      collection: collection,
      key: key,
      userId: Constants.SYSTEM_USER_ID,
      value: value,
      permissionRead: 2 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
  }

  export function readSystemJson<T>(nk: nkruntime.Nakama, collection: string, key: string): T | null {
    return readJson<T>(nk, collection, key, Constants.SYSTEM_USER_ID);
  }

  export function deleteRecord(nk: nkruntime.Nakama, collection: string, key: string, userId: string): void {
    nk.storageDelete([{ collection: collection, key: key, userId: userId }]);
  }

  export function readMultiple(nk: nkruntime.Nakama, reads: nkruntime.StorageReadRequest[]): nkruntime.StorageObject[] {
    return nk.storageRead(reads) || [];
  }

  export function writeMultiple(nk: nkruntime.Nakama, writes: nkruntime.StorageWriteRequest[]): void {
    if (writes.length > 0) {
      nk.storageWrite(writes);
    }
  }

  export function listUserRecords(nk: nkruntime.Nakama, collection: string, userId: string, limit?: number, cursor?: string): { records: nkruntime.StorageObject[]; cursor: string } {
    var result = nk.storageList(userId, collection, limit || 100, cursor);
    return {
      records: result.objects || [],
      cursor: result.cursor || ""
    };
  }

  function rpcStorageWrite(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.collection || !data.key) return RpcHelpers.errorResponse("collection and key required");

    var targetUserId = data.user_id || userId;
    var value = typeof data.value === "string" ? JSON.parse(data.value) : (data.value || {});
    var permRead = (data.permission_read !== undefined ? data.permission_read : 1) as nkruntime.ReadPermissionValues;
    var permWrite = (data.permission_write !== undefined ? data.permission_write : 1) as nkruntime.WritePermissionValues;

    var acks = nk.storageWrite([{
      collection: data.collection,
      key: data.key,
      userId: targetUserId,
      value: value,
      permissionRead: permRead,
      permissionWrite: permWrite
    }]);

    return RpcHelpers.successResponse({
      version: acks && acks.length > 0 ? acks[0].version : ""
    });
  }

  function rpcStorageRead(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.collection || !data.key) return RpcHelpers.errorResponse("collection and key required");

    var targetUserId = data.user_id || userId;
    var records = nk.storageRead([{
      collection: data.collection,
      key: data.key,
      userId: targetUserId
    }]);

    if (records && records.length > 0) {
      return RpcHelpers.successResponse({
        value: records[0].value,
        version: records[0].version || ""
      });
    }
    return RpcHelpers.successResponse({ value: null, version: "" });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("storage_write", rpcStorageWrite);
    initializer.registerRpc("storage_read", rpcStorageRead);
  }
}
