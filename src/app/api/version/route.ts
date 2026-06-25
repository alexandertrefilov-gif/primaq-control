export const dynamic = "force-static";

export function GET() {
  return Response.json({
    app: process.env.NEXT_PUBLIC_APP_VERSION ?? "PrimaQ Control",
    environment: process.env.NODE_ENV ?? "unknown",
    commit: process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown",
    branch: process.env.NEXT_PUBLIC_BUILD_BRANCH ?? "unknown",
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown",
    vercelUrl: process.env.NEXT_PUBLIC_VERCEL_URL || null,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  });
}
