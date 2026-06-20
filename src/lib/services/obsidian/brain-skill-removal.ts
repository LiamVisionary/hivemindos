import { cp, mkdir, rm } from "fs/promises";
import { dirname, join, resolve } from "path";
import {
  getBrainSkillInventory,
  writeSkillsReadme,
  type BrainSkillInventory,
} from "@/lib/services/obsidian/brain-skills";

function archiveSlug(slug: string) {
  return slug.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function assertInsideSkillsFolder(skillsFolder: string, skillDir: string) {
  const root = resolve(skillsFolder);
  const target = resolve(skillDir);
  if (target === root || !target.startsWith(`${root}/`) || target.includes(`${root}/.archive/`)) {
    throw new Error("Refusing to remove a path outside the active shared skills folder.");
  }
  return target;
}

export async function removeSharedBrainSkill(input: {
  vaultPath?: string;
  slug: string;
}): Promise<BrainSkillInventory & { removed: string; archivedPath: string }> {
  const before = await getBrainSkillInventory(input.vaultPath);
  const slug = input.slug.trim();
  if (!slug) throw new Error("Choose a shared skill to remove.");
  const skill = before.shared.find((item) => item.slug === slug);
  if (!skill) throw new Error(`Could not find shared skill "${slug}".`);

  const skillDir = assertInsideSkillsFolder(before.skillsFolder, dirname(skill.path));
  const archivedPath = join(before.skillsFolder, ".archive", `${archiveSlug(slug)}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(dirname(archivedPath), { recursive: true });
  await cp(skillDir, archivedPath, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter: (path) => !path.split("/").some((part) => part === ".git" || part === "node_modules"),
  });
  await rm(skillDir, { recursive: true, force: true });

  const after = await getBrainSkillInventory(input.vaultPath);
  await writeSkillsReadme(after);
  return { ...after, removed: slug, archivedPath };
}
