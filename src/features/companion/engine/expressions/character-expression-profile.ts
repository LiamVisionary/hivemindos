export type CharacterExpressionProfile = 'default' | 'saraTomcat';

export function isSaraTomcatModelUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.toLowerCase();
  return normalized.includes('/tomcat/female-body-a/sara/')
    || normalized.includes('/tomcat/female-body-a/sara-');
}

export function getCharacterExpressionProfileForUrl(
  url: string | null | undefined,
): CharacterExpressionProfile {
  return isSaraTomcatModelUrl(url) ? 'saraTomcat' : 'default';
}
