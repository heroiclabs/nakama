namespace HttpClient {

  export interface HttpResponse {
    code: number;
    body: string;
    headers: any;
  }

  export function get(nk: nkruntime.Nakama, url: string, headers?: { [key: string]: string }): HttpResponse {
    var resp = nk.httpRequest(url, "get", headers || {}, "");
    return { code: resp.code, body: resp.body, headers: resp.headers || {} };
  }

  export function post(nk: nkruntime.Nakama, url: string, body: string, headers?: { [key: string]: string }): HttpResponse {
    var hdrs = headers || {};
    if (!hdrs["Content-Type"]) {
      hdrs["Content-Type"] = "application/json";
    }
    var resp = nk.httpRequest(url, "post", hdrs, body);
    return { code: resp.code, body: resp.body, headers: resp.headers || {} };
  }

  export function postJson(nk: nkruntime.Nakama, url: string, data: any, headers?: { [key: string]: string }): any {
    var resp = post(nk, url, JSON.stringify(data), headers);
    if (resp.code >= 200 && resp.code < 300) {
      try {
        return JSON.parse(resp.body);
      } catch (_) {
        return resp.body;
      }
    }
    throw new Error("HTTP " + resp.code + ": " + resp.body);
  }

  export function signedPost(nk: nkruntime.Nakama, url: string, data: any, secret: string, additionalHeaders?: { [key: string]: string }): any {
    var body = JSON.stringify(data);
    var signatureBytes = nk.hmacSha256Hash(secret, body);
    var signature = nk.binaryToString(signatureBytes);
    var headers: { [key: string]: string } = {
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature
    };
    if (additionalHeaders) {
      for (var k in additionalHeaders) {
        headers[k] = additionalHeaders[k];
      }
    }
    return postJson(nk, url, data, headers);
  }
}
