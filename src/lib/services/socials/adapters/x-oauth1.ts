import { createHmac, randomBytes } from "node:crypto";

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function xOAuth1Authorization(input: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  nonce?: string;
  timestamp?: string;
}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce ?? randomBytes(18).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_token: input.accessToken,
    oauth_version: "1.0",
  };
  const target = new URL(input.url);
  const pairs: Array<[string, string]> = [...target.searchParams.entries(), ...Object.entries(oauth)];
  pairs.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = encode(leftKey).localeCompare(encode(rightKey));
    return keyOrder || encode(leftValue).localeCompare(encode(rightValue));
  });
  const parameterString = pairs.map(([key, value]) => `${encode(key)}=${encode(value)}`).join("&");
  const baseUrl = `${target.protocol}//${target.host}${target.pathname}`;
  const signatureBase = [input.method.toUpperCase(), encode(baseUrl), encode(parameterString)].join("&");
  const signingKey = `${encode(input.consumerSecret)}&${encode(input.accessTokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");
  return `OAuth ${Object.entries(oauth)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ")}`;
}
