import StaticNativeHome from "@/app/StaticNativeHome";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const isStaticNativeBuild = process.env.HIVEMINDOS_TAURI_STATIC_BUILD === "1";

export default async function Home(props: HomeProps) {
  if (isStaticNativeBuild) return <StaticNativeHome />;

  const { default: DashboardServerHome } = await import("@/app/DashboardServerHome");
  return <DashboardServerHome {...props} />;
}
