import { callHttpApi, nakama } from "@nakama/shared";
import type { NakamaSession, NakamaUser } from "@nakama/shared";

export async function authenticateEmail(
  email: string,
  password: string,
  create = false,
): Promise<NakamaSession> {
  return callHttpApi<NakamaSession>(
    `/v2/account/authenticate/email?create=${create}`,
    {
      auth: { type: "server-key" },
      method: "POST",
      body: { email, password },
    },
  );
}

export async function authenticateGuest(): Promise<NakamaSession> {
  const deviceId = crypto.randomUUID();
  return nakama.authenticateDevice(deviceId);
}

export async function fetchAccount(token: string): Promise<NakamaUser> {
  const res = await nakama.getAccount({ auth: { type: "bearer", token } });
  return res.user;
}
