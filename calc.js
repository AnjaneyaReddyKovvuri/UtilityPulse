// Pure usage calculations from raw meter readings. No DOM access, so it can be tested on its own.
const Calc = (() => {
  const DAY = 86400000;
  const ANOMALY_FACTOR = 1.5; // flag an interval whose daily rate exceeds 1.5x the recent median
  const ANOMALY_WINDOW = 8; // number of earlier intervals the median is taken over
  const ANOMALY_MIN_HISTORY = 3;

  // Dates are 'YYYY-MM-DD' strings; day numbers are whole days since the epoch (UTC, so no DST drift).
  const toDay = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
  };
  const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const daysInMonth = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };
  const daysInYear = (y) => (toDay(`${Number(y) + 1}-01-01`) - toDay(`${y}-01-01`));

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  function sorted(readings, utility) {
    return readings
      .filter((r) => r.utility === utility)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // One interval per pair of consecutive readings. A reading flagged `reset` (meter replaced)
  // starts a new baseline, so the gap before it carries no usage.
  function intervals(readings, utility) {
    const rs = sorted(readings, utility);
    const out = [];
    const rates = [];
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1];
      const b = rs[i];
      if (b.reset || b.value < a.value) continue;
      const startDay = toDay(a.date);
      const endDay = toDay(b.date);
      const days = endDay - startDay;
      const usage = b.value - a.value;
      const rate = usage / days;
      const history = rates.slice(-ANOMALY_WINDOW);
      const base = history.length >= ANOMALY_MIN_HISTORY ? median(history) : 0;
      const anomaly = base > 0 && rate > base * ANOMALY_FACTOR ? rate / base : 0;
      out.push({ id: b.id, from: a.date, to: b.date, startDay, endDay, days, usage, rate, anomaly });
      rates.push(rate);
    }
    return out;
  }

  // Spreads each interval's usage evenly over its days (the days after the first reading, up to
  // and including the day of the second), then sums per calendar month and year.
  // `days` is how many days of the period are actually covered by readings.
  function totals(readings, utility) {
    const months = {};
    const years = {};
    for (const iv of intervals(readings, utility)) {
      for (let d = iv.startDay + 1; d <= iv.endDay; d++) {
        const key = fromDay(d).slice(0, 7);
        const m = (months[key] ??= { usage: 0, days: 0 });
        m.usage += iv.rate;
        m.days++;
      }
    }
    for (const [key, m] of Object.entries(months)) {
      const y = (years[key.slice(0, 4)] ??= { usage: 0, days: 0 });
      y.usage += m.usage;
      y.days += m.days;
    }
    return { months, years };
  }

  return { toDay, fromDay, daysInMonth, daysInYear, sorted, intervals, totals };
})();

if (typeof module !== 'undefined') module.exports = Calc;
