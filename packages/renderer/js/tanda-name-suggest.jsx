// tanda-name-suggest.jsx — auto-suggest a DJ-style tanda name from its songs
const { useMemo, useEffect, useRef } = React;

const DECADE_WORDS = {
  1920: "twenties",
  1930: "thirties",
  1940: "forties",
  1950: "fifties",
  1960: "sixties",
  1970: "seventies",
  1980: "eighties",
  1990: "nineties",
};

function positionInDecade(year) {
  const d = year % 10;
  if (d <= 3) return "early";
  if (d <= 6) return "mid";
  return "late";
}

function decadeWord(decadeStart) {
  return DECADE_WORDS[decadeStart] || `${decadeStart}s`;
}

function decadeShort(decadeStart) {
  return String(decadeStart).slice(-2) + "s";
}

/** One year → "early thirties" or "mid-1930s" when word decades don't apply. */
function yearPhrase(year) {
  const decadeStart = Math.floor(year / 10) * 10;
  const word = DECADE_WORDS[decadeStart];
  if (word) return `${positionInDecade(year)} ${word}`;
  return `${positionInDecade(year)}-${decadeStart}s`;
}

/** Several years → a single era hint (earliest year anchors the phrase). */
function yearIndication(years) {
  if (!years.length) return "";
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  if (lo === hi) return yearPhrase(lo);
  const loDec = Math.floor(lo / 10) * 10;
  const hiDec = Math.floor(hi / 10) * 10;
  if (loDec === hiDec) {
    const posLo = positionInDecade(lo);
    const posHi = positionInDecade(hi);
    if (posLo === posHi && DECADE_WORDS[loDec]) return `${posLo} ${DECADE_WORDS[loDec]}`;
    if (DECADE_WORDS[loDec]) return DECADE_WORDS[loDec];
    return `${loDec}s`;
  }
  if (DECADE_WORDS[loDec] && DECADE_WORDS[hiDec]) {
    return `${DECADE_WORDS[loDec]}–${decadeShort(hiDec)}`;
  }
  return `${loDec}s–${decadeShort(hiDec)}`;
}

/** Singer for the tanda name: only when every song shares the same vocalist. */
function tandaSingerForName(songs) {
  const list = songs || [];
  if (!list.length) return "";
  const singers = list.map((s) => (s.singer || "").trim()).filter(Boolean);
  if (!singers.length) return "";
  if (singers.length !== list.length) return "";
  const unique = [...new Set(singers)];
  return unique.length === 1 ? unique[0] : "";
}

/** Build a tanda name: orchestra — singer, era hint. `fallbackOrq` covers songs
 *  whose orchestra tag is empty (e.g. before Smart Organize) so we never render a
 *  nameless ", forties". */
function suggestTandaName(songs, fallbackOrq) {
  const list = songs || [];
  if (!list.length) return "";
  const m = tandaMeta({ songs: list });
  if (m.orq === "Empty tanda") return "";

  let orq = m.orq;
  if (!orq && fallbackOrq) orq = fallbackOrq;

  const parts = [];
  if (orq) parts.push(orq);
  const singer = tandaSingerForName(list);
  if (singer) parts.push(singer);

  const era = yearIndication(list.map((s) => s.year).filter(Boolean));
  const head = parts.join(" — ");
  if (head && era) return `${head}, ${era}`;
  return head || era || "";
}

/* Shown under the builder name field: auto-fills when empty, offers a one-click
 * apply when the DJ has typed something else. */
function TandaNameSuggest({ songs, name, onApply, autoFill = true }) {
  const suggestion = useMemo(() => suggestTandaName(songs), [songs]);
  const trimmed = (name || "").trim();
  const applyRef = useRef(onApply);
  applyRef.current = onApply;

  useEffect(() => {
    if (autoFill && !trimmed && suggestion) applyRef.current(suggestion);
  }, [autoFill, trimmed, suggestion]);

  if (!suggestion || suggestion === trimmed) return null;

  return (
    <div className="tv-name-suggest">
      <span className="tv-name-suggest-lbl">Suggested</span>
      <button type="button" className="tv-name-suggest-btn" onClick={() => onApply(suggestion)}
        title="Use suggested name">
        {suggestion}
      </button>
    </div>
  );
}

Object.assign(window, { suggestTandaName, yearIndication, tandaSingerForName, TandaNameSuggest });
