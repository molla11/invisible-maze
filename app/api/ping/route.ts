export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store"
};

export async function HEAD() {
  return new Response(null, { headers, status: 204 });
}

export async function GET(request: Request) {
  return Response.json(
    {
      region: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? null,
      vercelId: request.headers.get("x-vercel-id")
    },
    { headers }
  );
}
