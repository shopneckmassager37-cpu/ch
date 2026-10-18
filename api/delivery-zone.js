import { classifyAddress, getZoneFees } from '../lib/deliveryZones.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const address = (req.query.address || '').trim();
  if (!address) return res.status(400).json({ error: 'Missing address' });

  try {
    const result = await classifyAddress(address);
    if (!result.ok) {
      return res.status(200).json({ ok: false, reason: result.reason, distanceMiles: result.distanceMiles ?? null });
    }
    const fees = await getZoneFees();
    const zone = fees[result.zoneNum];
    if (!zone) return res.status(500).json({ error: 'Zone pricing not configured' });

    return res.status(200).json({
      ok: true,
      zoneNum: result.zoneNum,
      label: zone.label,
      fee: zone.fee,
      distanceMiles: result.distanceMiles !== null && result.distanceMiles !== undefined
        ? Math.round(result.distanceMiles * 10) / 10
        : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
