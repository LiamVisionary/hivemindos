import { homedir as nodeHomedir } from "os";

/**
 * os.homedir() behind an indirection that Next's bundled @vercel/nft cannot
 * statically evaluate during `next build`. nft's evaluator models the real
 * `os` module, so a resolvable homedir() turns every
 * `join(homedir(), <dynamic>)` in traced server code into an emitted
 * asset-directory glob over the whole user profile. That walk EPERMs on
 * protected Windows junctions (Cookies, Application Data) and fails the
 * production build, and silently globs the entire home directory during
 * builds on macOS/Linux.
 *
 * Server code should import { homedir } from "@/lib/home-dir" instead of
 * "os"; the call sites stay identical.
 */
export function homedir(): string {
  return [nodeHomedir].map((resolve) => resolve())[0] as string;
}
