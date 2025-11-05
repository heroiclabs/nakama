--[[
 Copyright 2019 The Nakama Authors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
--]]

--[[
Client RPC calls to validate receipt with Apple or Google.
--]]

local nk = require("nakama")
local iap = require("iap_verifier")

--[[
This function expects the following information to come from Runtime environment variables:
"password" -- Shares secret password obtained from Apple.

Client must send through the following information:
{
  receipt = "" -- base64 encoded receipt information
}

The response object will be:
{
  "success": true
  "result": {}
}

or in case of an error:
{
  "success": false
  "error": ""
}

This function will return result that represents the data in this page:
https://developer.apple.com/library/archive/releasenotes/General/ValidateAppStoreReceipt/Chapters/ValidateRemotely.html

--]]
local function apple_verify_payment(context, payload)
  -- In-App Purchase Shared Secret required to verify auto-renewable subscriptions.
  local password = context.env["iap_apple_password"]

  local json_payload = nk.json_decode(payload)
  local receipt = json_payload.receipt

  local success, result = pcall(iap.verify_payment_apple, {
    receipt = receipt,
    password = password,
    exclude_old_transactions = true
  })

  if (not success) then
    nk.logger_warn(string.format("Apple IAP verification failed - request: %q - response: %q", payload, result))
    return nk.json_encode({
      ["success"] = false,
      ["error"] = result
    })
  else
    nk.logger_info(string.format("Apple IAP verification completed - request: %q - response: %q", payload, result))
    return nk.json_encode({
      ["success"] = true,
      ["result"] = result
    })
  end
end
nk.register_rpc(apple_verify_payment, "iap.apple_verify_payment")

--[[
This function expects the following information to come from Runtime environment variables:
"iap_google_service_account" -- Base64 encoded JSON file.

Client must send through the following information:
{
  product_id = "",
  package_name = "",
  purchase_token = "",
  is_subscription = false
}

The response object will be:
{
  "success": true
  "result": {}
}

or in case of an error:
{
  "success": false
  "error": ""
}

For Products, this function will return result that represents the data in this page:
https://developers.google.com/android-publisher/api-ref/purchases/products#resource

For Subscritions, this function will return result that represents the data in this page:
https://developers.google.com/android-publisher/api-ref/purchases/subscriptions
--]]

local function google_verify_payment(context, payload)
  -- Google API Service Account JSON key file in base64.
  local service_account = nk.json_decode(nk.base64_decode(context.env["iap_google_service_account"]))

  local json_payload = nk.json_decode(payload)
  local product_id = json_payload.product_id
  local package_name = json_payload.package_name
  local is_subscription = json_payload.is_subscription
  local purchase_token = json_payload.purchase_token

  local success, result = pcall(iap.verify_payment_google, {
    is_subscription = is_subscription,
    product_id = product_id,
    package_name = package_name,
    purchase_token = purchase_token,
    client_email = service_account["client_email"],
    private_key = service_account["private_key"],
  })

  if (not success) then
    nk.logger_warn(string.format("Google IAP verification failed - request: %q - response: %q", payload, result))
    return nk.json_encode({
      ["success"] = false,
      ["error"] = result
    })
  else
    nk.logger_info(string.format("Google IAP verification completed - request: %q - response: %q", payload, result))
    return nk.json_encode({
      ["success"] = true,
      ["result"] = result
    })
  end
end
nk.register_rpc(google_verify_payment, "iap.google_verify_payment")
