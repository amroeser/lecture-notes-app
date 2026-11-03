import { errorResponse, parseSeries, saveSeries } from '@/lib/library/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Stores the compiled series Markdown and its guardrail report. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const course = await saveSeries(id, parseSeries(await req.json()));
    return Response.json({ updatedAt: course.updatedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
