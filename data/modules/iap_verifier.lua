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
In-App Purchase Verification module.

Using this module, you can check the validity of an Apple or Google IAP receipt.
--]]

local nk = require("nakama")

local M = {}

--[[
Sends a request to the Apple IAP Verification service.

It will first try to validate against Production servers, and if code 21007 is returned, it will retry it with Sandbox servers.

Request object match the following format:
{
  receipt = "", -- base64 encoded receipt data received from client/iOS
  password = "", -- optional. Used to verify auto-renewable subscriptions.
  exclude_old_transactions = true -- optional. Return only the most recent transaction for auto-renewable subscriptions.
}

This function will return a Lua table that represents the data in this page:
https://developer.apple.com/library/archive/releasenotes/General/ValidateAppStoreReceipt/Chapters/ValidateRemotely.html

This function can also raise an error in case of bad network, or invalid receipt data.
--]]
function M.verify_payment_apple(request)
  local url_sandbox = "https://sandbox.itunes.apple.com/verifyReceipt"
  local url_production = "https://buy.itunes.apple.com/verifyReceipt"

  local http_body = nk.json_encode({
    ["receipt-data"] = request.receipt,
    ["password"] = request.password,
    ["exclude-old-transactions"] = request.exclude_old_transactions
  })

  local http_headers = {
    ["Content-Type"] = "application/json",
    ["Accept"] = "application/json"
  }

  local success, code, _, body = pcall(nk.http_request, url_production, "POST", http_headers, http_body)
  if (not success) then
    nk.logger_warn(("Network error occurred: %q"):format(code))
    error(code)
  elseif (code == 200) then
    return nk.json_decode(body)
  elseif (code == 400) then
    local response = nk.json_decode(body)
    if (response.status == 21007) then  -- was supposed to be sent to sandbox
      local success, code, _, body = pcall(nk.http_request, url_sandbox, "POST", http_headers, http_body)
      if (not success) then
        nk.logger_warn(("Network error occurred: %q"):format(code))
        error(code)
      elseif (code == 200) then
        return nk.json_decode(body)
      end
    end
  end
  error(body)
end

function M.google_obtain_access_token(client_email, private_key)
  local auth_url = "https://accounts.google.com/o/oauth2/auth"
  local scope = "https://www.googleapis.com/auth/androidpublisher"
  local exp = nk.time() + 3600000 -- current time + 1hr added in ms
  local iat = nk.time()

  local algo_type = "RS256"

  local jwt_claimset = nk.base64url_encode({
    ["iss"] = client_email,
    ["scope"] = scope,
    ["aud"] = auth_url,
    ["exp"] = exp,
    ["iat"] = iat
  })

  local jwt_token = nk.jwt_generate(algo_type, private_key, jwt_claimset)

  local grant_type = "urn%3ietf%3params%3oauth%3grant-type%3jwt-bearer"
  local form_data = "grant_type=" .. grant_type .. "&assertion=" .. jwt_token
  local http_headers = {["Content-Type"] = "application/x-www-form-urlencoded"}

  local success, code, _, body = pcall(nk.http_request, auth_url, "POST", http_headers, form_data)
  if (not success) then
    nk.logger_warn(("Network error occurred: %q"):format(code))
    error(code)
  elseif (code == 200) then
    return nk.json_decode(body)["access_token"]
  end

  error(body)
end

--[[
Sends a request to the Google IAP Verification service.

It will first try to obtain an access token using the service account provided.

Request object match the following format:
{
  is_subscription = false, -- set to true if it is subscription, otherwise product.
  product_id = "" -- Product ID,
  package_name = "" -- Product Name,
  receipt = "" -- Payment receipt in string format,
  client_email = "", -- Service account client email address. Retrieve this from Service account in JSON format.
  private_key = "", -- Service account private key. Retrieve this from Service account in JSON format.
}

For Products, this function will return a Lua table that represents the data in this page:
https://developers.google.com/android-publisher/api-ref/purchases/products#resource

For Subscritions, this function will return a Lua table that represents the data in this page:
https://developers.google.com/android-publisher/api-ref/purchases/subscriptions

This function can also raise an error in case of bad network, bad authentication or invalid receipt data.
--]]

function M.verify_payment_google(request)
  local success, access_token = pcall(M.google_obtain_access_token, request.client_email, request.private_key)
  if (not success) then
    nk.logger_warn(("Failed to obtain access token: %q"):format(access_token))
    error(access_token)
  end

  local url_template = "https://www.googleapis.com/androidpublisher/v2/applications/%q/purchases/subscriptions/%q/tokens/%q?access_token=%q"
  if (not request.is_subscription) then
    url_template = "https://www.googleapis.com/androidpublisher/v2/applications/%q/purchases/products/%q/tokens/%q?access_token=%q"
  end

  local url = url_template:format(request.package_name, request.product_id, request.receipt, access_token)

  local http_headers = {
    ["Content-Type"] = "application/json",
    ["Accept"] = "application/json"
  }
  local success, code, _, body = pcall(nk.http_request, url, "GET", http_headers, nil)
  if (not success) then
    nk.logger_warn(("Network error occurred: %q"):format(code))
    error(code)
  elseif (code == 200) then
    return nk.json_decode(body)
  end

  error(body)
end

return M
