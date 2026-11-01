import { createCourse, errorResponse, listCourses } from '@/lib/library/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ courses: await listCourses() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const title = body && typeof body === 'object' ? (body as { title?: unknown }).title : undefined;
    const course = await createCourse(title);
    return Response.json({ course }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
