import { notFoundOnCloudflare } from '../../api/cloudflare';

// Unknown /api/* paths get a JSON 404 instead of the SPA's index.html.
export const onRequest = notFoundOnCloudflare;
