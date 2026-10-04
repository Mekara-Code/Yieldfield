import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authenticate } from '../../../../../lib/auth';
import { json, problem } from '../../../../../lib/http';
import { isAdmin } from '../../../../../lib/players';
import { storageOptions } from '../../../../../lib/releases';

export const runtime = 'nodejs';

/**
 * Vercel Blob's client uploads: the admin's browser asks here for a token, then sends the APK straight to
 * Blob storage (in parts), so its size doesn't matter to this server. Publishing it is a POST to
 * /api/admin/releases afterwards, with the address Blob gave.
 */
export async function POST(request: Request) {
  if (!storageOptions().blob) {
    return problem(400, 'No Vercel Blob store is connected to this project');
  }
  const body = (await request.json()) as HandleUploadBody;
  // Asking for a token comes with the admin's Authorization header; Blob's own call when it's done doesn't.
  if (body.type === 'blob.generate-client-token') {
    const claims = await authenticate(request);
    if (!(await isAdmin(claims))) {
      return problem(403, 'Admins only');
    }
  }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/vnd.android.package-archive', 'application/octet-stream'],
        maximumSizeInBytes: 2_000_000_000,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {},
    });
    return json(result);
  } catch (error) {
    return problem(400, (error as Error).message);
  }
}
