import { VersionRuntime } from "./version-runtime";

export const dynamic = "force-static";

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 text-sm">
      <span className="w-24 shrink-0 text-black/40">{label}</span>
      <span className={mono ? "font-mono text-xs text-black/80" : "text-black/80"}>{value}</span>
    </div>
  );
}

export default function VersionPage() {
  const commit = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown";
  const branch = process.env.NEXT_PUBLIC_BUILD_BRANCH ?? "unknown";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown";
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL || null;
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "PrimaQ Control";
  const environment = process.env.NODE_ENV ?? "unknown";

  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-6 text-xl font-bold text-black/80">Version / Build Info</h1>

      <div className="divide-y divide-black/6 rounded-2xl border border-black/8 bg-white shadow-sm">
        <InfoRow label="App" value={appVersion} />
        <InfoRow label="Umgebung" value={environment} />
        <InfoRow label="Commit" value={commit} mono />
        <InfoRow label="Branch" value={branch} mono />
        <InfoRow label="Build-Zeit" value={buildTime} />
        {vercelUrl && <InfoRow label="Vercel URL" value={vercelUrl} />}
      </div>

      <VersionRuntime />
    </div>
  );
}
