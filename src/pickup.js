// No se exportan secretos ni snapshots al motor: sólo la ubicación de la empresa.
export async function getPickup(db, company) {
  const {rows} = await db.query(
    'SELECT address FROM panel_pickup_settings WHERE company_id=$1', [company.company_id]);
  return {companyId: company.company_id,
    address: rows.length ? rows[0].address : String(company.config?.DIRECCION || '').trim()};
}
export async function savePickup(db, companyId, address) {
  await db.query(`INSERT INTO panel_pickup_settings(company_id,address) VALUES($1,$2)
    ON CONFLICT(company_id) DO UPDATE SET address=EXCLUDED.address, updated_at=NOW()`,
    [companyId, String(address || '').trim()]);
}
