import { createHmac, timingSafeEqual } from "node:crypto";

export interface Ticket {
  host: string;
  port: number;
  exp: number; // unix seconds
}

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signTicket(ticket: Ticket, secret: string): string {
  const body = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/**
 * A ticket is the only thing that decides where the proxy connects. Without the
 * signature, /play would be an open proxy into the cluster network.
 */
export function verifyTicket(token: string, secret: string, nowSeconds = Date.now() / 1000): Ticket | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const ticket = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
  return ticket.exp > nowSeconds ? ticket : null;
}
