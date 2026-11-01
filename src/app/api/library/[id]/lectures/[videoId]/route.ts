import { errorResponse, parseLecture, upsertLecture } from '@/lib/library/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; videoId: string }> };

/** Creates or replaces the stored result of one lecture. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id, videoId } = await ctx.params;
    const lecture = parseLecture(videoId, await req.json());
    const course = await upsertLecture(id, lecture);
    return Response.json({ lecture, updatedAt: course.updatedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
