const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/**
 * «22 сентября 2026, 15:41 мск». Считаем как UTC+3: в России нет перехода на летнее
 * время, поэтому смещение постоянное и не зависит от наличия ICU в контейнере.
 */
export function moscowTime(date: Date): string {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${msk.getUTCDate()} ${MONTHS[msk.getUTCMonth()]} ${msk.getUTCFullYear()}, ` +
    `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())} мск`
  );
}

/** «40 мин» / «14 ч» / «2 сут 3 ч» — сколько прошло времени, для логов и предупреждений. */
export function since(from: Date, to: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} сут ${rest} ч` : `${days} сут`;
}
