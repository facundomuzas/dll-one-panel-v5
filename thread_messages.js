import {dateMs,formatDateAr} from "./dates.js";
const normalizeState=value=>String(value || "").trim().toUpperCase();
export function mergeThreadMessages(snapshotMessages, runtimeMessages) {
  const combined = [];

  for (const m of snapshotMessages || []) {
    combined.push({
      fecha: String(m?.fecha || ""),
      tipo: normalizeState(m?.tipo),
      mensaje: String(m?.mensaje || ""),
      _at: dateMs(m?.timestamp) || dateMs(m?.fecha),
      _source: "SNAPSHOT"
    });
  }

  for (const m of runtimeMessages || []) {
    combined.push({
      fecha: formatDateAr(m?.created_at, true),
      tipo: normalizeState(m?.sender_type),
      mensaje: String(m?.message || ""),
      wamid: String(m?.wamid || ""),
      _at: dateMs(m?.created_at),
      _source: "RUNTIME"
    });
  }

  combined.sort((a, b) => Number(a._at || 0) - Number(b._at || 0));

  const out = [];

  for (const item of combined) {
    const duplicate = out.some(prev => {
      if (
        item.wamid &&
        prev.wamid &&
        item.wamid === prev.wamid
      ) {
        return true;
      }

      return (
        normalizeState(prev.tipo) === normalizeState(item.tipo) &&
        String(prev.mensaje || "") === String(item.mensaje || "") &&
        Math.abs(Number(prev._at || 0) - Number(item._at || 0)) < 180000
      );
    });

    if (!duplicate) {
      out.push(item);
    }
  }

  return out
    .slice(-100)
    .map(({ _at, _source, ...rest }) => rest);
}

