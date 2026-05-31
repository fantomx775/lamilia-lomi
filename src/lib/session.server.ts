import { cookies } from "next/headers";

import { parseDemoSession, serializeDemoSession } from "./auth";
import type { DemoSession } from "./types";

export const demoSessionCookie = "ll_demo_session";

export async function getDemoSession() {
  const cookieStore = await cookies();

  return parseDemoSession(cookieStore.get(demoSessionCookie)?.value);
}

export async function setDemoSession(session: DemoSession) {
  const cookieStore = await cookies();

  cookieStore.set(demoSessionCookie, serializeDemoSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function clearDemoSession() {
  const cookieStore = await cookies();

  cookieStore.delete(demoSessionCookie);
}
