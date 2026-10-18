import { requireAdmin } from '../../lib/adminAuth.js';
import { sbAdminFetch } from '../../lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'PATCH') {
      const { zone_num, ...data } = req.body || {};
      const zoneNum = parseInt(zone_num, 10);
      if (!Number.isFinite(zoneNum)) return res.status(400).json({ error: 'Missing zone_num' });
      if (data.fee !== undefined) {
        const fee = parseFloat(data.fee);
        if (!Number.isFinite(fee) || fee < 0 || fee > 500) {
          return res.status(400).json({ error: 'Invalid fee' });
        }
        data.fee = fee;
      }
      data.updated_at = new Date().toISOString();
      const updated = await sbAdminFetch(`delivery_zones?zone_num=eq.${zoneNum}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: JSON.stringify(data),
      });
      return res.status(200).json(updated);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
