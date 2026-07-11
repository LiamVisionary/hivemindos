export type UserSlashCommandDisplay = Readonly<{
  name: string;
  suffix: string;
}>;

const LEADING_SLASH_COMMAND_PATTERN =
  /^\/([a-z0-9][a-z0-9_-]*)(?=$|\s)([\s\S]*)$/i;

export function parseUserSlashCommandDisplay(
  text: string,
): UserSlashCommandDisplay | null {
  const match = LEADING_SLASH_COMMAND_PATTERN.exec(text);
  if (!match) return null;

  return {
    name: match[1],
    suffix: match[2],
  };
}
