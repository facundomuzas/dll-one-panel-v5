// Fechas del panel: dd/MM/yyyy son horas locales de Argentina (UTC-03).
// Nunca pasar ese formato a Date.parse: 12/10 se interpreta como diciembre.
export function dateMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text=String(value || "").trim();
  if (!text) return 0;
  const local=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (local) {
    const [,dd,mm,yyyy,hh="0",mi="0",ss="0"]=local;
    const [d,m,y,h,i,s]=[dd,mm,yyyy,hh,mi,ss].map(Number);
    const utc=new Date(Date.UTC(y,m-1,d,h,i,s));
    if (utc.getUTCFullYear()!==y || utc.getUTCMonth()!==m-1 || utc.getUTCDate()!==d ||
        h>23 || i>59 || s>59) return 0;
    return utc.getTime()+3*60*60*1000;
  }
  // ISO con zona explícita: independiente de la zona horaria del servidor.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const ms=Date.parse(text); return Number.isFinite(ms)?ms:0;
  }
  // Fechas ISO locales de planilla: interpretar con la misma zona del negocio.
  const isoLocal=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if(isoLocal) {
    const [,y,m,d,h="00",i="00",s="00"]=isoLocal;
    return dateMs(`${d}/${m}/${y} ${h}:${i}:${s}`);
  }
  return 0;
}

export function formatDateAr(value, withSeconds = false) {
  const ms = dateMs(value);
  if (!ms) return String(value || "");

  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat(
    "es-AR",
    {
      timeZone: "America/Argentina/Mendoza",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hourCycle: "h23"
    }
  ).formatToParts(d);

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return withSeconds
    ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`
    : `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

