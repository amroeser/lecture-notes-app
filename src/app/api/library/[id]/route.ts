import { deleteCourse, errorResponse, getCourse, renameCourse } from '@/lib/library/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return Response.json({ course: await getCourse(id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body: unknown = await req.json();
    const title = body && typeof body === 'object' ? (body as { title?: unknown }).title : undefined;
    return Response.json({ course: await renameCourse(id, title) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteCourse(id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
