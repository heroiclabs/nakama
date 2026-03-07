namespace SatoriTaxonomy {

  interface EventSchema {
    name: string;
    description?: string;
    category?: string;
    requiredMetadata?: string[];
    optionalMetadata?: string[];
    metadataTypes?: { [key: string]: "string" | "number" | "boolean" };
    maxMetadataKeys?: number;
    deprecated?: boolean;
  }

  interface TaxonomyConfig {
    schemas: { [eventName: string]: EventSchema };
    enforceStrict: boolean;
    maxEventNameLength: number;
    maxMetadataValueLength: number;
    allowedCategories: string[];
  }

  var DEFAULT_CONFIG: TaxonomyConfig = {
    schemas: {},
    enforceStrict: false,
    maxEventNameLength: 128,
    maxMetadataValueLength: 1024,
    allowedCategories: ["engagement", "monetization", "progression", "social", "system", "custom"]
  };

  function getConfig(nk: nkruntime.Nakama): TaxonomyConfig {
    return ConfigLoader.loadSatoriConfig<TaxonomyConfig>(nk, "taxonomy", DEFAULT_CONFIG);
  }

  export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
  }

  export function validateEvent(nk: nkruntime.Nakama, event: Satori.CapturedEvent): ValidationResult {
    var config = getConfig(nk);
    var errors: string[] = [];
    var warnings: string[] = [];

    if (!event.name) {
      errors.push("Event name is required");
      return { valid: false, errors: errors, warnings: warnings };
    }

    if (event.name.length > config.maxEventNameLength) {
      errors.push("Event name exceeds max length of " + config.maxEventNameLength);
    }

    var schema = config.schemas[event.name];

    if (!schema && config.enforceStrict) {
      errors.push("Unknown event '" + event.name + "' (strict mode enabled)");
      return { valid: false, errors: errors, warnings: warnings };
    }

    if (!schema) {
      warnings.push("No schema defined for event '" + event.name + "'");
      return { valid: errors.length === 0, errors: errors, warnings: warnings };
    }

    if (schema.deprecated) {
      warnings.push("Event '" + event.name + "' is deprecated");
    }

    if (schema.requiredMetadata && event.metadata) {
      for (var i = 0; i < schema.requiredMetadata.length; i++) {
        var reqKey = schema.requiredMetadata[i];
        if (event.metadata[reqKey] === undefined || event.metadata[reqKey] === null) {
          errors.push("Missing required metadata key: " + reqKey);
        }
      }
    } else if (schema.requiredMetadata && schema.requiredMetadata.length > 0 && !event.metadata) {
      errors.push("Metadata required but not provided");
    }

    if (event.metadata) {
      var metaKeys = Object.keys(event.metadata);
      if (schema.maxMetadataKeys && metaKeys.length > schema.maxMetadataKeys) {
        errors.push("Too many metadata keys: " + metaKeys.length + " (max " + schema.maxMetadataKeys + ")");
      }

      for (var j = 0; j < metaKeys.length; j++) {
        var val = event.metadata[metaKeys[j]];
        if (val && val.length > config.maxMetadataValueLength) {
          errors.push("Metadata value for '" + metaKeys[j] + "' exceeds max length");
        }

        if (schema.metadataTypes && schema.metadataTypes[metaKeys[j]]) {
          var expectedType = schema.metadataTypes[metaKeys[j]];
          if (expectedType === "number" && isNaN(parseFloat(val))) {
            errors.push("Metadata '" + metaKeys[j] + "' should be a number");
          }
          if (expectedType === "boolean" && val !== "true" && val !== "false") {
            errors.push("Metadata '" + metaKeys[j] + "' should be 'true' or 'false'");
          }
        }
      }
    }

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  function rpcGetSchemas(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var config = getConfig(nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    if (data.category) {
      var filtered: { [k: string]: EventSchema } = {};
      for (var name in config.schemas) {
        if (config.schemas[name].category === data.category) filtered[name] = config.schemas[name];
      }
      return RpcHelpers.successResponse({ schemas: filtered, category: data.category });
    }

    return RpcHelpers.successResponse({
      schemas: config.schemas,
      enforceStrict: config.enforceStrict,
      categories: config.allowedCategories,
      totalSchemas: Object.keys(config.schemas).length
    });
  }

  function rpcUpsertSchema(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required");

    var config = getConfig(nk);
    config.schemas[data.name] = {
      name: data.name,
      description: data.description || "",
      category: data.category || "custom",
      requiredMetadata: data.requiredMetadata || [],
      optionalMetadata: data.optionalMetadata || [],
      metadataTypes: data.metadataTypes || {},
      maxMetadataKeys: data.maxMetadataKeys || 50,
      deprecated: data.deprecated || false
    };

    ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
    return RpcHelpers.successResponse({ schema: config.schemas[data.name] });
  }

  function rpcDeleteSchema(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required");

    var config = getConfig(nk);
    delete config.schemas[data.name];
    ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
    return RpcHelpers.successResponse({ deleted: data.name });
  }

  function rpcValidateEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required");

    var result = validateEvent(nk, { name: data.name, timestamp: Math.floor(Date.now() / 1000), metadata: data.metadata });
    return RpcHelpers.successResponse(result);
  }

  function rpcSetStrictMode(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = getConfig(nk);
    config.enforceStrict = !!data.enforceStrict;
    ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
    return RpcHelpers.successResponse({ enforceStrict: config.enforceStrict });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_taxonomy_schemas", rpcGetSchemas);
    initializer.registerRpc("satori_taxonomy_upsert", rpcUpsertSchema);
    initializer.registerRpc("satori_taxonomy_delete", rpcDeleteSchema);
    initializer.registerRpc("satori_taxonomy_validate", rpcValidateEvent);
    initializer.registerRpc("satori_taxonomy_strict_mode", rpcSetStrictMode);
  }
}
