import { publicOrigin } from '../../lib/http';

/** TON Connect's manifest: who's asking the wallet (this site), for the wallet page. */
export function GET(request: Request) {
  const origin = publicOrigin(request);
  return Response.json({ url: origin, name: 'Yieldfield', iconUrl: `${origin}/icon.png` }, { headers: { 'access-control-allow-origin': '*' } });
}
